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
  assert.equal(saved.scenes.length, 1);
  assert.equal(saved.activeScene, saved.scenes[0].id);
  assert.equal(saved.scenes[0].tokens.length, 2);
  assert.equal(saved.sheets[0].data.name, 'Jax II');
});

test('upload requires a joined session and an image', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'a.png');
  const res = await fetch(`${URL}/api/upload`, { method: 'POST', body: fd });
  assert.equal(res.status, 401);
});

test('audio: GM uploads and plays, players follow, effects reach everyone', async () => {
  const gm = client(), pl = client();
  try {
    const gj = await emit(gm, 'join', { room: 'sound', name: 'Flick', gmPassword: 'secret' });
    const pj = await emit(pl, 'join', { room: 'sound', name: 'Portia' });
    const tone = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'tone.mp3'));
    const up = (token, name = 'tone.mp3', kind = 'music', duration = '3') => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('duration', duration);
      fd.append('file', new Blob([tone], { type: 'audio/mpeg' }), name);
      return fetch(`${URL}/api/audio`, { method: 'POST', body: fd, headers: { 'x-upload-token': token } });
    };
    // players can't upload, and only audio is accepted
    assert.equal((await up(pj.uploadToken)).status, 403);
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
    assert.equal((await fetch(`${URL}/api/audio`, { method: 'POST', body: fd, headers: { 'x-upload-token': gj.uploadToken } })).status, 400);

    const stateP = next(pl, 'audio');
    const res = await up(gj.uploadToken, 'Tavern_Theme.mp3');
    assert.equal(res.status, 200);
    const { id } = await res.json();
    const st = await stateP;
    assert.equal(st.tracks[0].name, 'Tavern Theme');
    assert.equal(st.tracks[0].duration, 3);
    // the file is served, with ranges (seeking)
    const file = await fetch(`${URL}${st.tracks[0].url}`, { headers: { range: 'bytes=0-99' } });
    assert.equal(file.status, 206);

    assert.equal((await emit(pl, 'audio:music', { action: 'play', id })).error, 'GM only');
    const playP = next(pl, 'audio');
    assert.ok((await emit(gm, 'audio:music', { action: 'play', id })).ok);
    const playing = await playP;
    assert.ok(playing.music.playing && playing.music.trackId === id);
    assert.ok(Math.abs(playing.serverNow - Date.now()) < 2000);

    // a 3-second track with nothing after it, repeat off: the server stops it when it ends
    await emit(gm, 'audio:music', { action: 'repeat', value: 'off' });
    const endP = new Promise((r) => pl.on('audio', (a) => { if (!a.music.playing) r(a); }));
    const ended = await endP;
    assert.equal(ended.music.playing, false);

    // ambience and effects
    const amb = await (await up(gj.uploadToken, 'rain.mp3', 'ambience', '0')).json();
    assert.ok((await emit(gm, 'audio:ambience', { id: amb.id, on: true })).ok);
    const fxP = next(pl, 'audio:effect');
    await emit(gm, 'audio:effect', { id: amb.id });
    assert.equal((await fxP).id, amb.id);
    // late joiners get the current state
    const late = client();
    const lateP = next(late, 'audio');
    await emit(late, 'join', { room: 'sound', name: 'Ben' });
    assert.deepEqual((await lateP).ambience, [amb.id]);
    late.close();
    // deleting removes the file
    const url = st.tracks[0].url;
    assert.ok((await emit(gm, 'audio:delete', { id })).ok);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await fetch(`${URL}${url}`)).status, 404);
  } finally {
    gm.close(); pl.close();
  }
});

