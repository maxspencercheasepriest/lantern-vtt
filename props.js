// Props: interactive in-world screens (a hacker's deck, a corporate portal, a ship's console) that run
// inside the table. A "collection" is a folder of HTML pages that belong together and share storage,
// like the Thaw props. Each page is served sealed off from Lantern (a sandboxed, opaque origin) with a
// small helper injected first, which:
//   - replaces the page's localStorage with the campaign's shared storage, so state a prop saves (a
//     shared purse, the GM's news edits) is the same for everyone at the table, live;
//   - gives the page window.lantern: who's looking, roll dice, post to chat.
// Existing props need no changes: they keep calling localStorage.getItem/setItem.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';

export const PROP_LIMITS = { files: 500, bytes: 80 * 1024 * 1024, keyBytes: 400_000, collectionBytes: 4_000_000 };

/** The collections on this server: built-in folders (shipped with Lantern) plus ones the GM uploaded. */
export class Props {
  constructor(dataDir, builtins = []) {
    this.dir = path.join(dataDir, 'props');
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'props.json');
    try { this.uploaded = JSON.parse(fs.readFileSync(this.file, 'utf8')).collections || []; } catch { this.uploaded = []; }
    this.builtins = builtins.filter((b) => fs.existsSync(b.dir)).map((b) => ({ ...b, builtin: true }));
  }

  save() { fs.writeFileSync(this.file, JSON.stringify({ collections: this.uploaded }, null, 1)); }

  all() { return [...this.builtins, ...this.uploaded]; }
  get(id) { return this.all().find((c) => c.id === id) || null; }
  dirOf(c) { return c.builtin ? c.dir : path.join(this.dir, c.id); }

  /** The HTML pages of a collection with their <title>s, for the Library list. */
  pages(c) {
    const root = this.dirOf(c);
    const out = [];
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (out.length < 300) walk(r); continue; }
        if (!/\.html?$/i.test(e.name)) continue;
        let title = '';
        try { title = /<title[^>]*>([^<]*)<\/title>/i.exec(fs.readFileSync(path.join(root, r), 'utf8').slice(0, 8000))?.[1] || ''; } catch { /* unreadable */ }
        out.push({ file: r, title: decodeEntities(title).trim() || r.replace(/\.html?$/i, '') });
      }
    };
    try { walk(''); } catch { /* missing folder */ }
    return out.sort((a, b) => (a.file === 'index.html' ? -1 : b.file === 'index.html' ? 1 : a.file.localeCompare(b.file)));
  }

  list() { return this.all().map((c) => ({ id: c.id, title: c.title, builtin: !!c.builtin, pages: this.pages(c) })); }

  /** Add a collection from uploaded files: [{ name, data: Buffer }]. A single .zip is unpacked. */
  add(files, title) {
    let entries = [];
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      const unz = unzipSync(new Uint8Array(files[0].data), { filter: (f) => !f.name.endsWith('/') });
      entries = Object.entries(unz).map(([name, data]) => ({ name, data: Buffer.from(data) }));
      // a zip of one folder: use what's inside it
      const tops = new Set(entries.map((e) => e.name.split('/')[0]));
      if (tops.size === 1 && entries.every((e) => e.name.includes('/'))) entries = entries.map((e) => ({ ...e, name: e.name.split('/').slice(1).join('/') }));
    } else entries = files;
    entries = entries.filter((e) => e.name && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(e.name));
    if (!entries.length) throw new Error('No files in that upload');
    if (entries.length > PROP_LIMITS.files) throw new Error(`Too many files (limit ${PROP_LIMITS.files})`);
    const total = entries.reduce((a, e) => a + e.data.length, 0);
    if (total > PROP_LIMITS.bytes) throw new Error('That upload is too big for a prop (limit 80 MB)');
    if (!entries.some((e) => /\.html?$/i.test(e.name))) throw new Error('A prop needs at least one .html page');
    const id = `${slug(title || entries[0].name)}-${crypto.randomBytes(3).toString('hex')}`;
    const root = path.join(this.dir, id);
    for (const e of entries) {
      const rel = safeRel(e.name);
      if (!rel) continue;
      const to = path.join(root, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, e.data);
    }
    const c = { id, title: String(title || entries.find((e) => /\.html?$/i.test(e.name)).name.replace(/\.[^.]+$/, '')).slice(0, 80) };
    this.uploaded.push(c);
    this.save();
    return c;
  }

  remove(id) {
    const c = this.uploaded.find((x) => x.id === id);
    if (!c) throw new Error(this.builtins.some((b) => b.id === id) ? "Built-in props can't be deleted" : 'No such prop');
    this.uploaded = this.uploaded.filter((x) => x !== c);
    this.save();
    fs.rm(path.join(this.dir, c.id), { recursive: true, force: true }, () => {});
  }

  /** The file for a URL path inside a collection, or null (never anything outside it). */
  resolve(c, rel) {
    const clean = safeRel(rel || 'index.html');
    if (!clean) return null;
    const root = path.resolve(this.dirOf(c));
    const full = path.resolve(root, clean);
    if (!full.startsWith(root + path.sep)) return null;
    try { return fs.statSync(full).isFile() ? full : null; } catch { return null; }
  }
}

