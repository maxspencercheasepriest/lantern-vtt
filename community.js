// The community side of Lantern Server (logins on): the marketplace of modules, each person's library and
// character vault, and looking-for-group listings. Everything is kept as JSON in DATA_DIR; the pictures, music
// and PDFs a module uses stay where they already are (uploads/ and library/) and are only copied on export.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Zip, ZipPassThrough, ZipDeflate, Unzip, UnzipInflate } from 'fflate';

const newId = () => crypto.randomBytes(6).toString('hex');
const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const clip = (s, n) => String(s ?? '').replace(/\r/g, '').trim().slice(0, n);
export const EXPORT_LIMIT = 2 * 1024 ** 3; // 2 GB: a module with its PDFs

/** A JSON file with a fresh shape, written atomically. */
class JsonFile {
  constructor(file, fresh) {
    this.file = file;
    this.fresh = fresh;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { this.data = { ...fresh(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { this.data = fresh(); }
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

// ---------- modules: a campaign or scenario, ready to start again and again ----------

/** Every uploaded file a saved game (or module) points at: maps, tokens, handouts, music. */
export function assetsOf(obj) {
  const out = new Set();
  const re = /\/uploads\/([\w-]{8,64}\.[a-z0-9]{2,5})/gi;
  let m;
  const s = JSON.stringify(obj ?? null);
  while ((m = re.exec(s))) out.add(m[1]);
  return [...out];
}

/**
 * What a module keeps of a prepared game: everything the GM set up, nothing the group did. `gms` are the game's
 * GMs (their sheets are the NPCs); `include` can leave whole parts out.
 */
export function moduleSnapshot(saved, { gms = [], include = {} } = {}) {
  const inc = { scenes: true, notes: true, handouts: true, sheets: true, audio: true, ...include };
  const t = clone(saved) || {};
  const npc = (o) => !o || gms.includes(o);
  const sheets = inc.sheets ? (Array.isArray(t.sheets) ? t.sheets : []).filter((sh) => npc(sh.owner))
    .map((sh) => ({ ...sh, owner: '', shared: false })) : [];
  const keep = new Set(sheets.map((sh) => sh.id));
  const scenes = inc.scenes ? (Array.isArray(t.scenes) ? t.scenes : []).map((sc) => ({
    ...sc,
    tokens: (sc.tokens || []).filter((tk) => !tk.sheetId || keep.has(tk.sheetId)).map((tk) => { const o = { ...tk, owners: [] }; delete o.fallen; return o; }),
    walls: (sc.walls || []).map((w) => (w.secret ? { ...w, found: false, open: false } : w)),
    fog: sc.fog ? { ...sc.fog, ops: [], explored: null } : sc.fog,
    devices: (sc.devices || []).map((d) => { const o = { ...d }; delete o.looped; delete o.slaved; delete o.triggered; return o; }),
    drawings: (sc.drawings || []).filter((d) => d.gmOnly || npc(d.author)),
  })) : [];
  const page = t.page && typeof t.page === 'object' ? t.page : {};
  return {
    scenes,
    activeScene: scenes.some((sc) => sc.id === t.activeScene) ? t.activeScene : scenes[0]?.id,
    sheets,
    settings: { ...(t.settings || {}) },
    notes: inc.notes ? (Array.isArray(t.notes) ? t.notes : []).filter((n) => !n.owner).map((n) => ({ ...n, share: 'none' })) : [],
    audio: inc.audio && t.audio ? { ...t.audio, ambience: [], music: { ...(t.audio.music || {}), playing: false, startedAt: 0, offset: 0 } } : undefined,
    handouts: inc.handouts ? (Array.isArray(t.handouts) ? t.handouts : []).map((h) => ({ ...h, shown: false })) : [],
    page: { title: page.title || '', description: page.description || '', banner: page.banner || '' },
  };
}

/** A new game from a module: the new GM owns its NPCs; no chat, players, write-ups or history. */
export function gameFromModule(snap, { id, title = '', gm = '' } = {}) {
  const t = clone(snap) || {};
  return {
    id,
    scenes: t.scenes || [],
    activeScene: t.activeScene,
    sheets: (t.sheets || []).map((sh) => ({ ...sh, owner: gm })),
    chat: [],
    settings: t.settings || {},
    notes: t.notes || [],
    audio: t.audio,
    propState: {},
    propShares: {},
    handouts: t.handouts || [],
    page: { ...(t.page || {}), title: title || t.page?.title || '', log: [], nextSession: null, lookingForPlayers: false },
    played: {},
  };
}

const VIS = ['public', 'private'];
const counts = (snap) => ({
  scenes: snap.scenes?.length || 0, notes: snap.notes?.length || 0, handouts: snap.handouts?.length || 0,
  npcs: snap.sheets?.length || 0, tracks: snap.audio?.tracks?.length || 0,
});

export class Modules {
  /** dir: DATA_DIR/modules; uploadsDir: where /uploads/ files live; library: the PDF Library (optional). */
  constructor(dir, { uploadsDir, library = null } = {}) {
    this.dir = dir;
    this.uploadsDir = uploadsDir;
    this.library = library;
    this.store = new JsonFile(path.join(dir, 'modules.json'), () => ({ modules: {}, libraries: {} }));
  }
  get mods() { return this.store.data.modules; }
  get libs() { return this.store.data.libraries; }
  get(id) { return Object.hasOwn(this.mods, id) ? this.mods[id] : null; }
  snapPath(m) { return path.join(this.dir, m.id, `v${m.version}.json`); }
  snapshot(id) {
    const m = this.get(id);
    if (!m) throw new Error("That module isn't on this server any more");
    return JSON.parse(fs.readFileSync(this.snapPath(m), 'utf8'));
  }
  /** The module published from this game, if there is one. */
  fromRoom(room) { return Object.values(this.mods).find((m) => m.room === room && !m.origin) || null; }

  rating(m) {
    const r = m.reviews || [];
    return { stars: r.length ? Math.round((r.reduce((a, x) => a + x.stars, 0) / r.length) * 10) / 10 : 0, reviews: r.length };
  }
  /** How a module is listed: everything but the reviews themselves. */
  card(m, user = '') {
    const lib = user ? this.libs[user]?.[m.id] : null;
    const { reviews, ...rest } = m;
    return { ...rest, ...this.rating(m), inLibrary: !!lib, update: !!lib && lib.seen < m.version };
  }
  /** The marketplace: everything published and not withdrawn, newest first. */
  market(user = '') {
    return Object.values(this.mods).filter((m) => !m.withdrawn).sort((a, b) => b.updated - a.updated).map((m) => this.card(m, user));
  }
  detail(id, user = '') {
    const m = this.get(id);
    if (!m) return null;
    return { ...this.card(m, user), reviews: [...(m.reviews || [])].sort((a, b) => b.at - a.at) };
  }

  sizeOf(snap, pdfs) {
    let n = 0;
    for (const f of assetsOf(snap)) { try { n += fs.statSync(path.join(this.uploadsDir, f)).size; } catch { /* gone */ } }
    for (const p of pdfs) { try { n += fs.statSync(this.library.pdfPath(p)).size; } catch { /* gone */ } }
    return n;
  }

  /**
   * Publish a game as a module, or a new version of the module it was already published as.
   * pdfs: [{id, title, share}] from the PDF library. cover: an /uploads/ picture.
   */
  publish({ room, author, title, description = '', ruleset = '', visibility = 'private', shareOk = false, cover = '', pdfs = [], snapshot }) {
    if (!clip(title, 80)) throw new Error('Give it a title');
    if (!VIS.includes(visibility)) throw new Error('Pick public or private');
    if (visibility === 'public' && !shareOk) throw new Error('Tick the box to say this is yours to share, or publish it as private');
    let m = this.fromRoom(room);
    const now = Date.now();
    if (m) {
      try { fs.rmSync(this.snapPath(m), { force: true }); } catch { /* already gone */ }
      m.version += 1;
    } else {
      m = { id: newId(), room, author, published: now, version: 1, reviews: [] };
      this.mods[m.id] = m;
    }
    const docs = pdfs.filter((p) => p && typeof p.id === 'string').slice(0, 50)
      .map((p) => ({ id: p.id, title: clip(p.title, 120), share: p.share === 'all' ? 'all' : 'none' }));
    Object.assign(m, {
      title: clip(title, 80), description: clip(description, 4000), ruleset: clip(ruleset, 20), visibility,
      shareOk: visibility === 'public' && !!shareOk, cover: /^\/uploads\/[\w-]+\.(png|jpe?g|webp|gif)$/i.test(cover) ? cover : (m.cover || ''),
      pdfs: docs, contents: counts(snapshot), size: this.sizeOf(snapshot, docs), updated: now, withdrawn: false,
    });
    fs.mkdirSync(path.dirname(this.snapPath(m)), { recursive: true });
    fs.writeFileSync(this.snapPath(m), JSON.stringify(snapshot));
    // the author always has their own module in their library
    this.addToLibrary(author, m.id);
    this.store.save();
    return m;
  }
  /** Stop offering it; anyone who added it keeps it in their library. */
  withdraw(id, on = true) {
    const m = this.get(id);
    if (!m) throw new Error('No such module');
    m.withdrawn = !!on;
    this.store.save();
    return m;
  }
  /** Taken down by an admin: gone from the marketplace and everyone's library. Games already started keep theirs. */
  remove(id) {
    const m = this.get(id);
    if (!m) return false;
    delete this.mods[id];
    for (const lib of Object.values(this.libs)) delete lib[id];
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    this.store.save();
    return true;
  }

  addToLibrary(user, id) {
    const m = this.get(id);
    if (!m) throw new Error('No such module');
    if (m.withdrawn && m.author !== user) throw new Error("That module isn't offered any more");
    (this.libs[user] ||= {})[id] = { added: this.libs[user]?.[id]?.added || Date.now(), seen: m.version };
    this.store.save();
  }
  removeFromLibrary(user, id) {
    if (this.libs[user]) delete this.libs[user][id];
    this.store.save();
  }
  inLibrary(user, id) { return !!this.libs[user]?.[id]; }
  libraryOf(user) {
    return Object.entries(this.libs[user] || {}).map(([id, e]) => {
      const m = this.get(id);
      return m && { ...this.card(m, user), added: e.added };
    }).filter(Boolean).sort((a, b) => (b.update - a.update) || a.title.localeCompare(b.title));
  }
  /** Seen the latest version: the "update" note goes away. */
  seen(user, id) {
    const e = this.libs[user]?.[id];
    const m = this.get(id);
    if (e && m) { e.seen = m.version; this.store.save(); }
  }

  review(id, by, stars, text = '') {
    const m = this.get(id);
    if (!m) throw new Error('No such module');
    if (m.author === by && !m.origin) throw new Error("You can't review your own module");
    const s = Math.round(Number(stars));
    if (!(s >= 1 && s <= 5)) throw new Error('Give it between 1 and 5 stars');
    m.reviews = (m.reviews || []).filter((r) => r.by !== by);
    m.reviews.push({ by, stars: s, text: clip(text, 1500), at: Date.now(), version: m.version });
    this.store.save();
  }
  deleteReview(id, by) {
    const m = this.get(id);
    if (!m) return;
    m.reviews = (m.reviews || []).filter((r) => r.by !== by);
    this.store.save();
  }

  // ---------- export and import: one .lantern file (a zip) ----------
  /** Write a module to a .lantern file: the module, its pictures and music, and its PDFs. Public modules only. */
  async exportTo(id, outPath) {
    const m = this.get(id);
    if (!m) throw new Error('No such module');
    if (m.visibility !== 'public') throw new Error('Only public modules can be exported');
    const snap = this.snapshot(id);
    const files = assetsOf(snap).map((f) => ({ name: `uploads/${f}`, file: path.join(this.uploadsDir, f) }));
    const docs = [];
    for (const p of m.pdfs || []) {
      const doc = this.library?.get(p.id);
      if (!doc || !fs.existsSync(this.library.pdfPath(doc))) continue;
      files.push({ name: `pdfs/${doc.id}.pdf`, file: this.library.pdfPath(doc) });
      docs.push({ id: doc.id, title: doc.title, pages: doc.pages, size: doc.size });
    }
    let total = 0;
    for (const f of files) { try { total += fs.statSync(f.file).size; } catch { f.missing = true; } }
    if (total > EXPORT_LIMIT) throw new Error(`That module is ${(total / 1024 ** 3).toFixed(1)} GB: the limit is 2 GB. Leave a PDF out and publish it again`);
    const { reviews, room, ...meta } = m;
    const head = { format: 1, meta: { ...meta, exported: Date.now() }, snapshot: snap, docs };
    const out = fs.createWriteStream(outPath);
    let failed = null;
    const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
    const zip = new Zip((err, chunk, final) => {
      if (err) { failed ||= err; return; }
      out.write(Buffer.from(chunk));
      if (final) out.end();
    });
    const j = new ZipDeflate('lantern-module.json', { level: 6 });
    zip.add(j);
    j.push(new TextEncoder().encode(JSON.stringify(head)), true);
    const buf = Buffer.alloc(1 << 20);
    for (const f of files) {
      if (f.missing) continue;
      const entry = new ZipPassThrough(f.name);
      zip.add(entry);
      const fd = fs.openSync(f.file, 'r');
      try {
        for (;;) {
          const n = fs.readSync(fd, buf, 0, buf.length, null);
          entry.push(new Uint8Array(buf.subarray(0, n)), n === 0);
          if (n === 0) break;
          if (out.writableLength > 32 * 1024 * 1024) await new Promise((r) => out.once('drain', r));
        }
      } finally { fs.closeSync(fd); }
    }
    zip.end();
    await done;
    if (failed) throw failed;
    return { size: fs.statSync(outPath).size };
  }

  /** Bring a .lantern file in: a new module on this server, in the importer's library. */
  importFrom(zipPath, { user, server = '' }) {
    const tmp = path.join(this.dir, 'tmp', `import-${Date.now()}-${newId()}`);
    fs.mkdirSync(tmp, { recursive: true });
    let head = null;
    const added = { uploads: 0, pdfs: 0 };
    const pending = [];
    return new Promise((resolve, reject) => {
      let failed = null;
      const uz = new Unzip();
      uz.register(UnzipInflate);
      uz.onfile = (f) => {
        if (/(^|\/)(__MACOSX|\.)/.test(f.name)) return;
        let dest = null;
        if (f.name === 'lantern-module.json') {
          const parts = [];
          let size = 0;
          f.ondata = (err, chunk, final) => {
            if (err) { failed ||= err; return; }
            size += chunk.length;
            if (size > 200 * 1024 * 1024) { failed ||= new Error('The module file is too big'); return; }
            parts.push(chunk);
            if (final) { try { head = JSON.parse(Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8')); } catch (e) { failed ||= e; } }
          };
          return f.start();
        }
        let m = /^uploads\/([\w-]{8,64}\.[a-z0-9]{2,5})$/i.exec(f.name);
        if (m) {
          dest = path.join(this.uploadsDir, m[1]);
          if (fs.existsSync(dest)) return;
          added.uploads++;
        } else if ((m = /^pdfs\/([a-f0-9]{8,32})\.pdf$/.exec(f.name)) && this.library) {
          dest = path.join(tmp, `${m[1]}.pdf`);
          pending.push(m[1]);
        } else return;
        const part = `${dest}.part`;
        const fd = fs.openSync(part, 'w');
        f.ondata = (err, chunk, final) => {
          if (err) { failed ||= err; try { fs.closeSync(fd); } catch { /* closed */ } return; }
          fs.writeSync(fd, chunk);
          if (final) { fs.closeSync(fd); fs.renameSync(part, dest); }
        };
        f.start();
      };
      const stream = fs.createReadStream(zipPath);
      stream.on('data', (chunk) => { try { uz.push(chunk); } catch (e) { failed ||= e; stream.destroy(); } });
      stream.on('error', reject);
      stream.on('close', () => {
        try { if (!failed) uz.push(new Uint8Array(0), true); } catch (e) { failed ||= e; }
        try {
          if (failed) throw new Error(`That file couldn't be unpacked (${failed.message}). Export it again and retry`);
          if (!head || head.format !== 1 || !head.meta || !head.snapshot) throw new Error("That isn't a Lantern module (.lantern) file");
          resolve(this.adoptImport(head, tmp, pending, { user, server, added }));
        } catch (e) { reject(e); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      });
    });
  }
  adoptImport(head, tmp, pending, { user, server, added }) {
    const meta = head.meta;
    // PDFs: keep their ids (so the module's list still points at them); one that's already here is used as is
    if (this.library) {
      const docs = [];
      for (const id of pending) {
        const info = (head.docs || []).find((d) => d.id === id) || {};
        if (this.library.get(id)) continue;
        const dest = path.join(this.library.dir, `${id}.pdf`);
        fs.copyFileSync(path.join(tmp, `${id}.pdf`), dest);
        docs.push({ id, title: clip(info.title, 120) || 'PDF', pages: info.pages, size: fs.statSync(dest).size, uploadedAt: Date.now(), share: {} });
        added.pdfs++;
      }
      this.library.adopt(docs);
    }
    const id = newId();
    const now = Date.now();
    const m = {
      id, room: null, author: clip(meta.author, 32) || 'someone', published: now, updated: now, version: 1, reviews: [],
      title: clip(meta.title, 80) || 'Imported module', description: clip(meta.description, 4000), ruleset: clip(meta.ruleset, 20),
      visibility: 'public', shareOk: true, cover: /^\/uploads\/[\w-]+\.(png|jpe?g|webp|gif)$/i.test(meta.cover || '') ? meta.cover : '',
      pdfs: (meta.pdfs || []).filter((p) => p && /^[a-f0-9]{8,32}$/.test(p.id)).map((p) => ({ id: p.id, title: clip(p.title, 120), share: p.share === 'all' ? 'all' : 'none' })),
      contents: counts(head.snapshot), importedBy: user,
      origin: { author: clip(meta.author, 32), server: clip(meta.server || server, 120), version: Number(meta.version) || 1, exported: Number(meta.exported) || 0 },
    };
    m.size = this.sizeOf(head.snapshot, m.pdfs);
    this.mods[id] = m;
    fs.mkdirSync(path.dirname(this.snapPath(m)), { recursive: true });
    fs.writeFileSync(this.snapPath(m), JSON.stringify(head.snapshot));
    this.addToLibrary(user, id);
    this.store.save();
    return { module: m, ...added };
  }
}

// ---------- character vault: your characters, kept with your account ----------
export class Vault {
  constructor(dataDir) { this.store = new JsonFile(path.join(dataDir, 'vault.json'), () => ({ chars: {} })); }
  list(user) { return [...(this.store.data.chars[user] || [])].sort((a, b) => b.saved - a.saved); }
  get(user, id) { return (this.store.data.chars[user] || []).find((c) => c.id === id) || null; }
  /** Save (or re-save) a character from a game. Saving the same sheet again updates its vault copy. */
  save(user, sheet, { room = '', roomTitle = '' } = {}) {
    const list = (this.store.data.chars[user] ||= []);
    let c = list.find((x) => x.from?.room === room && x.from?.sheet === sheet.id);
    if (!c) {
      if (list.length >= 200) throw new Error('Your vault is full (200 characters): delete some first');
      c = { id: newId(), created: Date.now() };
      list.push(c);
    }
    Object.assign(c, {
      name: clip(sheet.data?.name, 80) || 'Unnamed', system: clip(sheet.system, 20) || 'generic',
      data: clone(sheet.data || {}), saved: Date.now(), from: { room, title: clip(roomTitle, 80), sheet: sheet.id },
    });
    this.store.save();
    return c;
  }
  remove(user, id) {
    const list = this.store.data.chars[user] || [];
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    this.store.save();
    return true;
  }
  rename(user, id, name) {
    const c = this.get(user, id);
    if (!c) throw new Error('No such character');
    c.name = clip(name, 80) || c.name;
    if (c.data && typeof c.data === 'object') c.data.name = c.name;
    this.store.save();
    return c;
  }
}

// ---------- looking for group ----------
export class Lfg {
  constructor(dataDir) { this.store = new JsonFile(path.join(dataDir, 'lfg.json'), () => ({ listings: {}, requests: [] })); }
  get(room) { return this.store.data.listings[room] || null; }
  open() { return Object.values(this.store.data.listings).filter((l) => l.open); }
  set(room, p, gm) {
    const now = Date.now();
    const l = (this.store.data.listings[room] ||= { room, created: now });
    Object.assign(l, {
      open: !!p.open, gm,
      blurb: clip(p.blurb, 2000), schedule: clip(p.schedule, 120), howWePlay: clip(p.howWePlay, 120),
      seats: Math.max(1, Math.min(12, Math.round(Number(p.seats) || 4))), newPlayers: !!p.newPlayers, updated: now,
    });
    this.store.save();
    return l;
  }
  remove(room) {
    delete this.store.data.listings[room];
    this.store.data.requests = this.store.data.requests.filter((r) => r.room !== room);
    this.store.save();
  }
  /** Ask to join (again): one open request per person per game. */
  request(room, name, message = '') {
    const l = this.get(room);
    if (!l?.open) throw new Error("That game isn't looking for players any more");
    let r = this.store.data.requests.find((x) => x.room === room && x.name === name && x.status === 'pending');
    if (!r) {
      if (this.store.data.requests.filter((x) => x.name === name && x.status === 'pending').length >= 10) throw new Error("You've asked to join ten games already: wait for an answer");
      r = { id: newId(), room, name, status: 'pending' };
      this.store.data.requests.push(r);
    }
    Object.assign(r, { message: clip(message, 1000), at: Date.now() });
    this.store.save();
    return r;
  }
  requestsFor(room) { return this.store.data.requests.filter((r) => r.room === room).sort((a, b) => b.at - a.at); }
  requestsBy(name) { return this.store.data.requests.filter((r) => r.name === name); }
  getRequest(id) { return this.store.data.requests.find((r) => r.id === id) || null; }
  decide(id, status) {
    const r = this.getRequest(id);
    if (!r) throw new Error('No such request');
    if (!['accepted', 'declined', 'withdrawn'].includes(status)) throw new Error('Accept or decline it');
    r.status = status;
    r.decided = Date.now();
    this.store.save();
    return r;
  }
}
