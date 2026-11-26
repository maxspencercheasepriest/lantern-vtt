// Lantern Server (the always-on edition): nightly backups and updating itself from GitHub Releases.
// Only used when the server is started by the server edition's start.mjs (opts.serverEdition); the desktop
// app and `npm start` never touch any of this.
//
// The installed layout (see server-edition/README.txt):
//   <root>/start.mjs        what the service runs; swaps in a downloaded update before starting
//   <root>/lantern.json     settings: port, GM password, data folder, …
//   <root>/app/             this code
//   <root>/node/            its own copy of Node
//   <root>/data/            campaigns, accounts, uploads, backups/
//   <root>/updates/ready/   a downloaded update waiting for the next start: app/ and start.mjs
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, Unzip, UnzipInflate } from 'fflate';

export const PACKAGE_TOP = 'Lantern-Server/';
export const assetName = (version, platform) => `Lantern-Server-${version}-${platform}.zip`;

// ---------- backups ----------
const day = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

/** Copy everything that can't be got back (campaigns, accounts, settings) into backups/<date>/. Uploads are left out: they're big, and back up separately. */
export function backupNow(dataDir, { keep = 14, when = new Date() } = {}) {
  const dest = path.join(dataDir, 'backups', day(when));
  fs.mkdirSync(path.join(dest, 'rooms'), { recursive: true });
  let files = 0;
  const copy = (from, to) => { try { fs.copyFileSync(from, to); files++; } catch { /* not there */ } };
  for (const f of fs.existsSync(path.join(dataDir, 'rooms')) ? fs.readdirSync(path.join(dataDir, 'rooms')) : []) {
    if (/\.json$/.test(f)) copy(path.join(dataDir, 'rooms', f), path.join(dest, 'rooms', f));
  }
  for (const f of ['accounts.json', 'video.json', 'gm-password.txt']) copy(path.join(dataDir, f), path.join(dest, f));
  if (fs.existsSync(path.join(dataDir, 'library', 'library.json'))) {
    fs.mkdirSync(path.join(dest, 'library'), { recursive: true });
    copy(path.join(dataDir, 'library', 'library.json'), path.join(dest, 'library', 'library.json'));
  }
  // keep the newest `keep` days
  const all = listBackups(dataDir);
  for (const old of all.slice(keep)) fs.rmSync(path.join(dataDir, 'backups', old), { recursive: true, force: true });
  return { dir: dest, files };
}
export function listBackups(dataDir) {
  try { return fs.readdirSync(path.join(dataDir, 'backups')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); } catch { return []; }
}
/** Once a day: at start-up if today hasn't been done, then whenever the date changes. */
export function startBackups(dataDir, { keep = 14, log = () => {} } = {}) {
  const tick = () => {
    if (listBackups(dataDir)[0] === day()) return;
    try { const r = backupNow(dataDir, { keep }); log(`  Backed up ${r.files} files to ${r.dir}`); } catch (e) { log(`  Backup failed: ${e.message}`); }
  };
  tick();
  const t = setInterval(tick, 60 * 60 * 1000);
  t.unref?.();
  return () => clearInterval(t);
}

// ---------- updates ----------
/** Is version a newer than b? ("0.25.1" vs "0.25.0") */
export function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** Ask GitHub for the latest release, and whether it has a server package for this machine. */
export async function checkForUpdate({ repo, current, platform, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'lantern-server' } });
  if (res.status === 404) return { latest: null, newer: false, message: 'No releases published yet' };
  if (res.status === 403 || res.status === 429) throw new Error('GitHub only answers so many update checks an hour from one address. Try again later');
  if (!res.ok) throw new Error(`GitHub said ${res.status}. Try again in a minute`);
  const rel = await res.json();
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => a.name === assetName(latest, platform));
  return {
    latest, newer: newer(latest, current), published: rel.published_at, notes: String(rel.body || '').slice(0, 4000),
    url: asset?.browser_download_url || null, size: asset?.size || 0,
    message: asset ? null : `Version ${latest} has no server package for ${platform}`,
  };
}

/** Download a server package and leave its app/ and start.mjs in updates/ready/, for start.mjs to swap in. */
export async function downloadUpdate({ url, root, fetchImpl = fetch, maxBytes = 600 * 1024 * 1024 }) {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'lantern-server' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('That download is too big');
  return stageUpdate(buf, root);
}

