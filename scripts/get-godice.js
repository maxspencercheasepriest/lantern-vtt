// Downloads Particula's official GoDice JavaScript API into public/vendor/.
// It isn't bundled with Lantern because its licence doesn't allow redistribution:
// fetching it yourself means you accept Particula's API licence (personal, non-commercial use).
// https://github.com/ParticulaCode/GoDiceJavaScriptAPI
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://raw.githubusercontent.com/ParticulaCode/GoDiceJavaScriptAPI/main/godice.js';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor');
const out = path.join(dir, 'godice.js');

const res = await fetch(URL);
if (!res.ok) {
  console.error(`Download failed: ${res.status} ${res.statusText}`);
  console.error(`Grab godice.js by hand from https://github.com/ParticulaCode/GoDiceJavaScriptAPI and put it at ${out}`);
  process.exit(1);
}
const body = await res.text();
if (!body.includes('class GoDice')) {
  console.error("That didn't look like the GoDice library — not saving it.");
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(out, body);
console.log(`Saved GoDice API to ${out}`);
console.log("By using it you're accepting Particula's API licence (personal, non-commercial use).");
