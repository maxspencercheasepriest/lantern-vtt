import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { CREDS, PUBLIC, STAFF, DIRECTOR } from './content.mjs';

const ITERATIONS = 250000;
const enc = new TextEncoder();
const b64 = buf => Buffer.from(new Uint8Array(buf)).toString('base64');

async function deriveKey(secret, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function seal(obj, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

const staffSecret = (u, p) => u.trim().toLowerCase() + '::' + p;
const dirSecret = p => 'director::' + p;

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const payload = {
  public: {
    ...PUBLIC,
    yearOffset: 19,
    gameDate: null,
    userHash: await sha256hex(CREDS.staffUser.trim().toLowerCase()),
  },
  staff: await seal(STAFF, staffSecret(CREDS.staffUser, CREDS.staffPass)),
  director: await seal(DIRECTOR, dirSecret(CREDS.directorPass)),
};

const template = await readFile(new URL('./template.html', import.meta.url), 'utf8');
const re = /\/\*__PAYLOAD_START__\*\/[\s\S]*?\/\*__PAYLOAD_END__\*\//;
if (!re.test(template)) throw new Error('payload markers not found in template');

const block = '/*__PAYLOAD_START__*/\nconst PAYLOAD = ' + JSON.stringify(payload) + ';\n/*__PAYLOAD_END__*/';
const out = template.replace(re, () => block);

// Sanity: no plaintext from the sealed tiers may survive into the build.
const leaks = [CREDS.staffPass, CREDS.directorPass, CREDS.staffUser, 'Achebe', 'PERSEPHONE', 'Brandt', 'Depository']
  .filter(s => out.includes(s));
if (leaks.length) throw new Error('PLAINTEXT LEAK in build: ' + leaks.join(', '));

const OUT = new URL('../../../public/handouts/thaw/lindqvist-portal.html', import.meta.url);
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, out);

console.log('built public/handouts/thaw/lindqvist-portal.html');
console.log('  size        ', (out.length / 1024).toFixed(1) + ' KB');
console.log('  staff       ', CREDS.staffUser + ' / ' + CREDS.staffPass);
console.log('  director    ', CREDS.directorPass);
console.log('  leak check   clean');
