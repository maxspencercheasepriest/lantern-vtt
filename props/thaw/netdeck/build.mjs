import { readFile, writeFile, mkdir } from 'node:fs/promises';

const here = u => new URL(u, import.meta.url);
const data = await readFile(here('./data.js'), 'utf8');
const app = await readFile(here('./app.html'), 'utf8');

if (!app.includes('/*__DATA__*/')) throw new Error('data marker missing from app.html');
const out = app.replace('/*__DATA__*/', () => '\n' + data + '\n');

const out_ = here('../../../public/handouts/thaw/netdeck.html');
await mkdir(new URL('.', out_), { recursive: true });
await writeFile(out_, out);
console.log('built public/handouts/thaw/netdeck.html  —', (out.length / 1024).toFixed(1) + ' KB');
