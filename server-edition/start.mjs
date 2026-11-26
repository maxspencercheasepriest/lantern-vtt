// Lantern Server: what the service runs. Reads lantern.json, swaps in an update if one has been downloaded,
// then starts the server in app/ with logins on, nightly backups, and the admin's Update button.
// If a new version won't start, the service starts this again and the previous version is put back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** If updates/ready/ holds a new app/, put it in place of the old one (kept as app.old/ in case it fails). */
export function applyPendingUpdate(root = ROOT, log = console.log) {
  const ready = path.join(root, 'updates', 'ready');
  if (!fs.existsSync(path.join(ready, 'app', 'server.js'))) return false;
  const app = path.join(root, 'app'), old = path.join(root, 'app.old');
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(app)) fs.renameSync(app, old);
  try {
    fs.renameSync(path.join(ready, 'app'), app);
  } catch (e) {
    if (fs.existsSync(old) && !fs.existsSync(app)) fs.renameSync(old, app);
    throw e;
  }
  if (fs.existsSync(path.join(ready, 'start.mjs'))) fs.copyFileSync(path.join(ready, 'start.mjs'), path.join(root, 'start.mjs'));
  fs.rmSync(ready, { recursive: true, force: true });
  log('  Installed the downloaded update');
  return true;
}

/** Put the previous version back (after a new one failed to start). */
export function rollBack(root = ROOT) {
  const app = path.join(root, 'app'), old = path.join(root, 'app.old');
  if (!fs.existsSync(path.join(old, 'server.js'))) return false;
  fs.rmSync(path.join(root, 'app.failed'), { recursive: true, force: true });
  fs.renameSync(app, path.join(root, 'app.failed'));
  fs.renameSync(old, app);
  return true;
}

export function readConfig(root = ROOT) {
  const file = path.join(root, 'lantern.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error(`lantern.json isn't valid: ${e.message}`); }
  return {
    port: Number(cfg.port) || 3000,
    host: cfg.host || '0.0.0.0',
    dataDir: path.resolve(root, cfg.dataDir || 'data'),
    gmPassword: cfg.gmPassword || undefined,
    accounts: cfg.accounts !== false,
    backups: Number.isFinite(cfg.backupDays) ? cfg.backupDays : 14,
    updateRepo: cfg.updateRepo || 'maxspencercheasepriest/lantern-vtt',
    quickTunnel: !!cfg.quickTunnel,
  };
}

async function main() {
  const cfg = readConfig();
  // a version that was swapped in last time but never finished starting: put the previous one back
  const trying = path.join(ROOT, 'updates', 'trying');
  if (fs.existsSync(trying)) {
    fs.rmSync(trying, { force: true });
    if (rollBack()) console.error('  The last update wouldn\'t start, so the previous version is back.');
  }
  if (applyPendingUpdate()) fs.writeFileSync(trying, new Date().toISOString());
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'app', 'server.js')).href);
  await startServer({
    port: cfg.port, host: cfg.host, dataDir: cfg.dataDir, gmPassword: cfg.gmPassword, accounts: cfg.accounts,
    serverEdition: { root: ROOT, platform: `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`, backupDays: cfg.backups, repo: cfg.updateRepo, quickTunnel: cfg.quickTunnel },
  });
  fs.rmSync(trying, { force: true }); // it started: this version stays
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`  Lantern Server couldn't start: ${e.message}`); process.exit(1); });
}