test('scenes: GM previews and moves players; walls block players; doors; drawings', async () => {
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'scenes', name: 'Flick', gmPassword: 'secret' });
    const listP = next(pl, 'scenes');
    await emit(pl, 'join', { room: 'scenes', name: 'Portia' });
    const first = await listP;
    assert.deepEqual(first.list, []); // players don't get the GM's scene list

    // GM makes a second scene and looks at it; the player stays put
    const gmSceneP = next(gm, 'scene');
    const { id: cellar } = await emit(gm, 'scene:create', { name: 'Cellar', map: { width: 1000, height: 1000, gridSize: 100 } });
    assert.equal((await gmSceneP).name, 'Cellar');
    assert.equal((await emit(pl, 'scene:create', { name: 'x' })).error, 'GM only');
    // a token added now goes on the scene the GM is looking at
    const tok = await emit(gm, 'token:add', { x: 200, y: 450, label: 'Portia', owners: ['Portia'] });
    await emit(gm, 'wall:add', { walls: [
      { a: [500, 0], b: [500, 400] }, { a: [500, 400], b: [500, 600], kind: 'door' }, { a: [500, 600], b: [500, 1000] },
    ] });
    await emit(gm, 'fog:set', { mode: 'sight' });

    // move everyone to the cellar
    const plSceneP = next(pl, 'scene');
    assert.ok((await emit(gm, 'scene:activate', { id: cellar })).ok);
    const ps = await plSceneP;
    assert.equal(ps.name, 'Cellar');
    assert.equal(ps.walls.length, 3);
    assert.ok(ps.fog.explored?.bits, 'the party has already seen part of the cellar');
    const door = ps.walls.find((w) => w.kind === 'door');

    // walking through the closed door is refused; opening it lets the token through
    assert.equal((await emit(pl, 'token:move', { id: tok.id, x: 700, y: 450, final: true })).error, "There's a wall in the way");
    assert.ok((await emit(pl, 'door:toggle', { id: door.id })).open);
    assert.ok((await emit(pl, 'token:move', { id: tok.id, x: 700, y: 450, final: true })).ok);
    // a locked door stays shut for players
    await emit(gm, 'wall:update', { id: door.id, open: false, locked: true });
    assert.equal((await emit(pl, 'door:toggle', { id: door.id })).error, 'The door is locked');

    // drawings: players draw and erase their own; GM-only drawings stay hidden
    const mine = await emit(pl, 'draw:add', { kind: 'line', pts: [0, 0, 100, 100], color: '#ff0000' });
    assert.ok(mine.id);
    const secretP = new Promise((r) => pl.on('scene', (sc) => { if (sc.drawings.length === 1) r(sc); }));
    await emit(gm, 'draw:add', { kind: 'rect', pts: [0, 0, 50, 50], gmOnly: true });
    assert.equal((await secretP).drawings.length, 1, "the player can't see the GM's private drawing");
    const gmDraw = (await new Promise((r) => { gm.once('scene', r); emit(gm, 'scene:view', { id: cellar }); })).drawings.find((d) => d.gmOnly);
    assert.equal((await emit(pl, 'draw:remove', { id: gmDraw.id })).error, 'Nothing of yours to erase there');
    assert.ok((await emit(pl, 'draw:remove', { id: mine.id })).ok);
    await emit(gm, 'scene:update', { id: cellar, playerDraw: false });
    assert.equal((await emit(pl, 'draw:add', { kind: 'line', pts: [0, 0, 1, 1] })).error, 'The GM has turned off drawing for players');

    // the first scene can be deleted, but not the last one
    const list = await new Promise((r) => { gm.once('scenes', r); emit(gm, 'scene:view', { id: null }); });
    assert.equal(list.list.length, 2);
    assert.ok((await emit(gm, 'scene:delete', { id: list.list[0].id })).ok);
    assert.equal((await emit(gm, 'scene:delete', { id: cellar })).error, 'A campaign needs at least one scene');
  } finally {
    gm.close(); pl.close();
  }
});

test('old single-map campaigns become Scene 1', async () => {
  fs.writeFileSync(path.join(dataDir, 'rooms', 'legacy.json'), JSON.stringify({
    id: 'legacy', scene: { map: { image: null, width: 1234, height: 900, gridSize: 50 }, tokens: [{ id: 't1', x: 1, y: 2, size: 1, label: 'Old' }], fog: { enabled: true, ops: [{ type: 'reveal', x: 0, y: 0, w: 10, h: 10 }] } },
  }));
  const gm = client();
  try {
    const sceneP = next(gm, 'scene');
    await emit(gm, 'join', { room: 'legacy', name: 'Flick', gmPassword: 'secret' });
    const sc = await sceneP;
    assert.equal(sc.name, 'Scene 1');
    assert.equal(sc.map.width, 1234);
    assert.equal(sc.tokens[0].label, 'Old');
    assert.equal(sc.fog.mode, 'manual');
    assert.equal(sc.fog.ops.length, 1);
  } finally { gm.close(); }
});