export function stageUpdate(zipBytes, root) {
  const files = unzipSync(zipBytes, { filter: (f) => f.name.startsWith(`${PACKAGE_TOP}app/`) || f.name === `${PACKAGE_TOP}start.mjs` });
  const names = Object.keys(files);
  if (!names.some((n) => n === `${PACKAGE_TOP}app/server.js`) || !files[`${PACKAGE_TOP}start.mjs`]) throw new Error("That isn't a Lantern Server package");
  const ready = path.join(root, 'updates', 'ready');
  const tmp = path.join(root, 'updates', 'incoming');
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const n of names) {
    if (n.endsWith('/')) continue;
    const rel = n.slice(PACKAGE_TOP.length);
    if (rel.split('/').some((p) => p === '..' || p === '')) continue; // never outside the update folder
    const out = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, files[n]);
  }
  fs.rmSync(ready, { recursive: true, force: true });
  fs.renameSync(tmp, ready);
  const version = JSON.parse(fs.readFileSync(path.join(ready, 'app', 'package.json'), 'utf8')).version;
  return { version, files: names.length };
}

// ---------- bringing campaigns in from a desktop app ----------
/**
 * Unpack a .zip of a Lantern campaigns folder (rooms/, uploads/, library/) into this server's data folder,
 * streaming it so a big library of PDFs doesn't have to fit in memory. A campaign whose name is taken here
 * gets "-2" (or -3…) on the end. Pictures and PDFs that are already here are left alone.
 * → { campaigns: [{ id, from }], uploads, pdfs }
 */
export function importCampaignsZip(zipPath, { dataDir, taken = () => false, library = null, log = () => {} }) {
  const tmp = path.join(dataDir, 'tmp', `bring-in-${Date.now()}`);
  fs.mkdirSync(path.join(tmp, 'rooms'), { recursive: true });
  const counts = { uploads: 0, pdfs: 0 };
  return new Promise((resolve, reject) => {
    let failed = null;
    const uz = new Unzip();
    uz.register(UnzipInflate);
    uz.onfile = (f) => {
      if (/(^|\/)(__MACOSX|\.)/.test(f.name)) return;
      const m = /(?:^|\/)(rooms|uploads|library)\/([^/]+)$/.exec(f.name);
      if (!m) return;
      const [, kind, base] = m;
      let dest;
      if (kind === 'rooms') {
        if (!/^[a-z0-9][a-z0-9-]{0,39}(\.json|\.thumb\.jpg)$/.test(base)) return;
        dest = path.join(tmp, 'rooms', base);
      } else if (kind === 'uploads') {
        if (!/^[\w-]+\.[a-z0-9]{2,5}$/i.test(base)) return;
        dest = path.join(dataDir, 'uploads', base);
        if (fs.existsSync(dest)) return;
        counts.uploads++;
      } else if (base === 'library.json') {
        dest = path.join(tmp, 'library.json');
      } else if (/^[a-f0-9]{8,32}\.(pdf|text\.json|scenario\.json)$/.test(base)) {
        dest = path.join(dataDir, 'library', base);
        if (fs.existsSync(dest)) return;
        if (base.endsWith('.pdf')) counts.pdfs++;
      } else return;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
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
      try {
        if (!failed) uz.push(new Uint8Array(0), true);
      } catch (e) { failed ||= e; }
      if (failed) { fs.rmSync(tmp, { recursive: true, force: true }); return reject(new Error(`That zip couldn't be unpacked (${failed.message}). Make it again and retry`)); }
      try { resolve({ ...placeRooms(tmp, dataDir, taken, log), ...counts, ...adoptLibrary(tmp, library) }); } catch (e) { reject(e); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    });
  });
}

function placeRooms(tmp, dataDir, taken, log) {
  const campaigns = [];
  const roomsDir = path.join(dataDir, 'rooms');
  fs.mkdirSync(roomsDir, { recursive: true });
  for (const f of fs.readdirSync(path.join(tmp, 'rooms')).filter((x) => x.endsWith('.json'))) {
    const from = f.slice(0, -5);
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(tmp, 'rooms', f), 'utf8')); } catch { continue; } // not a campaign
    if (!data || typeof data !== 'object' || (!Array.isArray(data.scenes) && !data.scene)) continue;
    let id = from;
    for (let n = 2; taken(id) || fs.existsSync(path.join(roomsDir, `${id}.json`)); n++) id = `${from.slice(0, 36)}-${n}`;
    data.id = id;
    fs.writeFileSync(path.join(roomsDir, `${id}.json`), JSON.stringify(data));
    const thumb = path.join(tmp, 'rooms', `${from}.thumb.jpg`);
    if (fs.existsSync(thumb)) fs.copyFileSync(thumb, path.join(roomsDir, `${id}.thumb.jpg`));
    campaigns.push({ id, from });
    log(`  Brought in campaign ${from}${id !== from ? ` as ${id}` : ''}`);
  }
  return { campaigns };
}

function adoptLibrary(tmp, library) {
  const file = path.join(tmp, 'library.json');
  if (!library || !fs.existsSync(file)) return {};
  try { library.adopt(JSON.parse(fs.readFileSync(file, 'utf8')).docs); } catch { /* an unreadable index: the PDFs are there, re-add them by hand */ }
  return {};
}
