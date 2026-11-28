// Game plugins installed on this server (shared/plugin.js says what's in one). Each is kept in
// DATA_DIR/plugins/<key>/, where the key is a hash of its files: a plugin never changes once installed, so a
// GM installing a new version (or someone else's plugin with the same id) never alters a campaign already using
// one. A campaign lists the keys it uses in room.settings.plugins.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { cleanManifest, PLUGIN_LIMITS } from './shared/plugin.js';

const junk = (n) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git)(\/|$)/.test(n);
const safeRel = (rel) => {
  const parts = String(rel).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || p.startsWith('.') || p.length > 120)) return null;
  return parts.join('/');
};

export class GamePlugins {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'plugins');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = new Map();
  }

  /** Every installed plugin: [{ key, installed, by, manifest }], newest first. */
  list() {
    let keys = [];
    try { keys = fs.readdirSync(this.dir).filter((k) => /^[a-f0-9]{12}$/.test(k)); } catch { /* none */ }
    return keys.map((k) => this.get(k)).filter(Boolean).sort((a, b) => b.installed - a.installed);
  }

  /** One installed plugin, or null. */
  get(key) {
    if (!/^[a-f0-9]{12}$/.test(String(key))) return null;
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const p = JSON.parse(fs.readFileSync(path.join(this.dir, key, 'lantern-plugin.json'), 'utf8'));
      const out = { key, installed: p.installed || 0, by: p.by || '', manifest: p.manifest };
      this.cache.set(key, out);
      return out;
    } catch { return null; }
  }

  dirOf(key) { return path.join(this.dir, key); }

  /**
   * Install from a .zip (a Buffer) of a folder with plugin.json at its top (or one folder down). Returns the
   * installed plugin; installing the same files again just returns the one already there.
   */
  install(buf, by = '') {
    let unz;
    try { unz = unzipSync(new Uint8Array(buf), { filter: (f) => !f.name.endsWith('/') && !junk(f.name) }); } catch { throw new Error("That file isn't a plugin (.zip) Lantern can open"); }
    let entries = Object.entries(unz).map(([name, data]) => ({ name: name.replace(/\\/g, '/'), data: Buffer.from(data) }));
    const top = entries.find((e) => /(^|\/)plugin\.json$/i.test(e.name) && e.name.split('/').length <= 2);
    if (!top) throw new Error('No plugin.json in that zip: a plugin is a folder with a plugin.json in it');
    const prefix = top.name.slice(0, top.name.length - 'plugin.json'.length);
    entries = entries.filter((e) => e.name.startsWith(prefix)).map((e) => ({ ...e, name: safeRel(e.name.slice(prefix.length)) })).filter((e) => e.name);
    if (entries.length > PLUGIN_LIMITS.files) throw new Error(`Too many files in that plugin (limit ${PLUGIN_LIMITS.files})`);
    if (entries.reduce((a, e) => a + e.data.length, 0) > PLUGIN_LIMITS.bytes) throw new Error('That plugin is too big (limit 20 MB)');
    let raw;
    try { raw = JSON.parse(entries.find((e) => e.name === 'plugin.json').data.toString('utf8')); } catch (e) { throw new Error(`plugin.json has a mistake in it: ${e.message}`); }
    // rules can live in their own Markdown file
    if (typeof raw.rules === 'string' && /\.md$/i.test(raw.rules)) {
      const f = entries.find((e) => e.name === safeRel(raw.rules));
      raw.rules = f ? f.data.toString('utf8') : [];
    }
    const manifest = cleanManifest(raw, entries.map((e) => e.name));
    const hash = crypto.createHash('sha256');
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) hash.update(e.name).update('\0').update(e.data);
    const key = hash.digest('hex').slice(0, 12);
    if (this.get(key)) return this.get(key);
    const root = this.dirOf(key), tmp = `${root}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const e of entries) {
      const to = path.join(tmp, e.name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, e.data);
    }
    fs.writeFileSync(path.join(tmp, 'lantern-plugin.json'), JSON.stringify({ installed: Date.now(), by: String(by).slice(0, 60), manifest }));
    fs.renameSync(tmp, root);
    return this.get(key);
  }

  /** Take a plugin off the server (the caller checks no campaign uses it). */
  remove(key) {
    if (!this.get(key)) throw new Error('No such plugin');
    this.cache.delete(key);
    fs.rmSync(this.dirOf(key), { recursive: true, force: true });
  }

  /** The plugin's own files again, as a .zip (to share it, or to publish it). */
  zip(key) {
    const root = this.dirOf(key);
    const files = {};
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(r); else if (r !== 'lantern-plugin.json') files[r] = new Uint8Array(fs.readFileSync(path.join(root, r)));
      }
    };
    walk('');
    return Buffer.from(zipSync(files));
  }
}

/** A folder (like examples/plugins/hearth) as a plugin .zip, for "Get the example". */
export function zipFolder(dir) {
  const files = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else files[r] = new Uint8Array(fs.readFileSync(path.join(dir, r)));
    }
  };
  walk('');
  return Buffer.from(zipSync(files));
}
