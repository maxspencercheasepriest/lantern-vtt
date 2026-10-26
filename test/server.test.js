// End-to-end: boots the server on a spare port and drives it with socket.io clients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-test-'));
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
const next = (s, evt) => new Promise((r) => s.once(evt, r));

test('GM and player permissions, hidden tokens, sheets, rolls', async () => {
  const gm = client(), pl = client();
  try {
    assert.equal((await emit(gm, 'join', { room: 'test', name: 'GM', gmPassword: 'nope' })).error, 'Wrong GM password');
    const gj = await emit(gm, 'join', { room: 'test', name: 'Flick', gmPassword: 'secret' });
    assert.ok(gj.ok && gj.isGM);
    const pj = await emit(pl, 'join', { room: 'test', name: 'Portia' });
    assert.ok(pj.ok && !pj.isGM);

    // players can't add tokens; GM can
    assert.equal((await emit(pl, 'token:add', { x: 0, y: 0 })).error, 'GM only');
    const mine = await emit(gm, 'token:add', { x: 70, y: 70, label: 'Portia', owners: ['Portia'] });
    const secret = await emit(gm, 'token:add', { x: 140, y: 70, label: 'Ambush', hidden: true });

    // player view hides the hidden token
    await new Promise((r) => setTimeout(r, 120));
    const sceneP = next(pl, 'scene');
    await emit(pl, 'token:move', { id: mine.id, x: 210, y: 70, final: true });
    const s = await sceneP;
    assert.equal(s.tokens.length, 1);
    assert.equal(s.tokens[0].x, 210);
    assert.equal((await emit(pl, 'token:move', { id: secret.id, x: 0, y: 0 })).error, "That's not your token");

    // sheets: player creates, GM sees, other player can't edit
    const sh = await emit(pl, 'sheet:create', { system: 'traveller', data: { name: 'Jax' } });
    assert.ok(sh.id);
    const other = client();
    await emit(other, 'join', { room: 'test', name: 'Ben' });
    assert.equal((await emit(other, 'sheet:update', { id: sh.id, data: { name: 'hacked' } })).error, "You can't edit that sheet");
    assert.ok((await emit(gm, 'sheet:update', { id: sh.id, data: { name: 'Jax II' } })).ok);
    other.close();

    // digital roll lands in chat for both; GM-only roll is hidden from the other player
    const chatP = next(pl, 'chat');
    const r = await emit(gm, 'roll:digital', { expr: '2d6+1', label: 'Test' });
    assert.ok(r.total >= 3 && r.total <= 13);
    const m = await chatP;
    assert.equal(m.kind, 'roll');
    assert.equal(m.result.total, r.total);

    let leaked = false;
    pl.on('chat', (msg) => { if (msg.label === 'secret') leaked = true; });
    await emit(gm, 'roll:digital', { expr: '1d20', label: 'secret', visibility: 'gm' });
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(leaked, false);

    // physical (GoDice) results are accepted and tagged
    const physP = next(gm, 'chat');
    await emit(pl, 'roll:physical', {
      result: { expr: '2d6', total: 9, flags: [], parts: [{ type: 'dice', sign: 1, sides: 6, count: 2, subtotal: 9, dice: [{ sides: 6, chain: [4], value: 4, kept: true }, { sides: 6, chain: [5], value: 5, kept: true }] }] },
      sources: ['godice'], label: 'Pilot',
    });
    const pm = await physP;
    assert.equal(pm.source, 'godice');
    assert.equal(pm.result.total, 9);

    // bad expressions are rejected
    assert.ok((await emit(gm, 'roll:digital', { expr: '1d6; drop table' })).error);
  } finally {
    gm.close(); pl.close();
  }
});

test('state persists to disk', async () => {
  await new Promise((r) => setTimeout(r, 1000));
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms', 'test.json'), 'utf8'));
  assert.equal(saved.scene.tokens.length, 2);
  assert.equal(saved.sheets[0].data.name, 'Jax II');
});

test('upload requires a joined session and an image', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'a.png');
  const res = await fetch(`${URL}/api/upload`, { method: 'POST', body: fd });
  assert.equal(res.status, 401);
});
