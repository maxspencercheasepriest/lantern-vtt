// The server edition: backups, updating itself (check, download, swap in, roll back), its settings file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { backupNow, listBackups, newer, checkForUpdate, stageUpdate, assetName, keepQuickTunnel } from '../serveredition.js';
import { applyPendingUpdate, rollBack, readConfig } from '../server-edition/start.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-se-'));
const enc = (s) => new TextEncoder().encode(s);

test('backups: campaigns, accounts and settings, one folder a day, the newest kept', () => {
  const d = tmp();
  try {
    fs.mkdirSync(path.join(d, 'rooms'));
    fs.writeFileSync(path.join(d, 'rooms', 'thaw.json'), '{}');
    fs.writeFileSync(path.join(d, 'rooms', 'thaw.thumb.jpg'), 'x');
    fs.writeFileSync(path.join(d, 'accounts.json'), '{}');
    for (let i = 1; i <= 5; i++) backupNow(d, { keep: 3, when: new Date(2026, 10, i) });
    assert.deepEqual(listBackups(d), ['2026-11-05', '2026-11-04', '2026-11-03']);
    const b = path.join(d, 'backups', '2026-11-05');
    assert.ok(fs.existsSync(path.join(b, 'rooms', 'thaw.json')) && fs.existsSync(path.join(b, 'accounts.json')));
    assert.ok(!fs.existsSync(path.join(b, 'rooms', 'thaw.thumb.jpg')), 'pictures aren’t backed up');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('updates: versions, the release check, unpacking, swapping in and rolling back', async () => {
  assert.ok(newer('0.26.0', '0.25.9') && newer('v1.0.0', '0.99.99') && !newer('0.25.0', '0.25.0') && !newer('0.24.9', '0.25.0'));

  const release = (assets) => async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.26.0', body: 'notes', assets }) });
  let c = await checkForUpdate({ repo: 'x/y', current: '0.25.0', platform: 'windows-x64', fetchImpl: release([{ name: assetName('0.26.0', 'windows-x64'), browser_download_url: 'https://example/w.zip', size: 9 }]) });
  assert.deepEqual([c.latest, c.newer, c.url], ['0.26.0', true, 'https://example/w.zip']);
  c = await checkForUpdate({ repo: 'x/y', current: '0.25.0', platform: 'linux-arm64', fetchImpl: release([]) });
  assert.ok(c.newer && !c.url && /no server package/.test(c.message));
  c = await checkForUpdate({ repo: 'x/y', current: '0.25.0', platform: 'windows-x64', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(c.newer, false);

  const root = tmp();
  try {
    // the installed version
    fs.mkdirSync(path.join(root, 'app'));
    fs.writeFileSync(path.join(root, 'app', 'server.js'), '// old');
    fs.writeFileSync(path.join(root, 'start.mjs'), '// old start');
    assert.equal(applyPendingUpdate(root, () => {}), false, 'nothing waiting');
    // a downloaded package: only app/ and start.mjs are taken, nothing outside the folder
    const pkg = zipSync({
      'Lantern-Server/app/server.js': enc('// new'), 'Lantern-Server/app/package.json': enc('{"version":"0.26.0"}'),
      'Lantern-Server/app/public/js/app.js': enc('// new page'), 'Lantern-Server/start.mjs': enc('// new start'),
      'Lantern-Server/node/node.exe': enc('not replaced'), 'Lantern-Server/lantern.json': enc('{"gmPassword":"overwrite me"}'),
    });
    assert.throws(() => stageUpdate(zipSync({ 'something/else.txt': enc('x') }), root), /isn't a Lantern Server package/);
    assert.deepEqual(stageUpdate(pkg, root).version, '0.26.0');
    assert.ok(!fs.existsSync(path.join(root, 'updates', 'ready', 'node')) && !fs.existsSync(path.join(root, 'updates', 'ready', 'lantern.json')));
    // the next start swaps it in, keeping the old one
    assert.equal(applyPendingUpdate(root, () => {}), true);
    assert.equal(fs.readFileSync(path.join(root, 'app', 'server.js'), 'utf8'), '// new');
    assert.equal(fs.readFileSync(path.join(root, 'app.old', 'server.js'), 'utf8'), '// old');
    assert.equal(fs.readFileSync(path.join(root, 'start.mjs'), 'utf8'), '// new start');
    assert.ok(!fs.existsSync(path.join(root, 'updates', 'ready')));
    // and if it won't start, the old one goes back
    assert.equal(rollBack(root), true);
    assert.equal(fs.readFileSync(path.join(root, 'app', 'server.js'), 'utf8'), '// old');
    assert.ok(fs.existsSync(path.join(root, 'app.failed', 'server.js')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('lantern.json: settings with sensible defaults', () => {
  const root = tmp();
  try {
    let c = readConfig(root);
    assert.deepEqual([c.port, c.accounts, c.backups, c.dataDir], [3000, true, 14, path.join(root, 'data')]);
    fs.writeFileSync(path.join(root, 'lantern.json'), JSON.stringify({ port: 3100, gmPassword: 'pw', dataDir: 'D:\\\\campaigns'.replace(/\\\\/g, path.sep === '\\' ? '\\' : '/') }));
    c = readConfig(root);
    assert.equal(c.port, 3100); assert.equal(c.gmPassword, 'pw');
    fs.writeFileSync(path.join(root, 'lantern.json'), '{ broken');
    assert.throws(() => readConfig(root), /isn't valid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a temporary address until there’s a domain: kept running, written down, replaced when it drops', async () => {
  const d = tmp();
  try {
    let n = 0, exit;
    const fake = {
      findCloudflared: () => '/bin/cloudflared',
      downloadCloudflared: async () => '/bin/cloudflared',
      startTunnel: async () => ({ url: `https://random-${++n}.trycloudflare.com`, stop() {}, onExit: (fn) => { exit = fn; } }),
    };
    const qt = keepQuickTunnel({ port: 3000, dataDir: d, tunnel: fake });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(qt.state.url, 'https://random-1.trycloudflare.com');
    assert.equal(fs.readFileSync(path.join(d, 'temporary-address.txt'), 'utf8').trim(), qt.state.url);
    exit(1); // Cloudflare dropped it
    assert.equal(qt.state.url, null);
    await new Promise((r) => setTimeout(r, 5200));
    assert.equal(qt.state.url, 'https://random-2.trycloudflare.com', 'a new one');
    qt.stop();
    assert.ok(!fs.existsSync(path.join(d, 'temporary-address.txt')));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
