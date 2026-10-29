// Assembles the web files the Android app carries inside it (mobile/www):
// Lantern's interface, the shared dice engine, pdf.js, the Socket.IO client, the app shell and the
// native GoDice driver. Then `npx cap sync android` copies them into the Android project.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'mobile', 'www');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(from, path.join(out, to), { recursive: true });

copy(path.join(root, 'public'), '.');
fs.rmSync(path.join(out, 'vendor'), { recursive: true, force: true }); // Particula's library can't be used in the app
copy(path.join(root, 'shared'), 'shared');

const pdfjs = path.dirname(require.resolve('pdfjs-dist/package.json'));
for (const f of ['build/pdf.min.mjs', 'build/pdf.worker.min.mjs']) copy(path.join(pdfjs, f), `pdfjs/${f}`);
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) if (fs.existsSync(path.join(pdfjs, d))) copy(path.join(pdfjs, d), `pdfjs/${d}`);
const three = path.dirname(require.resolve('three'));
for (const f of ['three.module.js', 'three.core.js']) copy(path.join(three, f), `three/${f}`);

const sio = path.join(path.dirname(require.resolve('socket.io/package.json')), 'client-dist', 'socket.io.min.js');
copy(sio, 'socket.io/socket.io.js');

fs.writeFileSync(path.join(out, 'app-shell.js'), fs.readFileSync(path.join(root, 'mobile', 'app-shell.js'), 'utf8').replace('__VERSION__', version));
await build({
  entryPoints: [path.join(root, 'mobile', 'native-ble.js')],
  bundle: true, format: 'iife', target: 'chrome100', minify: true,
  outfile: path.join(out, 'native-ble.js'), logLevel: 'warning',
});

// index.html: the app shell first, the native GoDice driver after the extension's driver, no Particula script
let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error(`index.html changed: can't find ${from}`); html = html.replace(from, to); };
swap('<body>', '<body>\n  <script src="/app-shell.js"></script>');
swap('<script src="/js/lib/godice-ble.js"></script>', '<script src="/js/lib/godice-ble.js"></script>\n  <script src="/native-ble.js"></script>');
html = html.replace(/\s*<!-- Optional: Particula[^>]*-->\s*<script src="\/vendor\/godice\.js"[^>]*><\/script>/, '');
// fonts come from Google when online; the app looks fine without them
fs.writeFileSync(path.join(out, 'index.html'), html);

console.log(`Built mobile/www for Lantern ${version}`);