const slug = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'prop';
function safeRel(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  if (parts.some((x) => x === '..' || x.includes('\0'))) return null;
  return parts.join('/') || null;
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Insert the helper as the very first script in a page, so it runs before the prop's own code. */
export function injectHelper(html, boot) {
  const tag = `<script>${helperSource(boot)}</script>`;
  const m = /<head[^>]*>/i.exec(html);
  if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
  const h = /<html[^>]*>/i.exec(html);
  if (h) return html.slice(0, h.index + h[0].length) + tag + html.slice(h.index + h[0].length);
  return tag + html;
}

/** The helper that runs inside every prop page (it's sent as text; `boot` is filled in per request). */
function helperSource(boot) {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  return `(function () {
  'use strict';
  var B = ${json};
  var api = B.base + '__lantern';
  var me = 'p' + Math.random().toString(36).slice(2, 10); // this page, so it ignores its own changes
  var data = {}; Object.keys(B.state || {}).forEach(function (k) { data[k] = String(B.state[k]); });
  var read = {}, listening = false, loadedAt = Date.now(), lastReload = 0, pendingReload = null;
  var timers = {};
  function send(k, v) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      fetch(api + '/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k, value: v, by: me }) })
        .then(function (r) { if (!r.ok) r.json().then(function (j) { console.warn('[lantern] not saved:', j.error); }); })
        .catch(function () {});
    }, 120);
  }
  function makeStore(sync) {
    var d = sync ? data : {};
    var s = {
      getItem: function (k) { k = String(k); if (sync) read[k] = 1; return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
      setItem: function (k, v) { k = String(k); v = String(v); if (d[k] === v) return; d[k] = v; if (sync) send(k, v); },
      removeItem: function (k) { k = String(k); if (!(k in d)) return; delete d[k]; if (sync) send(k, null); },
      clear: function () { Object.keys(d).forEach(function (k) { s.removeItem(k); }); },
      key: function (i) { return Object.keys(d)[i] || null; },
    };
    Object.defineProperty(s, 'length', { get: function () { return Object.keys(d).length; } });
    return s;
  }
  try { Object.defineProperty(window, 'localStorage', { value: makeStore(true), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: makeStore(false), configurable: true }); } catch (e) {}
  // pages that listen for "storage" events get them; other pages reload to pick up the change
  var add = window.addEventListener;
  window.addEventListener = function (t) { if (t === 'storage') listening = true; return add.apply(this, arguments); };
  try { Object.defineProperty(window, 'onstorage', { set: function (f) { listening = true; add.call(window, 'storage', f); }, configurable: true }); } catch (e) {}
  function typing() { var a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value; }
  function reloadSoon() {
    if (pendingReload) return;
    var wait = Math.max(400, 4000 - (Date.now() - lastReload));
    pendingReload = setTimeout(function go() {
      if (typing()) { pendingReload = setTimeout(go, 1500); return; }
      pendingReload = null; lastReload = Date.now();
      location.reload();
    }, wait);
  }
  function apply(msg) {
    if (!msg || msg.by === me) return;
    var old = data[msg.key];
    if (msg.value === null) delete data[msg.key]; else data[msg.key] = String(msg.value);
    if (old === data[msg.key]) return;
    if (listening) {
      try { window.dispatchEvent(new StorageEvent('storage', { key: msg.key, oldValue: old == null ? null : old, newValue: msg.value })); } catch (e) {}
    } else if (read[msg.key] && Date.now() - loadedAt > 1500) reloadSoon();
  }
  function connect() {
    if (!window.EventSource) return setInterval(poll, 3000);
    var es = new EventSource(api + '/events');
    es.addEventListener('state', function (e) { try { apply(JSON.parse(e.data)); } catch (x) {} });
    es.addEventListener('reset', function () { data = {}; setTimeout(function () { location.reload(); }, 300); });
  }
  var ver = B.version || 0;
  function poll() {
    fetch(api + '/state').then(function (r) { return r.json(); }).then(function (j) {
      if (j.version === ver) return; ver = j.version;
      Object.keys(j.state).forEach(function (k) { apply({ key: k, value: j.state[k], by: '' }); });
    }).catch(function () {});
  }
  connect();
  function post(path, body) {
    return fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Failed'); return j; }); });
  }
  // the toolkit for props written with Lantern in mind
  window.lantern = {
    version: 1,
    me: B.me,                                    // { name, isGM }
    collection: B.collection,
    roll: function (expr, label) { return post('/roll', { expr: String(expr), label: label ? String(label) : '' }); },
    chat: function (text) { return post('/chat', { text: String(text) }); },
    sheet: function () { return fetch(api + '/sheet').then(function (r) { return r.json(); }); },
  };
})();`;
}
