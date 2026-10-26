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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  function freshRoom(id) {
    return {
      id,
      scene: {
        map: {
          image: null, width: 2800, height: 2100,
          gridSize: 70, offsetX: 0, offsetY: 0, showGrid: true,
          gridColor: '#000000', gridOpacity: 0.3, unitsPerSquare: 1.5, unitName: 'm',
        },
        tokens: [],
        fog: { enabled: false, ops: [] },
      },
      sheets: [],
      chat: [],
      settings: { ruleset: null },
      combat: freshCombat(),
      notes: [],
    };
  }
  const persisted = ({ id, scene, sheets, chat, settings, combat, notes }) => ({ id, scene, sheets, chat, settings, combat, notes });

  function getRoom(id) {
    if (rooms.has(id)) return rooms.get(id);
    const file = path.join(ROOMS_DIR, `${id}.json`);
    let room;
    try {
      room = { ...freshRoom(id), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      room = freshRoom(id);
    }
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
  const sceneFor = (room, viewer) => ({
    ...room.scene,
    tokens: viewer.isGM ? room.scene.tokens : room.scene.tokens.filter((t) => !t.hidden),
  });
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
    const users = [...room.sockets].map((s) => ({ name: s.data.name, isGM: s.data.isGM, color: s.data.color }));
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
  function sendSettings(room) {
    for (const s of room.sockets) s.emit('settings', { ...room.settings, rulesets: Object.fromEntries(Object.entries(RULESETS).map(([k, v]) => [k, v.name])) });
  }
  // keep a combatant's token health bar in step with the tracker
  function syncTokenBar(room, e) {
    if (!e.tokenId || !e.hp || e.sheetId) return;
    const t = room.scene.tokens.find((x) => x.id === e.tokenId);
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
  const require = createRequire(import.meta.url);
  const PDFJS_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'));
  app.use('/pdfjs', express.static(PDFJS_DIR, { maxAge: '7d' }));
  app.use('/vendor', express.static(VENDOR_DIR));
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

  app.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (limit ${LIBRARY_MAX_MB} MB)` });
    res.status(400).json({ error: err.message || 'Upload failed' });
  });

  const server = http.createServer(app);
  const sockets = new Set();
  server.on('connection', (c) => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  const io = new Server(server, { maxHttpBufferSize: 1e6 });

  const PLAYER_COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#6d9dc5', '#c77dff', '#ef476f', '#06d6a0', '#ffd166'];
  const colorFor = (name) => PLAYER_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PLAYER_COLORS.length];

  const secureRoll = async (sides) => crypto.randomInt(1, sides + 1);

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
      if (room) { room.sockets.delete(socket); socket.leave(room.id); }
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
      ok(ack, { name, isGM: wantsGM, color: socket.data.color, uploadToken });
      socket.emit('scene', sceneFor(room, me()));
      socket.emit('sheets', sheetsFor(room, me()));
      socket.emit('chat:history', room.chat.filter((m) => canSeeMsg(m, me())));
      socket.emit('library', library.listFor(room.id, me()));
      socket.emit('combat', combatFor(room.combat, me()));
      socket.emit('notes', room.notes.filter((n) => noteVisible(n, me())));
      sendSettings(room);
      sendPresence(room);
    });

    socket.on('disconnect', () => {
      if (!room) return;
      room.sockets.delete(socket);
      const t = uploadTokens.get(socket.data?.uploadToken);
      if (t) {
        const tok = socket.data.uploadToken;
        t.expiry = setTimeout(() => uploadTokens.delete(tok), 10 * 60 * 1000);
        t.expiry.unref?.();
      }
      sendPresence(room);
    });

    // ----- map & fog (GM) -----
    socket.on('map:update', gmOnly((p, ack) => {
      room.scene.map = cleanMap(p, room.scene.map);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('fog:op', gmOnly((p, ack) => {
      if (!['reveal', 'hide'].includes(p.type)) throw new Error('Bad fog op');
      const r = { x: num(p.x), y: num(p.y), w: num(p.w, 0, 0), h: num(p.h, 0, 0) };
      room.scene.fog.ops.push({ type: p.type, ...r });
      if (room.scene.fog.ops.length > 2000) room.scene.fog.ops.splice(0, 500);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('fog:set', gmOnly((p, ack) => {
      if ('enabled' in p) room.scene.fog.enabled = !!p.enabled;
      if (p.reset === 'hide-all') room.scene.fog.ops = [];
      if (p.reset === 'reveal-all') room.scene.fog.ops = [{ type: 'reveal', x: -1e6, y: -1e6, w: 2e6, h: 2e6 }];
      if (p.undo) room.scene.fog.ops.pop();
      sendScene(room); save(room); ok(ack);
    }));

    // ----- tokens -----
    socket.on('token:add', gmOnly((p, ack) => {
      const t = cleanToken({ size: 1, color: '#c0392b', label: '', owners: [], hidden: false, image: null, sheetId: null, ...p }, { id: uid() });
      room.scene.tokens.push(t);
      sendScene(room); save(room); ok(ack, { id: t.id });
    }));
    socket.on('token:move', guard((p, ack) => {
      const t = room.scene.tokens.find((x) => x.id === p.id);
      if (!t) throw new Error('No such token');
      if (!canMoveToken(t, me())) throw new Error("That's not your token");
      t.x = num(p.x, t.x); t.y = num(p.y, t.y);
      sendScene(room); if (p.final) save(room); ok(ack);
    }));
    socket.on('token:update', guard((p, ack) => {
      const t = room.scene.tokens.find((x) => x.id === p.id);
      if (!t) throw new Error('No such token');
      // players may only update the bar on their own tokens
      if (!me().isGM) {
        if (!canMoveToken(t, me())) throw new Error("That's not your token");
        if (p.patch && p.patch.bar !== undefined) Object.assign(t, cleanToken({ bar: p.patch.bar }, t));
      } else {
        Object.assign(t, cleanToken(p.patch || {}, t));
      }
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('token:remove', gmOnly((p, ack) => {
      room.scene.tokens = room.scene.tokens.filter((t) => t.id !== p.id);
      sendScene(room); save(room); ok(ack);
    }));
    socket.on('token:order', gmOnly((p, ack) => {
      const i = room.scene.tokens.findIndex((t) => t.id === p.id);
      if (i < 0) throw new Error('No such token');
      const [t] = room.scene.tokens.splice(i, 1);
      if (p.to === 'front') room.scene.tokens.push(t); else room.scene.tokens.unshift(t);
      sendScene(room); save(room); ok(ack);
    }));

    socket.on('ping', guard((p) => {
      io.to(room.id).emit('ping', { x: num(p.x), y: num(p.y), color: me().color, name: me().name });
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
        for (const t of room.scene.tokens) if (t.sheetId === s.id) t.bar = { cur: num(p.bar.cur), max: num(p.bar.max) };
        sendScene(room);
      }
      sendSheets(room); save(room); ok(ack, { updated: s.updated });
    }));
    socket.on('sheet:delete', guard((p, ack) => {
      const s = room.sheets.find((x) => x.id === p.id);
      if (!s) throw new Error('No such sheet');
      if (!canEditSheet(s, me())) throw new Error("You can't delete that sheet");
      room.sheets = room.sheets.filter((x) => x !== s);
      for (const t of room.scene.tokens) if (t.sheetId === s.id) t.sheetId = null;
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
        if (first && !room.scene.map.image) Object.assign(room.scene.map, RULESETS[p.ruleset].grid);
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
      || (e.tokenId && room.scene.tokens.some((t) => t.id === e.tokenId && (t.owners || []).includes(me().name)))
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
  startServer().catch((e) => { console.error(e.message); process.exit(1); });
}
