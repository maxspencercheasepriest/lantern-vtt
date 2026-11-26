// Build a Lantern Server package (the always-on edition) for one platform:
//   node scripts/build-server.js windows-x64 | linux-x64 | linux-arm64  [--node-from <node binary>]
// → dist/Lantern-Server-<version>-<platform>.zip, holding:
//   Lantern-Server/app/        the server, with production dependencies for that platform
//   Lantern-Server/node/       its own Node (node.exe, or bin/node), so nothing needs installing first
//   Lantern-Server/start.mjs   what the service runs (server-edition/start.mjs)
//   install / uninstall scripts, README.txt, and on Windows WinSW as lantern-service.exe
// Runs on Linux (GitHub Actions); needs network for npm, nodejs.org and WinSW's GitHub release.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
const PLATFORMS = { 'windows-x64': { os: 'win32', cpu: 'x64', node: 'win-x64' }, 'linux-x64': { os: 'linux', cpu: 'x64', node: 'linux-x64' }, 'linux-arm64': { os: 'linux', cpu: 'arm64', node: 'linux-arm64' } };
const P = PLATFORMS[platform];
if (!P) { console.error(`Which platform? ${Object.keys(PLATFORMS).join(' | ')}`); process.exit(1); }
const nodeFrom = process.argv.includes('--node-from') ? process.argv[process.argv.indexOf('--node-from') + 1] : null;

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const stageTop = path.join(ROOT, 'dist', 'server-stage', platform);
const stage = path.join(stageTop, 'Lantern-Server');
const app = path.join(stage, 'app');
const WINSW = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe';

const step = (s) => console.log(`• ${s}`);
fs.rmSync(stageTop, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

// ---------- the app: the same server files the desktop app ships ----------
step('Copying the server');
const FILES = ['server.js', 'library.js', 'campaign.js', 'tunnel.js', 'soundboard.js', 'scenario.js', 'props.js', 'importer.js', 'accounts.js', 'dicesim.js', 'serveredition.js', 'community.js', 'package.json', 'package-lock.json', 'README.md'];
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(app, f));
if (fs.existsSync(path.join(ROOT, 'LICENSE'))) fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(app, 'LICENSE'));
const copyDir = (rel, skip = () => false) => fs.cpSync(path.join(ROOT, rel), path.join(app, rel), { recursive: true, filter: (src) => !skip(path.relative(ROOT, src).split(path.sep).join('/')) });
copyDir('shared');
copyDir('public', (r) => r.startsWith('public/vendor'));   // Particula's GoDice library may not be redistributed
copyDir('tools/roll20-export');

step(`Installing production dependencies for ${P.os}/${P.cpu}`);
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', `--os=${P.os}`, `--cpu=${P.cpu}`, '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
// the same trimming as the desktop app's build.files
const prune = [
  'node_modules/three/examples', 'node_modules/three/src', 'node_modules/pdfjs-dist/types', 'node_modules/pdfjs-dist/web', 'node_modules/pdfjs-dist/image_decoders',
  'node_modules/pdfjs-dist/build/pdf.mjs', 'node_modules/pdfjs-dist/build/pdf.worker.mjs',
];
for (const r of prune) fs.rmSync(path.join(app, r), { recursive: true, force: true });
for (const dir of ['node_modules/pdfjs-dist']) {
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(map|d\.mts)$/.test(e.name)) fs.rmSync(p); } };
  walk(path.join(app, dir));
}

// ---------- its own Node ----------
step('Adding Node');
const nodeDir = path.join(stage, 'node');
fs.mkdirSync(nodeDir, { recursive: true });
const want = process.versions.node;
if (nodeFrom) {
  const dest = P.os === 'win32' ? path.join(nodeDir, 'node.exe') : path.join(nodeDir, 'bin', 'node');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(nodeFrom, dest);
  fs.chmodSync(dest, 0o755);
} else if (P.os === 'win32') {
  const zip = await download(`https://nodejs.org/dist/v${want}/node-v${want}-${P.node}.zip`);
  const top = `node-v${want}-${P.node}/`;
  const files = unzipSync(zip, { filter: (f) => f.name === `${top}node.exe` || f.name === `${top}LICENSE` });
  fs.writeFileSync(path.join(nodeDir, 'node.exe'), files[`${top}node.exe`]);
  if (files[`${top}LICENSE`]) fs.writeFileSync(path.join(nodeDir, 'LICENSE'), files[`${top}LICENSE`]);
} else {
  const tgz = path.join(stageTop, 'node.tar.gz');
  fs.writeFileSync(tgz, await download(`https://nodejs.org/dist/v${want}/node-v${want}-${P.node}.tar.gz`));
  execFileSync('tar', ['-xzf', tgz, '-C', nodeDir, '--strip-components=1', `node-v${want}-${P.node}/bin/node`, `node-v${want}-${P.node}/LICENSE`]);
  fs.rmSync(tgz);
}

// ---------- start, install and uninstall ----------
step('Adding the start and install scripts');
const SE = path.join(ROOT, 'server-edition');
fs.copyFileSync(path.join(SE, 'start.mjs'), path.join(stage, 'start.mjs'));
fs.copyFileSync(path.join(SE, 'README.txt'), path.join(stage, 'README.txt'));
if (P.os === 'win32') {
  for (const f of ['install.ps1', 'Install.cmd', 'Uninstall.cmd', 'lantern-service.xml']) fs.copyFileSync(path.join(SE, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, 'lantern-service.exe'), await download(WINSW));
} else {
  for (const f of ['install.sh', 'uninstall.sh']) { fs.copyFileSync(path.join(SE, f), path.join(stage, f)); fs.chmodSync(path.join(stage, f), 0o755); }
}

// ---------- zip it ----------
const out = path.join(ROOT, 'dist', `Lantern-Server-${version}-${platform}.zip`);
fs.rmSync(out, { force: true });
step(`Zipping ${path.relative(ROOT, out)}`);
execFileSync('zip', ['-r', '-q', '-X', out, 'Lantern-Server'], { cwd: stageTop }); // keeps Linux's "executable" marks
console.log(`  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);

async function download(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'lantern-build' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
