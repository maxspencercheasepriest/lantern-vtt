// Lantern VTT — a small self-hosted virtual tabletop.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Server } from 'socket.io';
import multer from 'multer';
import { rollExpression, sanitizeResult, pushPool } from './shared/dice.js';
import { Library } from './library.js';
import {
  RULESETS, freshCombat, newEntry, cleanEntry, sortEntries, rollInitiative, nextTurn, combatFor,
  cleanNote, noteVisible, noteEditable,
} from './campaign.js';
import * as SB from './soundboard.js';
import * as V from './shared/vision.js';
import { Props, injectHelper, PROP_LIMITS } from './props.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

export function startServer(opts = {}) {
  const PORT = Number(opts.port ?? process.env.PORT ?? 3000);
  const HOST = opts.host || process.env.HOST || '0.0.0.0';
  const DATA_DIR = path.resolve(opts.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data'));
  const VENDOR_DIR = opts.vendorDir || path.join(__dirname, 'public', 'vendor');
  const log = opts.quiet ? () => {} : console.log;
  const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
  const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
  const CHAT_LIMIT = 500;
  fs.mkdirSync(ROOMS_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // ---------- GM password ----------
  function loadGmPassword() {
    if (opts.gmPassword) return String(opts.gmPassword);
    if (process.env.GM_PASSWORD) return process.env.GM_PASSWORD;
    const file = path.join(DATA_DIR, 'gm-password.txt');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const pw = crypto.randomBytes(6).toString('base64url');
    fs.writeFileSync(file, pw + '\n');
    log(`\n  No GM_PASSWORD set — generated one and saved it to ${file}`);
    return pw;
  }
  const GM_PASSWORD = loadGmPassword();
  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  // ---------- helpers ----------
  const uid = () => crypto.randomBytes(8).toString('hex');
  const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, def = 0, min = -1e7, max = 1e7) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const okRoomId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
  const okColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
  const okImage = (u) => (typeof u === 'string' && /^\/uploads\/[a-f0-9]{16,40}\.(png|jpe?g|webp|gif)$/.test(u) ? u : null);
  const cleanName = (n) => str(n, 32).replace(/[\u0000-\u001f<>]/g, '').trim();

  // ---------- rooms ----------
  const rooms = new Map(); // id -> room

  // ---------- scenes ----------
  // A campaign has any number of scenes (maps). Players all see the active scene; the GM can look at any.
  const MAX_SCENES = 200;
  const freshFog = () => ({ mode: 'off', ops: [], explored: null, shared: true, radius: 0 });
  function freshScene(name = 'New scene', map = {}) {
    return {
      id: uid(), name,
      map: {
        image: null, width: 2800, height: 2100,
        gridSize: 70, offsetX: 0, offsetY: 0, showGrid: true,
        gridColor: '#000000', gridOpacity: 0.3, unitsPerSquare: 1.5, unitName: 'm', ...map,
      },
      tokens: [],
      fog: freshFog(),   // mode: 'off' | 'manual' (GM reveals by hand) | 'sight' (walls and line of sight)
      drawings: [],
      walls: [],
      playerDraw: true,
    };
  }
  function normaliseScene(sc) {
    const base = freshScene(sc.name || 'Scene');
    const fog = { ...freshFog(), ...(sc.fog || {}) };
    if (!['off', 'manual', 'sight'].includes(fog.mode)) fog.mode = sc.fog?.enabled ? 'manual' : 'off';
    delete fog.enabled;
    return { ...base, ...sc, id: sc.id || base.id, map: { ...base.map, ...(sc.map || {}) }, fog,
      tokens: sc.tokens || [], drawings: sc.drawings || [], walls: sc.walls || [] };
  }
  const sceneById = (room, id) => room.scenes.find((x) => x.id === id) || null;
  const activeScene = (room) => sceneById(room, room.activeScene) || room.scenes[0];
  /** The scene this person is looking at: players always see the active one; the GM can preview others. */
  const sceneOf = (room, viewer) => (viewer?.isGM && viewer.view && sceneById(room, viewer.view)) || activeScene(room);
  const allTokens = (room) => room.scenes.flatMap((sc) => sc.tokens);
  function findToken(room, id) {
    for (const sc of room.scenes) { const t = sc.tokens.find((x) => x.id === id); if (t) return { sc, t }; }
    return { sc: null, t: null };
  }

  function freshRoom(id) {
    const first = freshScene('Scene 1');
    return {
      id,
      scenes: [first],
      activeScene: first.id,
      sheets: [],
      chat: [],
      settings: { ruleset: null },
      combat: freshCombat(),
      notes: [],
      audio: SB.freshAudio(),
      propState: {},  // per prop collection: { state: { key: string }, version }
      propShares: {}, // per prop collection, per page: { [file]: 'all' | [player names] } who've been shown it
    };
  }
  const persisted = ({ id, scenes, activeScene: active, sheets, chat, settings, combat, notes, audio, propState, propShares }) => ({ id, scenes, activeScene: active, sheets, chat, settings, combat, notes, audio: SB.saveAudio(audio), propState, propShares });

  function getRoom(id) {
    if (rooms.has(id)) return rooms.get(id);
    const file = path.join(ROOMS_DIR, `${id}.json`);
    let room;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      room = { ...freshRoom(id), ...saved };
      if (!Array.isArray(saved.scenes)) room.scenes = null; // older save: converted from saved.scene below
    } catch {
      room = freshRoom(id);
    }
    room.audio = SB.loadAudio(room.audio);
    room.propState ||= {};
    room.propShares ||= {};
    // 0.14 shared whole collections ('all' or [names]); now it's page by page. Rebuild from the "shown" cards in chat.
    for (const [coll, v] of Object.entries(room.propShares)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) continue;
      const pages = {};
      for (const m of room.chat) {
        if (m.kind !== 'prop' || m.coll !== coll) continue;
        const to = m.to?.length ? m.to : 'all';
        const cur = pages[m.file];
        pages[m.file] = to === 'all' || cur === 'all' ? 'all' : [...new Set([...(cur || []), ...to])];
      }
      room.propShares[coll] = pages;
    }
    room.propStreams = new Map(); // collection -> Set of open event streams
    // campaigns from before scenes had a single map: it becomes Scene 1
    if (!Array.isArray(room.scenes) || !room.scenes.length) {
      const old = room.scene;
      const first = freshScene('Scene 1');
      if (old) Object.assign(first, { map: { ...first.map, ...old.map }, tokens: old.tokens || [], fog: { ...freshFog(), ops: old.fog?.ops || [], mode: old.fog?.enabled ? 'manual' : 'off' } });
      room.scenes = [first];
    }
    delete room.scene;
    room.scenes = room.scenes.map(normaliseScene);
    if (!sceneById(room, room.activeScene)) room.activeScene = room.scenes[0].id;
    room.audioTimer = null;
    room.sockets = new Set();
    room.saveTimer = null;
    room.sceneTimer = null;
    room.sheetsTimer = null;
    rooms.set(id, room);
    return room;
  }

  function save(room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
      const file = path.join(ROOMS_DIR, `${room.id}.json`);
      const tmp = file + '.tmp';
      fs.writeFile(tmp, JSON.stringify(persisted(room)), (err) => {
        if (err) return console.error('save failed', err);
        fs.rename(tmp, file, (e) => e && console.error('save rename failed', e));
      });
    }, 800);
  }

  // ---------- per-viewer filtering ----------
  const canSeeDrawing = (d, viewer) => viewer.isGM || !d.gmOnly;
  function sceneFor(room, viewer) {
    const sc = sceneOf(room, viewer);
    return {
      ...sc,
      active: sc.id === room.activeScene,
      tokens: viewer.isGM ? sc.tokens : sc.tokens.filter((t) => !t.hidden),
      drawings: sc.drawings.filter((d) => canSeeDrawing(d, viewer)),
    };
  }
  /** The GM's list of scenes (players just learn the active scene's name). */
  function sendSceneList(room) {
    const list = room.scenes.map((sc) => ({ id: sc.id, name: sc.name, image: sc.map.image, tokens: sc.tokens.length, fog: sc.fog.mode }));
    for (const s of room.sockets) {
      s.emit('scenes', s.data.isGM
        ? { list, active: room.activeScene, view: sceneOf(room, s.data).id }
        : { list: [], active: room.activeScene, view: room.activeScene });
    }
  }
  /** After tokens move or doors open: remember what the party has now seen. */
  function updateExplored(sc) {
    if (sc.fog.mode !== 'sight') return false;
    const g = V.exploredGrid(sc);
    const segs = V.blockingSegments(sc);
    const radius = (sc.fog.radius || 0) * sc.map.gridSize;
    let changed = false;
    for (const t of sc.tokens) {
      if (t.hidden || !V.isPlayerToken(t)) continue;
      const origin = V.tokenCenter(t, sc.map.gridSize);
      if (V.markExplored(g, { origin, poly: V.visibilityPolygon(origin, segs) }, radius)) changed = true;
    }
    if (changed || !sc.fog.explored) sc.fog.explored = V.packExplored(g);
    return changed;
  }
  const canSeeSheet = (sheet, viewer) => viewer.isGM || sheet.owner === viewer.name || sheet.shared;
  const canEditSheet = (sheet, viewer) => viewer.isGM || sheet.owner === viewer.name;
  const sheetsFor = (room, viewer) => room.sheets.filter((s) => canSeeSheet(s, viewer));
  const canSeeMsg = (m, viewer) =>
    m.visibility === 'all' || viewer.isGM || m.from === viewer.name || (m.to || []).includes(viewer.name);
  const canMoveToken = (t, viewer) =>
    viewer.isGM || (!t.locked && (t.owners || []).some((o) => o === '*' || o === viewer.name));

  function sendScene(room) {
    // coalesce bursts (token drags) into ~30fps updates
    if (room.sceneTimer) return;
    room.sceneTimer = setTimeout(() => {
      room.sceneTimer = null;
      for (const s of room.sockets) s.emit('scene', sceneFor(room, s.data));
    }, 33);
  }
  function sendSheets(room) {
    if (room.sheetsTimer) return;
    room.sheetsTimer = setTimeout(() => {
      room.sheetsTimer = null;
      for (const s of room.sockets) s.emit('sheets', sheetsFor(room, s.data));
    }, 60);
  }
  function sendPresence(room) {
    const users = [...room.sockets].map((s) => ({ name: s.data.name, isGM: s.data.isGM, color: s.data.color, av: !!room.av?.has(s.id) }));
    for (const s of room.sockets) s.emit('presence', users);
  }
  let libraryTimer = null;
  function sendLibraryAll() {
    if (libraryTimer) return;
    libraryTimer = setTimeout(() => {
      libraryTimer = null;
      for (const room of rooms.values()) for (const s of room.sockets) s.emit('library', library.listFor(room.id, s.data));
    }, 150);
  }
  function sendCombat(room) {
    for (const s of room.sockets) s.emit('combat', combatFor(room.combat, s.data));
  }
  function sendNotes(room) {
    for (const s of room.sockets) s.emit('notes', room.notes.filter((n) => noteVisible(n, s.data)));
  }
  // Everyone gets the same audio state plus the server's clock, so they can work out where the music is.
  function sendAudio(room) {
    const payload = { ...room.audio, serverNow: Date.now() };
    for (const s of room.sockets) s.emit('audio', payload);
    scheduleAudio(room);
  }
  function scheduleAudio(room) {
    clearTimeout(room.audioTimer);
    const at = SB.musicEndsAt(room.audio);
    if (at == null) return;
    room.audioTimer = setTimeout(() => {
      room.audioTimer = null;
      if (SB.musicEndsAt(room.audio) !== at) return;
      SB.advanceMusic(room.audio, Date.now());
      sendAudio(room); save(room);
    }, Math.max(0, at - Date.now()) + 250);
    room.audioTimer.unref?.();
  }

  function sendSettings(room) {
    for (const s of room.sockets) s.emit('settings', { ...room.settings, rulesets: Object.fromEntries(Object.entries(RULESETS).map(([k, v]) => [k, v.name])) });
  }
  // keep a combatant's token health bar in step with the tracker
  function syncTokenBar(room, e) {
    if (!e.tokenId || !e.hp || e.sheetId) return;
    const { t } = findToken(room, e.tokenId);
    if (t) { t.bar = { cur: e.hp.cur, max: e.hp.max }; sendScene(room); }
  }
  function postMessage(room, msg) {
    const m = { id: uid(), ts: Date.now(), visibility: 'all', to: [], ...msg };
    room.chat.push(m);
    if (room.chat.length > CHAT_LIMIT) room.chat.splice(0, room.chat.length - CHAT_LIMIT);
    for (const s of room.sockets) if (canSeeMsg(m, s.data)) s.emit('chat', m);
    save(room);
    return m;
  }

  // ---------- sanitising client objects ----------
  function cleanToken(t, existing = {}) {
    const out = { ...existing };
    if ('x' in t) out.x = num(t.x, existing.x ?? 0);
    if ('y' in t) out.y = num(t.y, existing.y ?? 0);
    if ('size' in t) out.size = num(t.size, 1, 0.25, 20);
    if ('label' in t) out.label = str(t.label, 40);
    if ('color' in t) out.color = okColor(t.color) || '#c0392b';
    if ('image' in t) out.image = t.image === null ? null : okImage(t.image);
    if ('hidden' in t) out.hidden = !!t.hidden;
    if ('locked' in t) out.locked = !!t.locked;
    if ('owners' in t) out.owners = (Array.isArray(t.owners) ? t.owners : []).map((o) => cleanName(o)).filter(Boolean).slice(0, 20);
    if ('sheetId' in t) out.sheetId = typeof t.sheetId === 'string' ? t.sheetId.slice(0, 32) : null;
    if ('bar' in t) out.bar = t.bar && typeof t.bar === 'object'
      ? { cur: num(t.bar.cur, 0), max: num(t.bar.max, 0) } : null;
    return out;
  }

  function cleanMap(m, existing) {
    const out = { ...existing };
    if ('image' in m) out.image = m.image === null ? null : okImage(m.image) ?? existing.image;
    if ('width' in m) out.width = num(m.width, existing.width, 100, 20000);
    if ('height' in m) out.height = num(m.height, existing.height, 100, 20000);
    if ('gridSize' in m) out.gridSize = num(m.gridSize, existing.gridSize, 10, 500);
    if ('offsetX' in m) out.offsetX = num(m.offsetX, 0, -500, 500);
    if ('offsetY' in m) out.offsetY = num(m.offsetY, 0, -500, 500);
    if ('showGrid' in m) out.showGrid = !!m.showGrid;
    if ('gridColor' in m) out.gridColor = okColor(m.gridColor) || existing.gridColor;
    if ('gridOpacity' in m) out.gridOpacity = num(m.gridOpacity, 0.3, 0, 1);
    if ('unitsPerSquare' in m) out.unitsPerSquare = num(m.unitsPerSquare, 1.5, 0.01, 1000);
    if ('unitName' in m) out.unitName = str(m.unitName, 8);
    return out;
  }

  // Sheet data is free-form per game system; cap its size rather than its shape.
  function cleanSheetData(d) {
    const json = JSON.stringify(d ?? {});
    if (json.length > 200_000) throw new Error('Sheet too large');
    return JSON.parse(json);
  }

  // ---------- HTTP ----------
  const app = express();
  app.disable('x-powered-by');
  // The Android app runs Lantern's interface from inside the app (origin https://localhost) and talks to this
  // server across origins. Access is still controlled by each player's access key, never by cookies.
  const APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && APP_ORIGINS.includes(origin) && /^\/(api|uploads)\//.test(req.path)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'x-upload-token, range, content-type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length, Content-Encoding');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  const require = createRequire(import.meta.url);
  const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));
  app.use('/pdfjs', express.static(PDFJS_DIR, { maxAge: '7d' }));
  app.use('/vendor', express.static(VENDOR_DIR));
  // ---------- props (interactive in-world screens; see props.js) ----------
  const props = new Props(DATA_DIR, [{ id: 'thaw', title: 'Thaw (Cyberpunk RED)', dir: path.join(__dirname, 'public', 'handouts', 'thaw') }]);
  // each person gets a key for prop pages: it says who they are, without exposing their main access key
  const PROP_SECRET_FILE = path.join(DATA_DIR, 'prop-secret.txt');
  let propSecret;
  try { propSecret = fs.readFileSync(PROP_SECRET_FILE, 'utf8').trim(); } catch { propSecret = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(PROP_SECRET_FILE, propSecret); }
  const propKeys = new Map(); // key -> { room, name, isGM }
  function propKeyFor(roomId, name, isGM) {
    const key = crypto.createHmac('sha256', propSecret).update(`${roomId}\n${name}\n${isGM ? 1 : 0}`).digest('base64url').slice(0, 32);
    propKeys.set(key, { room: roomId, name, isGM });
    return key;
  }
  // Sharing is page by page: a player's Library lists only the pages they've been shown. Once any page of a
  // collection is theirs, its other pages still load (so DECK/OS can launch its apps), but they aren't listed.
  const audienceHas = (a, viewer) => a === 'all' || (Array.isArray(a) && a.includes(viewer.name));
  const pageShared = (room, collId, file, viewer) => viewer.isGM || audienceHas(room.propShares[collId]?.[file], viewer);
  const propShared = (room, collId, viewer) => viewer.isGM || Object.values(room.propShares[collId] || {}).some((a) => audienceHas(a, viewer));
  function propsFor(room, viewer) {
    return props.list().map((c) => {
      const shares = room.propShares[c.id] || {};
      const pages = viewer.isGM
        ? c.pages.map((pg) => ({ ...pg, share: shares[pg.file] || 'none' }))
        : c.pages.filter((pg) => pageShared(room, c.id, pg.file, viewer));
      return { ...c, pages };
    }).filter((c) => viewer.isGM || c.pages.length);
  }
  function sendProps(room) { for (const s of room.sockets) s.emit('props', propsFor(room, s.data)); }
  /** Who's asking, from the key in the URL; and is this collection theirs to see? */
  function propAccess(req, res) {
    const who = propKeys.get(req.params.key);
    const coll = props.get(req.params.coll);
    if (!who) { res.status(401).type('text').send('This prop link has expired. Open it again from Lantern.'); return null; }
    const room = getRoom(who.room);
    if (!coll || !propShared(room, coll.id, who)) { res.status(404).type('text').send('Not shared with you.'); return null; }
    return { who, room, coll };
  }
  const propCors = (req, res, next) => {
    // prop pages run in a sealed-off (opaque) origin, so they call back cross-origin; the key in the path is the only credential
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
  const PROP_CSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads";
  const propJson = express.json({ limit: '1mb' });
  const pstate = (room, collId) => (room.propState[collId] ||= { state: {}, version: 0 });

  app.use('/p/', propCors); // props fetch their own files (e.g. a props.json) from their sealed-off origin too
  app.get('/p/:key/:coll/__lantern/state', (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    const st = pstate(a.room, a.coll.id);
    res.json({ state: st.state, version: st.version });
  });
  app.post('/p/:key/:coll/__lantern/state', propJson, (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    const key = str(req.body?.key, 200);
    const value = req.body?.value === null ? null : typeof req.body?.value === 'string' ? req.body.value : null;
    if (!key) return res.status(400).json({ error: 'Missing key' });
    if (value !== null && value.length > PROP_LIMITS.keyBytes) return res.status(413).json({ error: 'Too much to save under one key' });
    const st = pstate(a.room, a.coll.id);
    if ((st.state[key] ?? null) === value) return res.json({ ok: true, version: st.version });
    const size = Object.entries(st.state).reduce((n, [k, v]) => n + (k === key ? 0 : v.length), 0) + (value?.length || 0);
    if (size > PROP_LIMITS.collectionBytes) return res.status(413).json({ error: 'This prop has saved too much' });
    if (value === null) delete st.state[key]; else st.state[key] = value;
    st.version++;
    const msg = `event: state\ndata: ${JSON.stringify({ key, value, by: str(req.body?.by, 20) })}\n\n`;
    for (const r of a.room.propStreams.get(a.coll.id) || []) r.write(msg);
    save(a.room);
    res.json({ ok: true, version: st.version });
  });
  app.get('/p/:key/:coll/__lantern/events', (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    res.write(': hello\n\n');
    const set = a.room.propStreams.get(a.coll.id) || new Set();
    a.room.propStreams.set(a.coll.id, set);
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000); // keeps tunnels and proxies from closing it
    req.on('close', () => { clearInterval(ping); set.delete(res); });
  });
  app.post('/p/:key/:coll/__lantern/roll', propJson, async (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    try {
      const result = await rollExpression(str(req.body?.expr, 120), secureRoll);
      const label = str(req.body?.label, 80);
      postMessage(a.room, { kind: 'roll', from: a.who.name, color: colorFor(a.who.name), isGM: a.who.isGM, label: label || `${a.coll.title}`, meta: {}, result, source: 'digital', visibility: 'all' });
      res.json({ total: result.total, result });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/p/:key/:coll/__lantern/chat', propJson, (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    const text = str(req.body?.text, 2000).trim();
    if (!text) return res.status(400).json({ error: 'Empty message' });
    postMessage(a.room, { kind: 'text', from: a.who.name, color: colorFor(a.who.name), isGM: a.who.isGM, text, to: [], visibility: 'all' });
    res.json({ ok: true });
  });
  app.get('/p/:key/:coll/__lantern/sheet', (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    const s = a.room.sheets.find((x) => x.owner === a.who.name);
    res.json(s ? { system: s.system, data: s.data } : null);
  });
  app.get('/p/:key/:coll/*', (req, res) => {
    const a = propAccess(req, res); if (!a) return;
    const rel = decodeURIComponent(req.params[0] || '');
    const file = props.resolve(a.coll, rel || 'index.html');
    if (!file) return res.status(404).type('text').send('No such page in this prop.');
    res.set('Content-Security-Policy', PROP_CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    if (!/\.html?$/i.test(file)) return res.sendFile(file, { maxAge: '1h' });
    const st = pstate(a.room, a.coll.id);
    const html = injectHelper(fs.readFileSync(file, 'utf8'), {
      base: `/p/${req.params.key}/${a.coll.id}/`, collection: a.coll.id,
      me: { name: a.who.name, isGM: a.who.isGM }, state: st.state, version: st.version,
    });
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  });
  // GM uploads: one .zip (a folder of pages) or one or more .html files
  const propUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROP_LIMITS.bytes, files: 50 } });
  app.post('/api/props', (req, res, next) => {
    const t = uploadTokens.get(req.get('x-upload-token'));
    if (!t) return res.status(401).json({ error: 'Not joined' });
    if (!t.isGM) return res.status(403).json({ error: 'Only the GM can add props' });
    req.lantern = t;
    next();
  }, propUpload.array('file', 50), (req, res) => {
    try {
      const files = (req.files || []).map((f) => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), data: f.buffer }));
      if (!files.length) return res.status(400).json({ error: 'Choose a .zip or .html files' });
      const c = props.add(files, str(req.body?.title, 80));
      for (const r of rooms.values()) sendProps(r);
      res.json({ id: c.id });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/shared', express.static(path.join(__dirname, 'shared')));
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));

  const uploadTokens = new Map(); // token -> { room, name, isGM }
  const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}.${MIME_EXT[file.mimetype]}`),
    }),
    limits: { fileSize: 30 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, !!MIME_EXT[file.mimetype]),
  });
  app.post('/api/upload', (req, res, next) => {
    if (!uploadTokens.has(req.get('x-upload-token'))) return res.status(401).json({ error: 'Not joined' });
    next();
  }, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Images only (png, jpg, webp, gif)' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
  // ---------- audio (GM's music, ambience and sound effects) ----------
  const AUDIO_MAX_MB = Number(opts.audioMaxMb ?? process.env.AUDIO_MAX_MB ?? 300);
  const AUDIO_EXT = { mp3: 'mp3', mpeg: 'mp3', ogg: 'ogg', oga: 'ogg', opus: 'opus', m4a: 'm4a', mp4: 'm4a', aac: 'aac', wav: 'wav', wave: 'wav', flac: 'flac', webm: 'webm' };
  const audioExt = (file) => {
    const fromName = /\.([a-z0-9]{2,5})$/i.exec(file.originalname || '')?.[1]?.toLowerCase();
    if (fromName && AUDIO_EXT[fromName]) return AUDIO_EXT[fromName];
    const sub = /^audio\/(x-)?([a-z0-9]+)/i.exec(file.mimetype || '')?.[2]?.toLowerCase();
    return sub ? AUDIO_EXT[sub] || null : null;
  };
  const audioUpload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}.${audioExt(file)}`),
    }),
    limits: { fileSize: AUDIO_MAX_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => cb(null, !!audioExt(file)),
  });
  app.post('/api/audio', (req, res, next) => {
    const t = uploadTokens.get(req.get('x-upload-token'));
    if (!t) return res.status(401).json({ error: 'Not joined' });
    if (!t.isGM) return res.status(403).json({ error: 'Only the GM can add audio' });
    req.lantern = t;
    next();
  }, audioUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Audio files only (mp3, ogg, m4a, wav, flac, opus, webm)' });
    const room = getRoom(req.lantern.room);
    if (room.audio.tracks.length >= SB.MAX_TRACKS) {
      fs.rm(req.file.path, { force: true }, () => {});
      return res.status(400).json({ error: `That's the limit of ${SB.MAX_TRACKS} tracks — delete some first` });
    }
    const original = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8');
    const track = SB.cleanTrack({
      id: uid(), url: `/uploads/${req.file.filename}`,
      name: str(req.body?.name, 80) || original.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' '),
      kind: req.body?.kind, duration: req.body?.duration, volume: 1,
    });
    room.audio.tracks.push(track);
    sendAudio(room); save(room);
    res.json({ id: track.id });
  });

  // ---------- PDF library ----------
  const LIBRARY_MAX_MB = Number(opts.libraryMaxMb ?? process.env.LIBRARY_MAX_MB ?? 1024);
  const library = new Library(DATA_DIR, { onChange: () => sendLibraryAll(), log });
  const tokenInfo = (req) => uploadTokens.get(req.get('x-upload-token') || req.query.t);
  const pdfUpload = multer({
    dest: path.join(DATA_DIR, 'library', 'incoming'),
    limits: { fileSize: LIBRARY_MAX_MB * 1024 * 1024, files: 20 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)),
  });
  app.post('/api/library', (req, res, next) => {
    const t = tokenInfo(req);
    if (!t) return res.status(401).json({ error: 'Not joined' });
    if (!t.isGM) return res.status(403).json({ error: 'Only the GM can add PDFs' });
    next();
  }, pdfUpload.array('file', 20), (req, res) => {
    const added = [], rejected = [];
    for (const f of req.files || []) {
      // check it really is a PDF before keeping it
      let head = '';
      try { const fd = fs.openSync(f.path, 'r'); const b = Buffer.alloc(1024); fs.readSync(fd, b, 0, 1024, 0); fs.closeSync(fd); head = b.toString('latin1'); } catch {}
      if (!head.includes('%PDF-')) { fs.rm(f.path, { force: true }, () => {}); rejected.push(f.originalname); continue; }
      added.push(library.add(f.path, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.size).id);
    }
    if (!added.length) return res.status(400).json({ error: rejected.length ? `Not a PDF: ${rejected.join(', ')}` : 'Choose a PDF file' });
    res.json({ ids: added, rejected });
  });
  app.get('/api/library/:id.pdf', (req, res) => {
    const t = tokenInfo(req);
    const doc = library.get(req.params.id);
    if (!t) return res.status(401).end();
    if (!library.canSee(doc, t.room, t)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('Content-Disposition', 'inline');
    res.type('application/pdf');
    res.sendFile(library.pdfPath(doc), { acceptRanges: true });
  });
  // scenario prep results (GM only; they contain the whole scenario's text)
  app.get('/api/library/:id/scenario', (req, res) => {
    const t = tokenInfo(req);
    if (!t) return res.status(401).end();
    if (!t.isGM) return res.status(403).end();
    const r = library.scenario(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not analysed yet' });
    res.set('Cache-Control', 'no-store');
    res.json(r);
  });

  app.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (limit ${req.path.startsWith('/api/audio') ? AUDIO_MAX_MB : LIBRARY_MAX_MB} MB)` });
    res.status(400).json({ error: err.message || 'Upload failed' });
  });

  const server = http.createServer(app);
  const sockets = new Set();
  server.on('connection', (c) => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  const io = new Server(server, { maxHttpBufferSize: 1e6, cors: { origin: APP_ORIGINS } });

  const PLAYER_COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#6d9dc5', '#c77dff', '#ef476f', '#06d6a0', '#ffd166'];
  const colorFor = (name) => PLAYER_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PLAYER_COLORS.length];

  const secureRoll = async (sides) => crypto.randomInt(1, sides + 1);

  // ---------- video relay ----------
  // STUN finds a direct route between players. Mobile data, hotspots and some broadband block direct
  // links, so a TURN relay passes the (still encrypted) video along instead. Browsers only use the relay
  // when a direct link fails. Choices, saved per server and set by the GM in the Scene tab:
  //   free   — Metered's public Open Relay (no sign-up; ~20 GB a month shared; credentials made here)
  //   custom — your own relay, e.g. a Metered or Cloudflare account, or coturn
  //   off    — direct connections only
  const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };
  const OPEN_RELAY = { host: 'staticauth.openrelay.metered.ca', secret: 'openrelayprojectsecret' };
  const VIDEO_FILE = path.join(DATA_DIR, 'video.json');
  const envTurn = opts.turnUrl || process.env.TURN_URL;
  let videoSettings = { relay: 'free', url: '', username: '', credential: '' };
  try { videoSettings = { ...videoSettings, ...JSON.parse(fs.readFileSync(VIDEO_FILE, 'utf8')) }; } catch { /* defaults */ }
  if (envTurn) videoSettings = { relay: 'custom', url: envTurn, username: opts.turnUsername || process.env.TURN_USERNAME || '', credential: opts.turnCredential || process.env.TURN_CREDENTIAL || '', fromEnv: true };
  /** The servers a browser should try, with fresh relay credentials (shared-secret TURN, valid a day). */
  function iceServersFor(name) {
    const list = [STUN];
    if (videoSettings.relay === 'free') {
      const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:${String(name || 'lantern').replace(/[^\w-]/g, '').slice(0, 20) || 'lantern'}`;
      const credential = crypto.createHmac('sha1', OPEN_RELAY.secret).update(username).digest('base64');
      const h = OPEN_RELAY.host;
      list.push({ urls: [`turn:${h}:80`, `turn:${h}:80?transport=tcp`, `turn:${h}:443`, `turns:${h}:443?transport=tcp`], username, credential });
    } else if (videoSettings.relay === 'custom' && videoSettings.url) {
      list.push({ urls: videoSettings.url.split(',').map((u) => u.trim()).filter(Boolean), username: videoSettings.username || undefined, credential: videoSettings.credential || undefined });
    }
    return list;
  }

  io.on('connection', (socket) => {
    let room = null;
    const me = () => socket.data;
    const fail = (ack, error) => typeof ack === 'function' && ack({ error });
    const ok = (ack, data = {}) => typeof ack === 'function' && ack({ ok: true, ...data });
    const guard = (fn) => async (payload, ack) => {
      if (!room) return fail(ack, 'Join a room first');
      try { await fn(payload || {}, ack); } catch (e) { fail(ack, e.message || 'Error'); }
    };
    const gmOnly = (fn) => guard((p, ack) => (me().isGM ? fn(p, ack) : fail(ack, 'GM only')));

    socket.on('join', (p = {}, ack) => {
      const roomId = str(p.room, 40).toLowerCase();
      const name = cleanName(p.name);
      if (!okRoomId(roomId)) return fail(ack, 'Room names: lowercase letters, numbers and dashes');
      if (!name) return fail(ack, 'Pick a name');
      const wantsGM = !!p.gmPassword;
      if (wantsGM && !safeEqual(p.gmPassword, GM_PASSWORD)) return fail(ack, 'Wrong GM password');
      if (room) { avLeave(); room.sockets.delete(socket); socket.leave(room.id); }
      room = getRoom(roomId);
      // Reuse the previous access key after a reconnect, so open PDFs keep loading pages.
      const prev = typeof p.resumeToken === 'string' ? uploadTokens.get(p.resumeToken) : null;
      const reuse = prev && prev.room === roomId && prev.name === name && prev.isGM === wantsGM;
      const uploadToken = reuse ? p.resumeToken : uid() + uid();
      if (reuse) clearTimeout(prev.expiry);
      const oldToken = socket.data?.uploadToken;
      if (oldToken && oldToken !== uploadToken) uploadTokens.delete(oldToken);
      socket.data = { name, isGM: wantsGM, color: colorFor(name), uploadToken };
      uploadTokens.set(uploadToken, { room: roomId, name, isGM: wantsGM });
      room.sockets.add(socket);
      socket.join(roomId);
      ok(ack, { name, isGM: wantsGM, color: socket.data.color, uploadToken, version: VERSION, propKey: propKeyFor(roomId, name, wantsGM) });
      socket.emit('scene', sceneFor(room, me()));
      sendSceneList(room);
      socket.emit('sheets', sheetsFor(room, me()));
      socket.emit('chat:history', room.chat.filter((m) => canSeeMsg(m, me())));
      socket.emit('library', library.listFor(room.id, me()));
      socket.emit('combat', combatFor(room.combat, me()));
      socket.emit('notes', room.notes.filter((n) => noteVisible(n, me())));
      socket.emit('audio', { ...room.audio, serverNow: Date.now() });
      socket.emit('props', propsFor(room, me()));
      sendSettings(room);
      sendPresence(room);
    });

    socket.on('disconnect', () => {
      if (!room) return;
      avLeave();
      room.sockets.delete(socket);
      const t = uploadTokens.get(socket.data?.uploadToken);
      if (t) {
        const tok = socket.data.uploadToken;
        t.expiry = setTimeout(() => uploadTokens.delete(tok), 10 * 60 * 1000);
        t.expiry.unref?.();
      }
      sendPresence(room);
    });

    // ----- video calls: the server only relays WebRTC set-up messages; audio and video go peer to peer -----
    function avLeave() {
      if (!room?.av?.has(socket.id)) return;
      room.av.delete(socket.id);
      socket.to(room.id).emit('av:peer-left', { id: socket.id });
      sendPresence(room);
    }
    socket.on('av:join', guard((p, ack) => {
      room.av ||= new Map();
      const info = { id: socket.id, name: me().name, color: me().color, audio: p.audio !== false, video: !!p.video };
      const peers = [...room.av.values()].filter((x) => x.id !== socket.id);
      room.av.set(socket.id, info);
      socket.to(room.id).emit('av:peer-joined', info);
      sendPresence(room);
      ok(ack, { id: socket.id, peers, iceServers: iceServersFor(me().name), relay: videoSettings.relay });
    }));
    socket.on('av:leave', guard((p, ack) => { avLeave(); ok(ack); }));
    socket.on('video:settings', gmOnly((p, ack) => {
      if (p.set) {
        if (videoSettings.fromEnv) throw new Error('The relay is set by the server (TURN_URL), so it can\'t be changed here');
        const relay = ['free', 'custom', 'off'].includes(p.set.relay) ? p.set.relay : 'free';
        const url = str(p.set.url, 500).trim();
        if (relay === 'custom' && !/^(turns?|stun):/i.test(url.split(',')[0] || '')) throw new Error('A relay address starts with turn: or turns:');
        const credential = p.set.credential === undefined ? videoSettings.credential : str(p.set.credential, 300); // blank = keep the saved one
        videoSettings = { relay, url, username: str(p.set.username, 200), credential };
        fs.writeFileSync(VIDEO_FILE, JSON.stringify(videoSettings));
      }
      const { credential, ...shown } = videoSettings;
      ok(ack, { ...shown, hasCredential: !!credential });
    }));
    socket.on('av:state', guard((p) => {
      const info = room.av?.get(socket.id);
      if (!info) return;
      info.audio = !!p.audio; info.video = !!p.video;
      socket.to(room.id).emit('av:state', { id: socket.id, audio: info.audio, video: info.video });
    }));
    socket.on('av:signal', guard((p) => {
      if (!room.av?.has(socket.id) || !room.av.has(p.to)) return; // both ends must be in this room's call
      const data = p.data && typeof p.data === 'object' ? p.data : null;
      if (!data || JSON.stringify(data).length > 100_000) return;
      io.to(p.to).emit('av:signal', { from: socket.id, data });
    }));

    // ----- scenes (GM) -----
    const myScene = () => sceneOf(room, me());
    const scenesChanged = () => { sendScene(room); sendSceneList(room); save(room); };
    socket.on('scene:create', gmOnly((p, ack) => {
      if (room.scenes.length >= MAX_SCENES) throw new Error(`That's the limit of ${MAX_SCENES} scenes`);
      const base = activeScene(room).map;
      const sc = freshScene(str(p.name, 60).trim() || `Scene ${room.scenes.length + 1}`, {
        gridSize: base.gridSize, unitsPerSquare: base.unitsPerSquare, unitName: base.unitName, gridColor: base.gridColor, gridOpacity: base.gridOpacity,
      });
      if (p.map) sc.map = cleanMap(p.map, sc.map);
      room.scenes.push(sc);
      if (p.view !== false) socket.data.view = sc.id;
      scenesChanged(); ok(ack, { id: sc.id });
    }));
    socket.on('scene:update', gmOnly((p, ack) => {
      const sc = sceneById(room, str(p.id, 32));
      if (!sc) throw new Error('No such scene');
      if ('name' in p) sc.name = str(p.name, 60).trim() || sc.name;
      if ('playerDraw' in p) sc.playerDraw = !!p.playerDraw;
      scenesChanged(); ok(ack);
    }));
    socket.on('scene:duplicate', gmOnly((p, ack) => {
      const src = sceneById(room, str(p.id, 32));
      if (!src) throw new Error('No such scene');
      if (room.scenes.length >= MAX_SCENES) throw new Error(`That's the limit of ${MAX_SCENES} scenes`);
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid(); copy.name = `${src.name} (copy)`;
      for (const t of copy.tokens) { t.id = uid(); }
      for (const d of copy.drawings) d.id = uid();
      for (const w of copy.walls) w.id = uid();
      copy.fog.explored = null;
      room.scenes.splice(room.scenes.indexOf(src) + 1, 0, copy);
      socket.data.view = copy.id;
      scenesChanged(); ok(ack, { id: copy.id });
    }));
    socket.on('scene:delete', gmOnly((p, ack) => {
      const sc = sceneById(room, str(p.id, 32));
      if (!sc) throw new Error('No such scene');
      if (room.scenes.length === 1) throw new Error("A campaign needs at least one scene");
      room.scenes = room.scenes.filter((x) => x !== sc);
      if (room.activeScene === sc.id) room.activeScene = room.scenes[0].id;
      for (const s of room.sockets) if (s.data.view === sc.id) s.data.view = null;
      scenesChanged(); ok(ack);
    }));
    socket.on('scene:order', gmOnly((p, ack) => {
      const ids = Array.isArray(p.ids) ? p.ids.map((x) => str(x, 32)) : [];
      const byId = new Map(room.scenes.map((x) => [x.id, x]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      for (const sc of room.scenes) if (!ordered.includes(sc)) ordered.push(sc);
      room.scenes = ordered;
      scenesChanged(); ok(ack);
    }));
    /** GM: look at a scene without moving the players. */
    socket.on('scene:view', gmOnly((p, ack) => {
      const sc = p.id ? sceneById(room, str(p.id, 32)) : null;
      if (p.id && !sc) throw new Error('No such scene');
      socket.data.view = sc ? sc.id : null;
      socket.emit('scene', sceneFor(room, me()));
      sendSceneList(room); ok(ack);
    }));
    /** GM: move everyone to a scene. */
    socket.on('scene:activate', gmOnly((p, ack) => {
      const sc = sceneById(room, str(p.id, 32));
      if (!sc) throw new Error('No such scene');
      room.activeScene = sc.id;
      socket.data.view = null; // follow the players again
      updateExplored(sc);
      scenesChanged(); ok(ack);
    }));

    // ----- map & fog (GM, on the scene they're looking at) -----
    socket.on('map:update', gmOnly((p, ack) => {
      const sc = myScene();
      sc.map = cleanMap(p, sc.map);
      updateExplored(sc);
      sendScene(room); if ('image' in p) sendSceneList(room); save(room); ok(ack);
    }));
    socket.on('fog:op', gmOnly((p, ack) => {
      const sc = myScene();
      if (!['reveal', 'hide'].includes(p.type)) throw new Error('Bad fog op');
      const r = { x: num(p.x), y: num(p.y), w: num(p.w, 0, 0), h: num(p.h, 0, 0) };
      if (Array.isArray(p.poly)) {
        // freehand or polygon reveal: a list of points
        const pts = p.poly.slice(0, 2000).map((v) => num(v)).filter(Number.isFinite);
        if (pts.length < 6) throw new Error('Bad shape');
        sc.fog.ops.push({ type: p.type, poly: pts });
      } else sc.fog.ops.push({ type: p.type, ...r });
      if (sc.fog.ops.length > 2000) sc.fog.ops.splice(0, 500);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('fog:set', gmOnly((p, ack) => {
      const sc = myScene();
      if ('enabled' in p) sc.fog.mode = p.enabled ? (sc.fog.mode === 'off' ? 'manual' : sc.fog.mode) : 'off';
      if ('mode' in p) { if (!['off', 'manual', 'sight'].includes(p.mode)) throw new Error('Bad fog mode'); sc.fog.mode = p.mode; }
      if ('shared' in p) sc.fog.shared = !!p.shared;
      if ('radius' in p) sc.fog.radius = num(p.radius, 0, 0, 200);
      if (p.reset === 'hide-all') sc.fog.ops = [];
      if (p.reset === 'reveal-all') sc.fog.ops = [{ type: 'reveal', x: -1e6, y: -1e6, w: 2e6, h: 2e6 }];
      if (p.resetExplored) sc.fog.explored = null;
      if (p.undo) sc.fog.ops.pop();
      updateExplored(sc);
      sendScene(room); sendSceneList(room); save(room); ok(ack);
    }));

    // ----- walls and doors (GM draws them; anyone can open an unlocked door) -----
    const pt = (v) => (Array.isArray(v) ? [num(v[0], 0, -1e5, 1e5), num(v[1], 0, -1e5, 1e5)] : null);
    socket.on('wall:add', gmOnly((p, ack) => {
      const sc = myScene();
      const list = (Array.isArray(p.walls) ? p.walls : [p]).slice(0, 500);
      const ids = [];
      for (const w of list) {
        const a = pt(w.a), b = pt(w.b);
        if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
        if (sc.walls.length >= 5000) throw new Error('Too many walls on this scene');
        const wall = { id: uid(), a, b, kind: w.kind === 'door' ? 'door' : 'wall', open: false, locked: false };
        sc.walls.push(wall); ids.push(wall.id);
      }
      updateExplored(sc);
      sendScene(room); save(room); ok(ack, { ids });
    }));
    socket.on('wall:remove', gmOnly((p, ack) => {
      const sc = myScene();
      const ids = new Set((Array.isArray(p.ids) ? p.ids : [p.id]).map((x) => str(x, 32)));
      sc.walls = sc.walls.filter((w) => !ids.has(w.id));
      updateExplored(sc);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('wall:clear', gmOnly((p, ack) => {
      const sc = myScene();
      sc.walls = [];
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('wall:update', gmOnly((p, ack) => {
      const sc = myScene();
      const w = sc.walls.find((x) => x.id === p.id);
      if (!w) throw new Error('No such wall');
      if ('kind' in p) w.kind = p.kind === 'door' ? 'door' : 'wall';
      if ('locked' in p) w.locked = !!p.locked;
      if ('open' in p) w.open = !!p.open;
      updateExplored(sc);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('door:toggle', guard((p, ack) => {
      const sc = sceneOf(room, me());
      const w = sc.walls.find((x) => x.id === p.id && x.kind === 'door');
      if (!w) throw new Error('No such door');
      if (!me().isGM && w.locked) throw new Error('The door is locked');
      w.open = !w.open;
      updateExplored(sc);
      sendScene(room); save(room); ok(ack, { open: w.open });
    }));

    // ----- drawings (GM, and players when the scene allows it) -----
    const DRAW_KINDS = ['free', 'line', 'rect', 'ellipse', 'text', 'arrow'];
    socket.on('draw:add', guard((p, ack) => {
      const sc = sceneOf(room, me());
      if (!me().isGM && !sc.playerDraw) throw new Error('The GM has turned off drawing for players');
      if (!DRAW_KINDS.includes(p.kind)) throw new Error('Bad drawing');
      if (sc.drawings.length >= 3000) throw new Error('Too many drawings on this scene — clear some first');
      const pts = (Array.isArray(p.pts) ? p.pts : []).slice(0, 4000).map((v) => num(v, 0, -1e5, 1e5));
      if (pts.length < 2 || pts.length % 2) throw new Error('Bad drawing');
      const d = {
        id: uid(), kind: p.kind, pts,
        color: okColor(p.color) || '#e8a33d',
        width: num(p.width, 4, 1, 60),
        fill: !!p.fill,
        text: p.kind === 'text' ? str(p.text, 300) : undefined,
        size: p.kind === 'text' ? num(p.size, 28, 8, 400) : undefined,
        gmOnly: !!(me().isGM && p.gmOnly),
        author: me().name,
      };
      if (d.kind === 'text' && !d.text.trim()) throw new Error('Type some text');
      sc.drawings.push(d);
      sendScene(room); save(room); ok(ack, { id: d.id });
    }));
    socket.on('draw:remove', guard((p, ack) => {
      const sc = sceneOf(room, me());
      const ids = new Set((Array.isArray(p.ids) ? p.ids : [p.id]).map((x) => str(x, 32)));
      const before = sc.drawings.length;
      sc.drawings = sc.drawings.filter((d) => !(ids.has(d.id) && (me().isGM || d.author === me().name)));
      if (sc.drawings.length === before) throw new Error("Nothing of yours to erase there");
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('draw:clear', guard((p, ack) => {
      const sc = sceneOf(room, me());
      const mineOnly = !me().isGM || p.mine;
      sc.drawings = sc.drawings.filter((d) => (mineOnly ? d.author !== me().name : false));
      sendScene(room); save(room); ok(ack);
    }));

    // ----- tokens -----
    socket.on('token:add', gmOnly((p, ack) => {
      const sc = myScene();
      const t = cleanToken({ size: 1, color: '#c0392b', label: '', owners: [], hidden: false, image: null, sheetId: null, ...p }, { id: uid() });
      sc.tokens.push(t);
      updateExplored(sc);
      sendScene(room); save(room); ok(ack, { id: t.id });
    }));
    // drag a character sheet onto the map: a token linked to it (players can place their own sheet)
    socket.on('token:from-sheet', guard((p, ack) => {
      const sheet = room.sheets.find((x) => x.id === p.sheetId);
      if (!sheet) throw new Error('No such sheet');
      if (!me().isGM && sheet.owner !== me().name) throw new Error("You can only place your own character");
      const sc = sceneOf(room, me());
      if (!me().isGM && sc.tokens.some((t) => t.sheetId === sheet.id)) throw new Error("Your character's already on this map");
      const d = sheet.data || {};
      const playerSheet = !(me().isGM && sheet.owner === me().name); // the GM's own sheets are NPCs
      const t = cleanToken({
        x: p.x, y: p.y, size: num(p.size, 1, 0.25, 20), label: str(d.name || 'Unnamed', 40),
        color: playerSheet ? colorFor(sheet.owner) : '#8e44ad', image: okImage(d.portrait) || null,
        owners: playerSheet ? [sheet.owner] : [], hidden: false, sheetId: sheet.id,
        bar: p.bar && typeof p.bar === 'object' ? p.bar : null,
      }, { id: uid() });
      sc.tokens.push(t);
      updateExplored(sc);
      sendScene(room); sendSceneList(room); save(room); ok(ack, { id: t.id });
    }));
    socket.on('token:move', guard((p, ack) => {
      const { sc, t } = findToken(room, p.id);
      if (!t) throw new Error('No such token');
      if (!canMoveToken(t, me())) throw new Error("That's not your token");
      if (!me().isGM && sc.id !== room.activeScene) throw new Error('That token is on another scene');
      const x = num(p.x, t.x), y = num(p.y, t.y);
      // with line of sight on, players can't walk through walls or closed doors
      if (!me().isGM && sc.fog.mode === 'sight') {
        const g = sc.map.gridSize, half = (t.size * g) / 2;
        if (V.crossesWall([t.x + half, t.y + half], [x + half, y + half], sc)) {
          sendScene(room); // put it back where it was on their screen
          throw new Error("There's a wall in the way");
        }
      }
      t.x = x; t.y = y;
      if (p.final && updateExplored(sc)) { /* explored map changed */ }
      sendScene(room); if (p.final) save(room); ok(ack);
    }));
    socket.on('token:update', guard((p, ack) => {
      const { sc, t } = findToken(room, p.id);
      if (!t) throw new Error('No such token');
      // players may only update the bar on their own tokens
      if (!me().isGM) {
        if (!canMoveToken(t, me())) throw new Error("That's not your token");
        if (p.patch && p.patch.bar !== undefined) Object.assign(t, cleanToken({ bar: p.patch.bar }, t));
      } else {
        Object.assign(t, cleanToken(p.patch || {}, t));
      }
      updateExplored(sc);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('token:remove', gmOnly((p, ack) => {
      for (const sc of room.scenes) sc.tokens = sc.tokens.filter((t) => t.id !== p.id);
      sendScene(room); sendSceneList(room); save(room); ok(ack);
    }));
    socket.on('token:order', gmOnly((p, ack) => {
      const { sc } = findToken(room, p.id);
      if (!sc) throw new Error('No such token');
      const i = sc.tokens.findIndex((t) => t.id === p.id);
      const [t] = sc.tokens.splice(i, 1);
      if (p.to === 'front') sc.tokens.push(t); else sc.tokens.unshift(t);
      sendScene(room); save(room); ok(ack);
    }));

    socket.on('ping', guard((p) => {
      const where = sceneOf(room, me()).id;
      const ping = { x: num(p.x), y: num(p.y), color: me().color, name: me().name };
      for (const s of room.sockets) if (sceneOf(room, s.data).id === where) s.emit('ping', ping);
    }));

    // ----- sheets -----
    socket.on('sheet:create', guard((p, ack) => {
      const owner = me().isGM && typeof p.owner === 'string' ? cleanName(p.owner) : me().name;
      const sheet = {
        id: uid(), owner, shared: !!p.shared,
        system: str(p.system, 20) || 'generic',
        data: cleanSheetData(p.data || {}),
        updated: Date.now(),
      };
      room.sheets.push(sheet);
      sendSheets(room); save(room); ok(ack, { id: sheet.id });
    }));
    socket.on('sheet:update', guard((p, ack) => {
      const s = room.sheets.find((x) => x.id === p.id);
      if (!s) throw new Error('No such sheet');
      if (!canEditSheet(s, me())) throw new Error("You can't edit that sheet");
      if ('data' in p) s.data = cleanSheetData(p.data);
      if ('shared' in p) s.shared = !!p.shared;
      if (me().isGM && typeof p.owner === 'string') s.owner = cleanName(p.owner);
      s.updated = Date.now();
      // keep linked token bars in step with HP-style fields the sheet reports
      if (p.bar && typeof p.bar === 'object') {
        for (const t of allTokens(room)) if (t.sheetId === s.id) t.bar = { cur: num(p.bar.cur), max: num(p.bar.max) };
        sendScene(room);
      }
      sendSheets(room); save(room); ok(ack, { updated: s.updated });
    }));
    socket.on('sheet:delete', guard((p, ack) => {
      const s = room.sheets.find((x) => x.id === p.id);
      if (!s) throw new Error('No such sheet');
      if (!canEditSheet(s, me())) throw new Error("You can't delete that sheet");
      room.sheets = room.sheets.filter((x) => x !== s);
      for (const t of allTokens(room)) if (t.sheetId === s.id) t.sheetId = null;
      sendSheets(room); sendScene(room); save(room); ok(ack);
    }));

    // ----- chat & rolls -----
    const visibilityFrom = (v) => (v === 'gm' ? 'gm' : 'all');

    socket.on('chat:send', guard((p, ack) => {
      const text = str(p.text, 2000).trim();
      if (!text) throw new Error('Empty message');
      let to = [];
      let visibility = 'all';
      if (Array.isArray(p.to) && p.to.length) { to = p.to.map(cleanName).filter(Boolean).slice(0, 10); visibility = 'whisper'; }
      postMessage(room, { kind: 'text', from: me().name, color: me().color, isGM: me().isGM, text, to, visibility });
      ok(ack);
    }));

    socket.on('roll:digital', guard(async (p, ack) => {
      const result = await rollExpression(str(p.expr, 120), secureRoll);
      postMessage(room, {
        kind: 'roll', from: me().name, color: me().color, isGM: me().isGM,
        label: str(p.label, 80), meta: cleanMeta(p.meta), result, source: 'digital',
        visibility: visibilityFrom(p.visibility),
      });
      ok(ack, { total: result.total });
    }));

    socket.on('roll:physical', guard((p, ack) => {
      const result = sanitizeResult(p.result);
      if (p.meta?.pushOf) {
        const orig = room.chat.find((x) => x.id === p.meta.pushOf);
        if (!orig || orig.from !== me().name || !orig.meta?.pushable || room.chat.some((x) => x.meta?.pushOf === orig.id)) throw new Error("Can't push that roll");
      }
      const sources = (Array.isArray(p.sources) ? p.sources : []).filter((s) => ['godice', 'manual', 'digital'].includes(s));
      postMessage(room, {
        kind: 'roll', from: me().name, color: me().color, isGM: me().isGM,
        label: str(p.label, 80), meta: cleanMeta(p.meta), result,
        source: sources.length === 1 ? sources[0] : 'mixed', sources,
        visibility: visibilityFrom(p.visibility),
      });
      ok(ack);
    }));

    // ----- push a roll (Call of Cthulhu: roll again; Year Zero: re-roll every die that isn't a success) -----
    socket.on('roll:push', guard(async (p, ack) => {
      const m = room.chat.find((x) => x.id === p.id);
      if (!m || m.kind !== 'roll') throw new Error('No such roll');
      if (m.from !== me().name) throw new Error('You can only push your own rolls');
      if (!m.meta?.pushable) throw new Error("That roll can't be pushed");
      if (m.meta.pushed || room.chat.some((x) => x.meta?.pushOf === m.id)) throw new Error('Already pushed');
      const result = m.meta.pushable === 'yze' ? await pushPool(m.result, secureRoll) : await rollExpression(m.result.expr, secureRoll);
      postMessage(room, {
        kind: 'roll', from: me().name, color: me().color, isGM: me().isGM,
        label: `${m.label || 'Roll'} — pushed`, meta: { ...m.meta, pushed: true, pushOf: m.id }, result, source: 'digital',
        visibility: m.visibility === 'gm' ? 'gm' : 'all',
      });
      ok(ack, { total: result.total });
    }));

    // ----- campaign settings -----
    socket.on('settings:update', gmOnly((p, ack) => {
      if ('ruleset' in p) {
        if (!RULESETS[p.ruleset]) throw new Error('Unknown ruleset');
        const first = !room.settings.ruleset;
        room.settings.ruleset = p.ruleset;
        // a brand-new campaign gets the ruleset's usual grid scale
        if (first) for (const sc of room.scenes) if (!sc.map.image) Object.assign(sc.map, RULESETS[p.ruleset].grid);
        sendScene(room);
        // initiative from another game's method no longer means anything
        if (!first) for (const e of room.combat.entries) { e.init = null; e.initLabel = null; }
        room.combat.deck = null;
        sortEntries(room.combat, p.ruleset);
        sendCombat(room);
      }
      sendSettings(room); save(room); ok(ack);
    }));

    // ----- combat tracker -----
    const ruleset = () => room.settings.ruleset || 'generic';
    const dieRoll = (sides) => crypto.randomInt(1, sides + 1);
    const combatChanged = () => { sendCombat(room); save(room); };
    const combatLog = (lines, title) => {
      if (lines.length) postMessage(room, { kind: 'text', from: title || 'Combat', color: '#e8a33d', isGM: true, text: lines.join('\n'), visibility: 'gm' });
    };
    const entryById = (id) => {
      const e = room.combat.entries.find((x) => x.id === id);
      if (!e) throw new Error('No such combatant');
      return e;
    };
    // a player controls an entry if they own its token or its sheet
    const controls = (e) => me().isGM
      || (e.tokenId && allTokens(room).some((t) => t.id === e.tokenId && (t.owners || []).includes(me().name)))
      || (e.sheetId && room.sheets.some((s) => s.id === e.sheetId && s.owner === me().name));

    socket.on('combat:add', gmOnly((p, ack) => {
      const list = (Array.isArray(p.entries) ? p.entries : [p]).slice(0, 50);
      const ids = [];
      for (const raw of list) {
        if (raw.tokenId && room.combat.entries.some((e) => e.tokenId === raw.tokenId)) continue; // already in
        const e = newEntry(raw);
        room.combat.entries.push(e);
        ids.push(e.id);
        syncTokenBar(room, e);
      }
      if (room.combat.active && ids.length) {
        const kind = RULESETS[ruleset()].init.kind;
        if (kind !== 'roll') combatLog(rollInitiative(room.combat, ruleset(), dieRoll, { only: ids }));
      }
      sortEntries(room.combat, ruleset());
      combatChanged(); ok(ack, { ids });
    }));
    socket.on('combat:update', guard((p, ack) => {
      const e = entryById(str(p.id, 16));
      if (!me().isGM) throw new Error('GM only');
      Object.assign(e, cleanEntry(p.patch || {}, e));
      if (p.patch && 'init' in p.patch) sortEntries(room.combat, ruleset());
      syncTokenBar(room, e);
      combatChanged(); ok(ack);
    }));
    // players set their own initiative (after rolling it, perhaps with GoDice)
    socket.on('combat:set-init', guard((p, ack) => {
      const e = entryById(str(p.id, 16));
      if (!controls(e)) throw new Error("That isn't your combatant");
      e.init = num(p.value, 0, -1000, 1000);
      e.initLabel = null;
      sortEntries(room.combat, ruleset());
      combatChanged(); ok(ack);
    }));
    socket.on('combat:damage', guard((p, ack) => {
      const e = entryById(str(p.id, 16));
      if (!me().isGM) throw new Error('GM only');
      if (!e.hp) throw new Error('No hit points to change');
      let amt = Math.round(num(p.amount, 0, -100000, 100000));
      if (amt > 0 && e.hp.temp) { const t = Math.min(e.hp.temp, amt); e.hp.temp -= t; amt -= t; } // temp HP soak damage first
      e.hp.cur = Math.min(e.hp.max, e.hp.cur - amt);
      syncTokenBar(room, e);
      combatChanged(); ok(ack, { hp: e.hp });
    }));
    socket.on('combat:remove', gmOnly((p, ack) => {
      const i = room.combat.entries.findIndex((x) => x.id === p.id);
      if (i < 0) throw new Error('No such combatant');
      room.combat.entries.splice(i, 1);
      if (room.combat.turn > i || room.combat.turn >= room.combat.entries.length) room.combat.turn = Math.max(0, room.combat.turn - 1);
      combatChanged(); ok(ack);
    }));
    socket.on('combat:roll', gmOnly((p, ack) => {
      const lines = rollInitiative(room.combat, ruleset(), dieRoll, { only: Array.isArray(p.ids) ? p.ids : null, all: !!p.all });
      combatLog(lines, 'Initiative');
      combatChanged(); ok(ack);
    }));
    socket.on('combat:start', gmOnly((p, ack) => {
      const c = room.combat;
      if (!c.entries.length) throw new Error('Add some combatants first');
      const kind = RULESETS[ruleset()].init.kind;
      if (kind !== 'roll') combatLog(rollInitiative(c, ruleset(), dieRoll, { all: true }), 'Initiative');
      else if (c.entries.some((e) => e.init == null && e.side === 'npc')) {
        combatLog(rollInitiative(c, ruleset(), dieRoll, { only: c.entries.filter((e) => e.init == null && e.side === 'npc').map((e) => e.id) }), 'Initiative');
      }
      c.active = true; c.round = 1; c.turn = 0;
      sortEntries(c, ruleset()); c.turn = 0;
      postMessage(room, { kind: 'text', from: 'Combat', color: '#e8a33d', isGM: true, text: 'Combat begins — round 1', visibility: 'all' });
      combatChanged(); ok(ack);
    }));
    socket.on('combat:next', guard((p, ack) => {
      const c = room.combat;
      if (!c.active) throw new Error('Combat has not started');
      // the GM, or the player whose turn it is, can end the turn
      if (!me().isGM && !(c.entries[c.turn] && controls(c.entries[c.turn]))) throw new Error("It isn't your turn");
      const lines = nextTurn(c, ruleset(), dieRoll, p.dir === -1 && me().isGM ? -1 : 1);
      // everyone sees the new round; the details (cards dealt, conditions ending) go to the GM
      const round = lines.filter((l) => /^Round \d+$/.test(l));
      const rest = lines.filter((l) => !/^Round \d+$/.test(l));
      if (round.length) postMessage(room, { kind: 'text', from: 'Combat', color: '#e8a33d', isGM: true, text: round.join('\n'), visibility: 'all' });
      combatLog(rest);
      combatChanged(); ok(ack);
    }));
    socket.on('combat:end', gmOnly((p, ack) => {
      const c = room.combat;
      c.active = false; c.round = 0; c.turn = 0; c.deck = null;
      for (const e of c.entries) { e.init = null; e.initLabel = null; e.conditions = []; }
      if (p.removeNpcs) c.entries = c.entries.filter((e) => e.side === 'pc');
      if (p.clearAll) c.entries = [];
      postMessage(room, { kind: 'text', from: 'Combat', color: '#e8a33d', isGM: true, text: 'Combat ends', visibility: 'all' });
      combatChanged(); ok(ack);
    }));

    // ----- story notes -----
    socket.on('notes:create', guard((p, ack) => {
      const n = { id: uid(), owner: me().isGM ? '' : me().name, created: Date.now(), ...cleanNote({ title: 'Untitled', body: '', folder: '', share: 'none', ...p }) };
      if (room.notes.length >= 2000) throw new Error('Too many notes');
      room.notes.push(n);
      n.updated = Date.now();
      sendNotes(room); save(room); ok(ack, { id: n.id });
    }));
    // GM: make many notes at once (scenario prep)
    socket.on('notes:create-many', gmOnly((p, ack) => {
      const list = (Array.isArray(p.notes) ? p.notes : []).slice(0, 700);
      if (room.notes.length + list.length > 2000) throw new Error(`That would be more than 2000 notes — untick some sections`);
      const ids = [];
      for (const raw of list) {
        const n = { id: uid(), owner: '', created: Date.now(), updated: Date.now(), ...cleanNote({ title: 'Untitled', body: '', folder: '', share: 'none', ...raw }) };
        room.notes.push(n);
        ids.push(n.id);
      }
      sendNotes(room); save(room); ok(ack, { ids });
    }));
    socket.on('notes:update', guard((p, ack) => {
      const n = room.notes.find((x) => x.id === p.id);
      if (!n || !noteVisible(n, me())) throw new Error('No such note');
      if (!noteEditable(n, me())) throw new Error("You can't edit that note");
      Object.assign(n, cleanNote(p, n));
      n.updated = Date.now();
      sendNotes(room); save(room); ok(ack, { updated: n.updated });
    }));
    socket.on('notes:delete', guard((p, ack) => {
      const n = room.notes.find((x) => x.id === p.id);
      if (!n || !noteEditable(n, me())) throw new Error("You can't delete that note");
      room.notes = room.notes.filter((x) => x !== n);
      sendNotes(room); save(room); ok(ack);
    }));
    // GM: share a note with everyone and say so in chat
    socket.on('notes:reveal', gmOnly((p, ack) => {
      const n = room.notes.find((x) => x.id === p.id);
      if (!n) throw new Error('No such note');
      n.share = 'all'; n.updated = Date.now();
      sendNotes(room);
      postMessage(room, { kind: 'note', from: me().name, color: me().color, isGM: true, noteId: n.id, text: n.title, visibility: 'all' });
      save(room); ok(ack);
    }));

    // ----- audio -----
    const audioDone = (ack) => { sendAudio(room); save(room); ok(ack); };
    socket.on('audio:track', gmOnly((p, ack) => {
      const t = SB.trackById(room.audio, str(p.id, 32));
      if (!t) throw new Error('No such track');
      const was = t.kind;
      Object.assign(t, SB.cleanTrack({ ...t, ...(p.name !== undefined && { name: p.name }), ...(p.kind !== undefined && { kind: p.kind }), ...(p.volume !== undefined && { volume: p.volume }), ...(p.duration !== undefined && !t.duration && { duration: p.duration }) }));
      if (was !== t.kind) {
        if (was === 'ambience') SB.setAmbience(room.audio, t.id, false);
        if (was === 'music' && room.audio.music.trackId === t.id) { SB.stopMusic(room.audio); room.audio.music.trackId = null; }
      }
      audioDone(ack);
    }));
    socket.on('audio:delete', gmOnly((p, ack) => {
      const t = SB.removeTrack(room.audio, str(p.id, 32));
      if (!t) throw new Error('No such track');
      // the file has a random name used only by this track
      if (/^\/uploads\/[a-f0-9]{24}\.[a-z0-9]{2,5}$/.test(t.url)) fs.rm(path.join(UPLOAD_DIR, path.basename(t.url)), { force: true }, () => {});
      audioDone(ack);
    }));
    socket.on('audio:music', gmOnly((p, ack) => {
      const a = room.audio;
      const now = Date.now();
      switch (p.action) {
        case 'play': SB.playMusic(a, str(p.id, 32), now, num(p.at, 0, 0, 86400)); break;
        case 'pause': SB.pauseMusic(a, now); break;
        case 'resume': SB.resumeMusic(a, now); break;
        case 'stop': SB.stopMusic(a); break;
        case 'seek': SB.seekMusic(a, num(p.at, 0, 0, 86400), now); break;
        case 'next': { const id = SB.nextMusicId(a); if (id) SB.playMusic(a, id, now); break; }
        case 'prev': { const id = SB.prevMusicId(a); if (id) SB.playMusic(a, id, now); break; }
        case 'repeat': { const pos = SB.musicPosition(a, now); a.music.repeat = SB.REPEATS.includes(p.value) ? p.value : 'all'; if (a.music.playing) SB.seekMusic(a, pos, now); else a.music.offset = pos; break; }
        case 'shuffle': a.music.shuffle = !!p.value; break;
        case 'volume': a.music.volume = num(p.value, 0.8, 0, 1); break;
        default: throw new Error('Unknown action');
      }
      audioDone(ack);
    }));
    socket.on('audio:ambience', gmOnly((p, ack) => {
      SB.setAmbience(room.audio, str(p.id, 32), !!p.on);
      audioDone(ack);
    }));
    socket.on('audio:stop-all', gmOnly((p, ack) => {
      SB.stopMusic(room.audio);
      room.audio.ambience = [];
      audioDone(ack);
    }));
    socket.on('audio:effect', gmOnly((p, ack) => {
      const t = SB.trackById(room.audio, str(p.id, 32));
      if (!t) throw new Error('No such track');
      io.to(room.id).emit('audio:effect', { id: t.id, url: t.url, volume: t.volume, name: t.name });
      ok(ack);
    }));

    // ----- props -----
    socket.on('prop:show', gmOnly((p, ack) => {
      const c = props.get(str(p.coll, 60));
      if (!c) throw new Error('No such prop');
      const file = str(p.file, 300) || 'index.html';
      if (!props.resolve(c, file)) throw new Error('No such page in that prop');
      const to = Array.isArray(p.to) ? p.to.map(cleanName).filter(Boolean).slice(0, 20) : [];
      const shares = (room.propShares[c.id] ||= {});
      const cur = shares[file];
      if (!to.length) shares[file] = 'all';
      else if (cur !== 'all') shares[file] = [...new Set([...(Array.isArray(cur) ? cur : []), ...to])];
      const page = props.pages(c).find((x) => x.file === file);
      postMessage(room, { kind: 'prop', from: me().name, color: me().color, isGM: true, coll: c.id, file, title: page?.title || file, text: page?.title || file, to, visibility: to.length ? 'whisper' : 'all' });
      sendProps(room); save(room); ok(ack);
    }));
    socket.on('prop:unshare', gmOnly((p, ack) => {
      const id = str(p.coll, 60);
      if (p.file) { if (room.propShares[id]) delete room.propShares[id][str(p.file, 300)]; }
      else delete room.propShares[id];
      sendProps(room); save(room); ok(ack);
    }));
    socket.on('prop:reset', gmOnly((p, ack) => {
      const id = str(p.coll, 60);
      room.propState[id] = { state: {}, version: (room.propState[id]?.version || 0) + 1 };
      for (const r of room.propStreams.get(id) || []) r.write('event: reset\ndata: {}\n\n');
      save(room); ok(ack);
    }));
    socket.on('prop:delete', gmOnly((p, ack) => {
      props.remove(str(p.coll, 60));
      for (const r of rooms.values()) sendProps(r);
      ok(ack);
    }));

    // ----- PDF library -----
    socket.on('library:update', gmOnly((p, ack) => {
      library.update(str(p.id, 32), room.id, {
        title: typeof p.title === 'string' ? p.title : undefined,
        ...('share' in p ? { share: p.share === 'all' ? 'all' : Array.isArray(p.share) ? p.share.map(cleanName) : null } : {}),
      });
      ok(ack);
    }));
    socket.on('library:delete', gmOnly((p, ack) => { library.remove(str(p.id, 32)); ok(ack); }));
    socket.on('library:reindex', gmOnly((p, ack) => { library.index(str(p.id, 32)); ok(ack); }));
    // scenario prep: analyse in the background, report progress, say when it's ready
    socket.on('library:analyse', gmOnly((p, ack) => {
      const id = str(p.id, 32);
      const doc = library.get(id);
      if (!doc) throw new Error('No such PDF');
      if (doc.status !== 'ready') throw new Error('Wait until the PDF has finished indexing');
      if (!p.force && library.scenario(id)) return ok(ack, { state: 'ready' });
      if (p.force) fs.rm(library.scenarioPath(doc), { force: true }, () => {});
      let last = 0;
      library.analyse(id, {
        onProgress: (done, total) => {
          if (Date.now() - last < 300 && done < total) return;
          last = Date.now();
          socket.emit('scenario:progress', { id, done, total });
        },
      }).then(() => socket.emit('scenario:ready', { id }), (e) => socket.emit('scenario:error', { id, error: e?.message || String(e) }));
      ok(ack, { state: 'working' });
    }));
    socket.on('library:search', guard((p, ack) => {
      const r = library.search(str(p.q, 200), room.id, me(), p.docId ? str(p.docId, 32) : undefined);
      ok(ack, r);
    }));
    // GM shows a page (rendered to an image in their browser) to the table
    socket.on('handout:show', gmOnly((p, ack) => {
      const image = okImage(p.image);
      if (!image) throw new Error('Bad image');
      postMessage(room, {
        kind: 'handout', from: me().name, color: me().color, isGM: true,
        image, caption: str(p.caption, 160), width: num(p.width, 0, 0, 20000), height: num(p.height, 0, 0, 20000),
      });
      ok(ack);
    }));

    socket.on('chat:clear', gmOnly((p, ack) => {
      room.chat = [];
      for (const s of room.sockets) s.emit('chat:history', []);
      save(room); ok(ack);
    }));
  });

  function cleanMeta(m) {
    if (!m || typeof m !== 'object') return {};
    const out = {};
    if (m.check && typeof m.check === 'object') {
      const type = ['effect', 'raises', 'beat', 'pct', 'succ', 'dc'].includes(m.check.type) ? m.check.type : null;
      if (type) out.check = { type, target: num(m.check.target, 8, -100, 1000) };
      if (type === 'pct' && ['regular', 'hard', 'extreme'].includes(m.check.need)) out.check.need = m.check.need;
    }
    if (m.cprDamage) out.cprDamage = true;
    if (['coc', 'yze'].includes(m.pushable)) out.pushable = m.pushable;
    if (m.pushed) out.pushed = true;
    if (typeof m.pushOf === 'string') out.pushOf = m.pushOf.slice(0, 32);
    if (m.initiative) out.initiative = true;
    if (m.sheetName) out.sheetName = str(m.sheetName, 60);
    if (m.note) out.note = str(m.note, 120);
    if (m.flavour && typeof m.flavour === 'object') {
      out.flavour = { name: str(m.flavour.name, 60), weapon: str(m.flavour.weapon, 60), skill: str(m.flavour.skill, 60), power: str(m.flavour.power, 60) };
    }
    return out;
  }


  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      const port = server.address().port;
      log(`\n  Lantern VTT running on http://localhost:${port}`);
      log(`  Data folder: ${DATA_DIR}`);
      log(`  GM password: ${opts.gmPassword || process.env.GM_PASSWORD ? '(as configured)' : GM_PASSWORD}\n`);
      resolve({
        port,
        dataDir: DATA_DIR,
        gmPassword: GM_PASSWORD,
        // flush pending saves, then stop accepting and drop live connections
        close: () => new Promise((done) => {
          for (const room of rooms.values()) {
            if (room.saveTimer) {
              clearTimeout(room.saveTimer);
              try { fs.writeFileSync(path.join(ROOMS_DIR, `${room.id}.json`), JSON.stringify(persisted(room))); } catch {}
            }
          }
          io.close();
          for (const c of sockets) c.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

// Run directly: `node server.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(async (srv) => {
    // `npm start -- --share` (or SHARE=1): also put the server online with a Cloudflare quick tunnel
    if (!process.argv.includes('--share') && !/^(1|true|yes)$/i.test(process.env.SHARE || '')) return;
    const { findCloudflared, downloadCloudflared, startTunnel } = await import('./tunnel.js');
    const binDir = path.join(srv.dataDir, 'bin');
    try {
      let bin = findCloudflared(binDir);
      if (!bin) { console.log('  Downloading Cloudflare\'s tunnel program (first time only)…'); bin = await downloadCloudflared(binDir); }
      console.log('  Asking Cloudflare for a link…');
      const t = await startTunnel(bin, srv.port);
      console.log(`\n  Shared online: ${t.url}\n  Anyone with this link can join as a player — only send it to your group.\n`);
      t.onExit(() => console.log('\n  The online link stopped working. Restart with --share for a new one.\n'));
      for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { t.stop(); process.exit(0); });
    } catch (e) {
      console.error(`  Couldn't share online: ${e.message}`);
    }
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
