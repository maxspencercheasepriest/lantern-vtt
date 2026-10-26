// PDF library: indexing, search, sharing and access control, through the real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { fileURLToPath } from 'node:url';
import { parseQuery, fold } from '../library.js';

const PORT = 3998;
const URL = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-lib-'));
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, GM_PASSWORD: 'secret', DATA_DIR: dataDir }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => d.toString().includes('running') && resolve());
    proc.on('exit', reject);
  });
});
after(() => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const client = () => io(URL, { transports: ['websocket'], forceNew: true });
const emit = (s, evt, p) => new Promise((r) => s.emit(evt, p, r));
const waitFor = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)); }
};

test('query parsing', () => {
  assert.deepEqual(parseQuery('Laser "Gun Combat" laser'), ['laser', 'gun combat']);
  assert.equal(fold('Café  “Quote”'), 'cafe "quote"');
});

test('upload, index, share, search, access control', async () => {
  const gm = client(), pl = client(), other = client();
  let gmLib = [], plLib = [];
  gm.on('library', (l) => { gmLib = l; });
  pl.on('library', (l) => { plLib = l; });
  try {
    const g = await emit(gm, 'join', { room: 'camp', name: 'Flick', gmPassword: 'secret' });
    const p = await emit(pl, 'join', { room: 'camp', name: 'Portia' });
    const o = await emit(other, 'join', { room: 'elsewhere', name: 'Portia' });

    // players can't upload
    const fd0 = new FormData();
    fd0.append('file', new Blob([fs.readFileSync(path.join(fixtures, 'handouts.pdf'))], { type: 'application/pdf' }), 'h.pdf');
    assert.equal((await fetch(`${URL}/api/library`, { method: 'POST', body: fd0, headers: { 'x-upload-token': p.uploadToken } })).status, 403);

    // non-PDFs are refused
    const bad = new FormData();
    bad.append('file', new Blob(['hello'], { type: 'application/pdf' }), 'fake.pdf');
    assert.equal((await fetch(`${URL}/api/library`, { method: 'POST', body: bad, headers: { 'x-upload-token': g.uploadToken } })).status, 400);

    const fd = new FormData();
    for (const f of ['frontier-core.pdf', 'handouts.pdf']) fd.append('file', new Blob([fs.readFileSync(path.join(fixtures, f))], { type: 'application/pdf' }), f);
    const up = await (await fetch(`${URL}/api/library`, { method: 'POST', body: fd, headers: { 'x-upload-token': g.uploadToken } })).json();
    assert.equal(up.ids.length, 2);
    await waitFor(() => gmLib.length === 2 && gmLib.every((d) => d.status === 'ready'));
    const core = gmLib.find((d) => d.title === 'frontier-core');
    const hand = gmLib.find((d) => d.title === 'handouts');
    assert.equal(core.pages, 8);

    // nothing shared yet
    assert.equal(plLib.length, 0);
    assert.equal((await emit(pl, 'library:search', { q: 'laser' })).results.length, 0);
    assert.equal((await fetch(`${URL}/api/library/${core.id}.pdf`, { headers: { 'x-upload-token': p.uploadToken } })).status, 404);

    // share the core book with everyone in this campaign, handouts with nobody
    assert.ok((await emit(pl, 'library:update', { id: core.id, share: 'all' })).error);
    assert.ok((await emit(gm, 'library:update', { id: core.id, share: 'all' })).ok);
    await waitFor(() => plLib.length === 1);
    const r = await emit(pl, 'library:search', { q: 'laser pistol' });
    assert.equal(r.results[0].page, 6);
    assert.match(r.results[0].snippet, /Laser pistols/);
    assert.equal((await emit(pl, 'library:search', { q: 'merchant princess' })).results.length, 0); // in the unshared handouts
    assert.equal((await emit(gm, 'library:search', { q: '"merchant princess"' })).results[0].docId, hand.id);

    // the PDF itself, with range requests (pdf.js loads big books a piece at a time)
    const res = await fetch(`${URL}/api/library/${core.id}.pdf`, { headers: { 'x-upload-token': p.uploadToken, Range: 'bytes=0-7' } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), '%PDF-1.4');

    // sharing is per campaign: same player name in another room sees nothing
    assert.equal((await emit(other, 'library:search', { q: 'laser' })).results.length, 0);
    assert.equal((await fetch(`${URL}/api/library/${core.id}.pdf`, { headers: { 'x-upload-token': o.uploadToken } })).status, 404);

    // delete
    assert.ok((await emit(gm, 'library:delete', { id: hand.id })).ok);
    await waitFor(() => gmLib.length === 1);
  } finally {
    gm.close(); pl.close(); other.close();
  }
});
