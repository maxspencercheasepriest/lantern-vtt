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

test('the page loads its files from this start\'s address, so an update never mixes old and new scripts', async () => {
  const res = await fetch(`${URL}/`);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const html = await res.text();
  const stamp = html.match(/src="\/v\/([^/]+)\/js\/app\.js"/)?.[1];
  assert.ok(stamp && stamp.startsWith(JSON.parse(fs.readFileSync('package.json', 'utf8')).version), 'app.js is stamped');
  assert.ok(!/(src|href)="\/(js|css)\//.test(html), 'nothing left on the old addresses');
  const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]).imports;
  assert.equal(map['/js/'], `/v/${stamp}/js/`);
  assert.equal(map['/v/shared/'], `/v/${stamp}/shared/`); // '../../shared/' from a stamped /js/ file
  const app = await fetch(`${URL}/v/${stamp}/js/app.js`);
  assert.equal(app.status, 200);
  assert.match(app.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${URL}/v/${stamp}/shared/coc.js`)).status, 200);
  const old = await fetch(`${URL}/v/0.1.0-old/js/app.js`); // a page from before a restart still works, uncached
  assert.equal(old.status, 200);
  assert.equal(old.headers.get('cache-control'), 'no-cache');
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

test('video relay: free relay credentials by default; GM can switch; players cannot', async () => {
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'vid', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'vid', name: 'Portia' });
    const j = await emit(pl, 'av:join', { audio: true, video: false });
    const relay = j.iceServers.find((s) => [].concat(s.urls).some((u) => u.startsWith('turn')));
    assert.ok(relay, 'a relay is offered by default');
    // shared-secret TURN: "<expiry>:<name>", signed with HMAC-SHA1
    const [expiry, who] = relay.username.split(':');
    assert.ok(+expiry > Date.now() / 1000 + 3600 && who === 'Portia');
    const crypto = await import('node:crypto');
    assert.equal(relay.credential, crypto.createHmac('sha1', 'openrelayprojectsecret').update(relay.username).digest('base64'));
    await emit(pl, 'av:leave', {});
    assert.equal((await emit(pl, 'video:settings', { set: { relay: 'off' } })).error, 'GM only');
    assert.equal((await emit(gm, 'video:settings', { set: { relay: 'custom', url: 'http://nope' } })).error, 'A relay address starts with turn: or turns:');
    const saved = await emit(gm, 'video:settings', { set: { relay: 'custom', url: 'turn:relay.example.com:3478', username: 'u', credential: 'p' } });
    assert.equal(saved.relay, 'custom'); assert.equal(saved.hasCredential, true); assert.equal(saved.credential, undefined);
    // saving again without a password keeps the old one
    await emit(gm, 'video:settings', { set: { relay: 'custom', url: 'turn:relay.example.com:3478', username: 'u' } });
    const j2 = await emit(pl, 'av:join', { audio: true });
    assert.deepEqual(j2.iceServers[1], { urls: ['turn:relay.example.com:3478'], username: 'u', credential: 'p' });
    await emit(pl, 'av:leave', {});
    await emit(gm, 'video:settings', { set: { relay: 'off' } });
    assert.equal((await emit(pl, 'av:join', { audio: true })).iceServers.length, 1);
    await emit(pl, 'av:leave', {});
    await emit(gm, 'video:settings', { set: { relay: 'free' } });
  } finally { gm.close(); pl.close(); }
});

test('tokens from character sheets', async () => {
  const gm = client(), pl = client(), other = client();
  try {
    await emit(gm, 'join', { room: 'drag', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'drag', name: 'Portia' });
    await emit(other, 'join', { room: 'drag', name: 'Ben' });
    const mine = await emit(pl, 'sheet:create', { system: 'coc7', data: { name: 'Harold Wainwright', portrait: '/uploads/0123456789abcdef0123.png' } });
    const npc = await emit(gm, 'sheet:create', { system: 'coc7', data: { name: 'Cultist' } });
    assert.equal((await emit(other, 'token:from-sheet', { sheetId: mine.id, x: 0, y: 0 })).error, 'You can only place your own character');
    const sceneP = new Promise((r) => pl.on('scene', (sc) => { if (sc.tokens.length) r(sc); }));
    assert.ok((await emit(pl, 'token:from-sheet', { sheetId: mine.id, x: 140, y: 70, bar: { cur: 9, max: 11 } })).ok);
    const t = (await sceneP).tokens[0];
    assert.equal(t.label, 'Harold Wainwright');
    assert.deepEqual(t.owners, ['Portia']);
    assert.equal(t.sheetId, mine.id);
    assert.equal(t.image, '/uploads/0123456789abcdef0123.png');
    assert.deepEqual(t.bar, { cur: 9, max: 11 });
    assert.equal((await emit(pl, 'token:from-sheet', { sheetId: mine.id, x: 0, y: 0 })).error, "Your character's already on this map");
    // the GM's own sheets become NPC tokens nobody else controls
    assert.ok((await emit(gm, 'token:from-sheet', { sheetId: npc.id, x: 300, y: 300 })).ok);
    const gmScene = await new Promise((r) => { gm.once('scene', r); emit(gm, 'scene:view', { id: null }); });
    assert.deepEqual(gmScene.tokens.find((x) => x.label === 'Cultist').owners, []);
  } finally { gm.close(); pl.close(); other.close(); }
});

test('props: sandboxed pages with shared storage, sharing, uploads', async () => {
  const { zipSync, strToU8 } = await import('fflate');
  const gm = client(), pl = client(), other = client();
  try {
    const g = await emit(gm, 'join', { room: 'props', name: 'Flick', gmPassword: 'secret' });
    const p = await emit(pl, 'join', { room: 'props', name: 'Portia' });
    const o = await emit(other, 'join', { room: 'props', name: 'Ben' });
    assert.ok(g.propKey && p.propKey && g.propKey !== p.propKey);
    // the Thaw props belong to Cyberpunk RED: not there until the campaign is one
    assert.equal((await fetch(`${URL}/p/${g.propKey}/thaw/market.html`)).status, 404);
    assert.equal((await emit(gm, 'prop:show', { coll: 'thaw', file: 'market.html', to: 'all' })).error, 'No such prop');
    const cprList = next(gm, 'props');
    await emit(gm, 'settings:update', { ruleset: 'cpr' });
    assert.ok((await cprList).some((c) => c.id === 'thaw'), 'listed once it is a Cyberpunk game');
    // the built-in Thaw props are listed for the GM, not yet for players
    const page = (key, file = 'market.html') => fetch(`${URL}/p/${key}/thaw/${file}`);
    let r = await page(g.propKey);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /^sandbox allow-scripts/);
    const html = await r.text();
    assert.ok(html.indexOf('window.lantern') < html.indexOf('nightmarket.v1'), 'the helper runs before the prop');
    assert.equal((await page(p.propKey)).status, 404, 'not shared with the player yet');
    assert.equal((await fetch(`${URL}/p/nonsense/thaw/market.html`)).status, 401);
    assert.equal((await page(g.propKey, '../../server.js')).status, 404, 'no escaping the prop folder');

    // GM shows the market to Portia only: she gets a chat card and access to the whole collection
    const cardP = next(pl, 'chat');
    const listForHer = next(pl, 'props');
    assert.ok((await emit(gm, 'prop:show', { coll: 'thaw', file: 'market.html', to: ['Portia'] })).ok);
    const card = await cardP;
    assert.equal(card.kind, 'prop'); assert.equal(card.title, 'NIGHT MARKET');
    // her Library lists only what she's been shown; the rest of the set still loads (DECK/OS launches it)
    assert.deepEqual((await listForHer)[0].pages.map((x) => x.file), ['market.html']);
    assert.equal((await page(p.propKey, 'ripper.html')).status, 200);
    assert.equal((await page(o.propKey)).status, 404, 'Ben still can\'t see it');

    // shared storage: Portia's purse change reaches the GM's open page as an event
    const api = (key) => `${URL}/p/${key}/thaw/__lantern`;
    const ac = new AbortController();
    const events = await fetch(`${api(g.propKey)}/events`, { signal: ac.signal });
    const reader = events.body.getReader();
    const post = (key, body) => fetch(`${api(key)}/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(p.propKey, { key: 'nightmarket.v1', value: '{"eddies":500}', by: 'x' })).status, 200);
    let got = '';
    while (!got.includes('nightmarket')) got += new TextDecoder().decode((await reader.read()).value);
    assert.match(got, /event: state\ndata: .*"value":"\{\\"eddies\\":500\}"/);
    ac.abort();
    const st = await (await fetch(`${api(g.propKey)}/state`)).json();
    assert.equal(st.state['nightmarket.v1'], '{"eddies":500}');
    // and the next page load starts with it
    assert.match(await (await page(p.propKey, 'gigs.html')).text(), /eddies\\":500/);
    // spending from a shared purse: many changes at the same moment all count, nothing is lost
    const upd = (key, body) => fetch(`${api(key)}/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const init = JSON.stringify({ balance: 1500, items: [{ stock: 3 }, { stock: 1 }] });
    await post(p.propKey, { key: 'purse.test', value: null, by: 'x' });
    const spends = [];
    for (let i = 0; i < 20; i++) spends.push(upd(i % 2 ? p.propKey : g.propKey, { key: 'purse.test', init, ops: [{ path: 'balance', add: -10 }, { path: 'items.1.stock', add: -1, min: 0 }] }));
    const results = await Promise.all(spends);
    assert.ok(results.every((x) => x.status === 200));
    const purse = JSON.parse((await (await fetch(`${api(g.propKey)}/state`)).json()).state['purse.test']);
    assert.equal(purse.balance, 1300, 'twenty spends of 10 from 1500');
    assert.equal(purse.items[1].stock, 0, 'stock never goes below zero');
    assert.equal(purse.items[0].stock, 3);
    const set = await (await upd(g.propKey, { key: 'purse.test', ops: [{ path: 'balance', set: 2000 }] })).json();
    assert.equal(JSON.parse(set.value).balance, 2000);
    assert.equal((await upd(g.propKey, { key: 'purse.test', ops: [{ path: '__proto__.x', add: 1 }] })).status, 400);
    assert.equal((await upd(g.propKey, { key: 'purse.test', ops: [{ path: 'nope.deeper', add: 1 }] })).status, 409);
    assert.equal((await upd('nonsense', { key: 'purse.test', ops: [{ path: 'balance', add: 1 }] })).status, 401);
    // the toolkit: rolls land in chat as the player
    const rollP = new Promise((res) => gm.on('chat', (m) => { if (m.kind === 'roll') res(m); }));
    const roll = await (await fetch(`${api(p.propKey)}/roll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"expr":"1d10+4","label":"Interface"}' })).json();
    assert.ok(roll.total >= 5 && roll.total <= 14);
    assert.equal((await rollP).from, 'Portia');

    // shopping: what a prop sells goes on the buyer's own sheet, and nowhere else
    const buy = (key, items) => fetch(`${api(key)}/buy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) });
    assert.equal((await (await buy(p.propKey, [{ name: 'Agent', qty: 1, price: 120 }])).json()).reason, 'nosheet',
      'nothing to put it on until she has a character');
    const sheetP = next(pl, 'sheets');
    await emit(pl, 'sheet:create', { system: 'cpr', data: { name: 'Portia', eddies: 500, weapons: [], cyberware: '', gear: '' } });
    await sheetP;
    const gmSeesChat = new Promise((res) => gm.on('chat', (m) => { if (/bought/.test(m.text || '')) res(m); }));
    const sold = await (await buy(p.propKey, [
      { name: 'Heavy Pistol', qty: 1, price: 140, kind: 'weapon', skill: 'Handgun', damage: '3d6', rof: 2 },
      { name: 'Anti-Smog Mask', qty: 2, price: 25 },
    ])).json();
    assert.equal(sold.ok, true);
    assert.equal(sold.money, 500 - 140 - 50, 'eddies come off the sheet');
    assert.equal(sold.name, 'Portia');
    const hers = (await (await fetch(`${api(p.propKey)}/sheet`)).json()).data;
    assert.deepEqual(hers.weapons, [{ name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 }]);
    assert.equal(hers.gear, '2× Anti-Smog Mask (50eb)');
    assert.equal(hers.eddies, 310);
    assert.match((await gmSeesChat).text, /^bought 2 items \(190eb\) · Thaw/);
    assert.equal((await buy(o.propKey, [{ name: 'Agent', qty: 1, price: 120 }])).status, 404,
      "Ben can't buy from a prop he hasn't been shown");
    assert.equal((await buy(p.propKey, [])).status, 400);

    // uploads: a zip of a folder becomes a collection; players can't upload
    const zip = zipSync({ 'console/index.html': strToU8('<html><head><title>Ship Console</title></head><body>hi</body></html>'), 'console/img/x.txt': strToU8('x') });
    const fd = (key) => { const f = new FormData(); f.append('file', new Blob([zip]), 'console.zip'); return fetch(`${URL}/api/props`, { method: 'POST', body: f, headers: { 'x-upload-token': key } }); };
    assert.equal((await fd(p.uploadToken)).status, 403);
    const listP = next(gm, 'props');
    const up = await fd(g.uploadToken);
    assert.equal(up.status, 200);
    const { id } = await up.json();
    const list = await listP;
    const c = list.find((x) => x.id === id);
    assert.equal(c.pages[0].title, 'Ship Console');
    assert.match(await (await fetch(`${URL}/p/${g.propKey}/${id}/index.html`)).text(), /Ship Console/);
    assert.ok((await emit(gm, 'prop:delete', { coll: id })).ok);
    assert.equal((await emit(gm, 'prop:delete', { coll: 'thaw' })).error, "Built-in props can't be deleted");
  } finally { gm.close(); pl.close(); other.close(); }
});

test('props: 0.14 whole-collection shares become page shares', async () => {
  fs.writeFileSync(path.join(dataDir, 'rooms', 'oldprops.json'), JSON.stringify({
    id: 'oldprops', settings: { ruleset: 'cpr' }, propShares: { thaw: ['Portia'] },
    chat: [{ id: 'c1', ts: 1, kind: 'prop', coll: 'thaw', file: 'gigs.html', title: 'GIG BOARD', to: ['Portia'], visibility: 'whisper', from: 'Flick' }],
  }));
  const pl = client();
  try {
    const listP = next(pl, 'props');
    await emit(pl, 'join', { room: 'oldprops', name: 'Portia' });
    assert.deepEqual((await listP)[0].pages.map((x) => x.file), ['gigs.html']);
  } finally { pl.close(); }
});

test('3D dice: throws reach everyone before the chat card; table dice move tokens; GM can put them back', async () => {
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'dice3d', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'dice3d', name: 'Portia' });
    // over the screen (the default): the throw comes first, with the same id as the chat card
    const order = [];
    pl.on('dice:throw', (t) => order.push(['throw', t.id, t]));
    pl.on('chat', (m) => order.push(['chat', m.id]));
    await emit(pl, 'roll:digital', { expr: '2d6+1d20' });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(order[0][0], 'throw');
    assert.equal(order[1][0], 'chat');
    assert.equal(order[0][1], order[1][1]);
    const t = order[0][2];
    assert.equal(t.mode, 'screen');
    assert.equal(t.dice.length, 3);
    assert.equal(t.frames[0].length, 21);
    // secret rolls: only the GM gets the dice
    order.length = 0;
    let gmGot = 0; gm.on('dice:throw', () => gmGot++);
    await emit(gm, 'roll:digital', { expr: '1d20', visibility: 'gm' });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(order.length, 0);
    assert.equal(gmGot, 1);

    // players can't change the setting or put tokens back
    const scene = await new Promise((r) => { gm.once('scene', r); emit(gm, 'token:add', { x: 0, y: 0, label: 'probe' }); });
    assert.equal((await emit(pl, 'scene:update', { id: scene.id, dice: 'off' })).error, 'GM only');
    assert.equal((await emit(pl, 'dice:putback', {})).error, 'GM only');

    // off: no dice
    assert.ok((await emit(gm, 'scene:update', { id: scene.id, dice: 'off' })).ok);
    await emit(pl, 'roll:digital', { expr: '1d6' });
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(order.map((o) => o[0]), ['chat']);

    // on the table: crowd the view with tokens and throw until something gets knocked about
    assert.ok((await emit(gm, 'scene:update', { id: scene.id, dice: 'table' })).ok);
    for (let i = 0; i < 20; i++) await emit(gm, 'token:add', { x: 140 + (i % 5) * 100, y: 140 + Math.floor(i / 5) * 100, label: `t${i}` });
    pl.emit('dice:view', { x: 0, y: 0, w: 700, h: 560 });
    await new Promise((r) => setTimeout(r, 50));
    let moved = null;
    for (let k = 0; k < 8 && !moved; k++) {
      const got = new Promise((r) => pl.once('dice:throw', r));
      await emit(pl, 'roll:digital', { expr: '4d6+1d20' });
      const th = await got;
      assert.equal(th.mode, 'table');
      assert.deepEqual(th.rect, { x: 0, y: 0, w: 700, h: 560 });
      if (th.tokens.length) moved = th;
    }
    assert.ok(moved, 'the dice hit a token');
    const knocked = new Promise((r) => gm.once('dice:knocked', r));
    const k = await knocked;
    assert.ok(k.count >= 1);
    const putBack = await emit(gm, 'dice:putback', {});
    assert.ok(putBack.ok && putBack.count === k.count);
    const after = await new Promise((r) => { gm.once('scene', r); emit(gm, 'token:update', { id: scene.tokens[0].id, patch: {} }); });
    for (let i = 0; i < 20; i++) {
      const tk = after.tokens.find((x) => x.label === `t${i}`);
      assert.equal(tk.x, 140 + (i % 5) * 100, `${tk.label} back in place`);
      assert.equal(tk.fallen, undefined);
    }
    assert.equal((await emit(gm, 'dice:putback', {})).error, 'Nothing to put back');
  } finally { gm.close(); pl.close(); }
});

test('the campaign page: the GM page, write-ups and replies, who has played', async () => {
  const { listCampaigns } = await import('../server.js');
  const gm = client(), pl = client(), other = client();
  try {
    let page = next(gm, 'page');
    await emit(gm, 'join', { room: 'forest-of-fear', name: 'Flick', gmPassword: 'secret' });
    let pg = await page;
    assert.equal(pg.id, 'forest-of-fear');
    assert.deepEqual(pg.players, [], 'the GM on their own is prep, not a session');
    page = next(gm, 'page');
    await emit(pl, 'join', { room: 'forest-of-fear', name: 'Molly' });
    pg = await page;
    assert.deepEqual(pg.players.map((u) => [u.name, u.gm, u.sessions]), [['Flick', true, 1], ['Molly', false, 1]], 'two people in: a session for both');
    assert.equal(pg.sessions, 1);

    // only the GM edits the page itself
    assert.equal((await emit(pl, 'page:update', { title: 'Mine now' })).error, 'GM only');
    page = next(pl, 'page');
    const when = new Date(Date.now() + 3 * 864e5).toISOString();
    await emit(gm, 'page:update', { title: 'Forest of Fear - Flight into Darkness', description: 'Weird War II. **Savage Worlds.**', nextSession: when, lookingForPlayers: true });
    pg = await page;
    assert.equal(pg.title, 'Forest of Fear - Flight into Darkness');
    assert.equal(pg.nextSession, when);
    assert.ok(pg.lookingForPlayers);
    page = next(pl, 'page');
    await emit(gm, 'page:update', { nextSession: 'whenever' });
    assert.equal((await page).nextSession, null, 'nonsense dates are cleared');

    // anyone writes up a session; its writer or the GM can change it
    assert.match((await emit(pl, 'page:log:add', { title: 'Session 1', text: '  ' })).error, /Write something/);
    const { id } = await emit(pl, 'page:log:add', { title: 'Session 1: 23/04/2020 plot summary', date: '2020-04-23', text: 'We bailed out over the forest.' });
    await emit(other, 'join', { room: 'forest-of-fear', name: 'Cameron' });
    assert.match((await emit(other, 'page:log:edit', { id, text: 'Rewritten' })).error, /writer or the GM/);
    assert.ok((await emit(pl, 'page:log:edit', { id, text: 'We bailed out over the Black Forest.' })).ok);
    assert.ok((await emit(other, 'page:reply', { id, text: 'And lost the radio.' })).ok);
    page = next(pl, 'page');
    await emit(gm, 'page:reply', { id, text: 'Nice write-up' });
    pg = await page;
    const e = pg.log.find((x) => x.id === id);
    assert.equal(e.by, 'Molly'); assert.equal(e.date, '2020-04-23'); assert.match(e.text, /Black Forest/); assert.ok(e.edited);
    assert.deepEqual(e.replies.map((r) => r.by), ['Cameron', 'Flick']);
    assert.match((await emit(pl, 'page:reply:delete', { id, reply: e.replies[0].id })).error, /writer or the GM/);
    assert.ok((await emit(gm, 'page:reply:delete', { id, reply: e.replies[0].id })).ok);
    assert.equal(pg.players.length, 3);

    // the launcher sees it too
    await new Promise((r) => setTimeout(r, 1500)); // saves are debounced
    const c = listCampaigns(dataDir).find((x) => x.id === 'forest-of-fear');
    assert.equal(c.title, 'Forest of Fear - Flight into Darkness');
    assert.equal(c.writeups, 1);
    assert.equal(c.lastWriteup.by, 'Molly');
    assert.deepEqual(c.players.map((u) => u.name).sort(), ['Cameron', 'Flick', 'Molly']);
    assert.ok((await emit(gm, 'page:log:delete', { id })).ok);
  } finally { gm.close(); pl.close(); other.close(); }
});

test('campaign list for the launcher: newest first, with the GM\'s thumbnail', async () => {
  const { listCampaigns } = await import('../server.js');
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'thumbs', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'thumbs', name: 'Portia' });
    await emit(gm, 'settings:update', { ruleset: 'coc7' });
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
    assert.equal((await emit(pl, 'campaign:thumb', { image: jpeg })).error, 'GM only');
    assert.equal((await emit(gm, 'campaign:thumb', { image: 'data:image/png;base64,AAAA' })).error, 'Bad thumbnail');
    assert.ok((await emit(gm, 'campaign:thumb', { image: jpeg })).ok);
    await new Promise((r) => setTimeout(r, 1500)); // saves are debounced
    const list = listCampaigns(dataDir);
    const c = list.find((x) => x.id === 'thumbs');
    assert.ok(c, 'listed');
    assert.equal(c.ruleset, 'coc7');
    assert.equal(c.scenes, 1);
    assert.ok(c.thumb && fs.readFileSync(c.thumb)[0] === 0xff);
    assert.equal(list[0].id, 'thumbs', 'most recently played first');
    assert.deepEqual(listCampaigns(path.join(dataDir, 'nowhere')), []);
  } finally { gm.close(); pl.close(); }
});

test('in person: the GM can have only their device play the sound', async () => {
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'round-the-table', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'round-the-table', name: 'Portia' });
    assert.equal((await emit(pl, 'settings:update', { soundOn: 'gm' })).error, 'GM only');
    let seen = next(pl, 'settings');
    await emit(gm, 'settings:update', { soundOn: 'gm' });
    assert.equal((await seen).soundOn, 'gm', 'players are told');
    seen = next(pl, 'settings');
    await emit(gm, 'settings:update', { soundOn: 'loud!' });
    assert.equal((await seen).soundOn, 'all', 'anything odd means everyone');
  } finally { gm.close(); pl.close(); }
});

test('importing a Roll20 campaign: GM only, and everything lands in the room', async () => {
  const gm = client(), pl = client();
  try {
    const gj = await emit(gm, 'join', { room: 'brought-over', name: 'Flick', gmPassword: 'secret' });
    const pj = await emit(pl, 'join', { room: 'brought-over', name: 'Portia' });
    await emit(gm, 'settings:update', { ruleset: 'dnd5e' });

    // no pictures in the fixture, so nothing is fetched from the internet
    const campaign = {
      format: 'lantern-roll20', version: 1,
      campaign: { id: 'c9', name: 'Old Game' },
      pages: [{
        id: 'p1', name: 'Crypt', width: 20, height: 15, scale_number: 5, scale_units: 'ft',
        graphics: [{ id: 'g1', name: 'Skeleton', imgsrc: '', left: 175, top: 175, width: 70, height: 70, layer: 'objects', bars: [{ value: '7', max: '7' }] }],
        paths: [{ id: 'w1', layer: 'walls', barrierType: 'wall', points: [[0, 0], [140, 0]] }],
        doors: [],
      }],
      characters: [{ id: 'ch1', name: 'Maela', attribs: [{ name: 'strength', current: '14', max: '' }, { name: 'hp', current: '9', max: '11' }] }],
      handouts: [{ id: 'h1', name: 'A Warning', notes: '<p>Turn <b>back</b>.</p>', inplayerjournals: 'all' }],
      diagnostics: [],
    };
    const post = (token, body = campaign, name = 'old-game.lantern.json') => {
      const fd = new FormData();
      fd.append('file', new Blob([JSON.stringify(body)], { type: 'application/json' }), name);
      return fetch(`${URL}/api/import`, { method: 'POST', body: fd, headers: token ? { 'x-upload-token': token } : {} });
    };

    assert.equal((await post(null)).status, 401, 'strangers cannot import');
    assert.equal((await post(pj.uploadToken)).status, 403, 'players cannot import');
    assert.equal((await post(gj.uploadToken, { format: 'something-else' })).status, 400, 'only our own export is accepted');

    const donePromise = next(gm, 'import:done');
    const res = await post(gj.uploadToken);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, pages: 1, characters: 1, handouts: 1 });

    const { report } = await donePromise;
    assert.equal(report.campaign, 'Old Game');
    assert.deepEqual([report.scenes, report.tokens, report.walls, report.sheets, report.notes], [1, 1, 1, 1, 1]);

    // and it is really in the campaign, saved, with the ruleset's own sheet
    const sheets = await new Promise((r) => { gm.once('sheets', r); gm.emit('sheet:create', { system: 'dnd5e', data: {} }, () => {}); });
    assert.ok(sheets.find((s) => s.data.name === 'Maela' && s.data.abilities.STR === 14 && s.data.hpMax === 11));
    const notes = await new Promise((r) => { gm.once('notes', r); gm.emit('notes:create', { title: 'ping' }, () => {}); });
    const warning = notes.find((n) => n.title === 'A Warning');
    assert.equal(warning.folder, 'Roll20');
    assert.equal(warning.share, 'all');
    assert.match(warning.body, /Turn \*\*back\*\*/);
  } finally { gm.close(); pl.close(); }
});

test('Call of Cthulhu: successful skill rolls tick the sheet; the development phase raises them', async () => {
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'arkwright', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'arkwright', name: 'Ada' });
    const skills = [{ name: 'Spot Hidden', value: 100 }, { name: 'Cthulhu Mythos', value: 100 }, { name: 'Listen', value: 0 }, { name: 'Library Use', value: 99 }];
    const { id } = await emit(pl, 'sheet:create', { system: 'coc7', data: { name: 'Ada', skills, san: 50 } });
    const roll = (skill, target) => emit(pl, 'roll:digital', { expr: 'd100b0', label: skill, meta: { check: { type: 'pct', target, need: 'regular' }, pushable: 'coc', improve: { sheet: id, skill } } });
    const sheet = async () => { const got = next(pl, 'sheets'); await emit(pl, 'sheet:update', { id }); return (await got).find((s) => s.id === id); };
    // a skill of 100 only fails on a fumble (a roll of 100), so a couple of tries is plenty
    for (let i = 0; i < 4 && !(await sheet()).data.skills[0].tick; i++) await roll('Spot Hidden', 100);
    await roll('Cthulhu Mythos', 100);
    const listen = await roll('Listen', 0);
    let s = await sheet();
    assert.equal(s.data.skills[0].tick, true, 'Spot Hidden ticked');
    assert.ok(!s.data.skills[1].tick, 'Cthulhu Mythos never ticks');
    assert.equal(!!s.data.skills[2].tick, listen.total === 1, 'Listen 0 only ticks on a critical');
    // someone else's roll can't tick Ada's sheet
    const other = client();
    await emit(other, 'join', { room: 'arkwright', name: 'Bob' });
    for (let i = 0; i < 3; i++) await emit(other, 'roll:digital', { expr: 'd100b0', meta: { check: { type: 'pct', target: 100 }, improve: { sheet: id, skill: 'Library Use' } } });
    other.close();
    assert.ok(!(await sheet()).data.skills[3].tick, "only the sheet's owner or the GM ticks it");

    assert.match((await emit(gm, 'sheet:develop', { id: 'nope' })).error, /No such sheet/);
    const chat = next(pl, 'chat');
    const dev = await emit(pl, 'sheet:develop', { id });
    assert.ok(dev.ok && dev.checked >= 1);
    const msg = await chat;
    assert.match(msg.text, /Development phase for Ada/);
    assert.match(msg.text, /Spot Hidden: (stays 100|100 → 1\d\d)/);
    s = await sheet();
    assert.ok(s.data.skills.every((sk) => !sk.tick), 'ticks cleared');
    assert.match((await emit(pl, 'sheet:develop', { id })).error, /No skills are ticked/);
  } finally { gm.close(); pl.close(); }
});

test('picture handouts: a zip of pictures, the GM-only list, showing one to everyone', async () => {
  const { zipSync } = await import('fflate');
  const gm = client(), pl = client();
  try {
    const gj = await emit(gm, 'join', { room: 'papers', name: 'Flick', gmPassword: 'secret' });
    const pj = await emit(pl, 'join', { room: 'papers', name: 'Portia' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const zip = zipSync({
      'Pack/Big Campaign - Bloody Garden (Shanghai) - Handout #1.png': png,
      'Pack/Big Campaign - Last Stand (New York) - Handout #2.png': png,
      '__MACOSX/Pack/._Big Campaign - Bloody Garden (Shanghai) - Handout #1.png': new Uint8Array([0, 5, 22, 7]),
      'Pack/readme.txt': new TextEncoder().encode('not a picture'),
      'Pack/fake.png': new TextEncoder().encode('<html>'),
    });
    const up = (token) => { const fd = new FormData(); fd.append('file', new Blob([zip], { type: 'application/zip' }), 'pack.zip'); return fetch(`${URL}/api/upload/zip`, { method: 'POST', body: fd, headers: { 'x-upload-token': token } }); };
    assert.equal((await up(pj.uploadToken)).status, 403, 'players cannot');
    const res = await up(gj.uploadToken);
    assert.equal(res.status, 200);
    const { pictures } = await res.json();
    assert.deepEqual(pictures.map((p) => [p.name, p.group]), [['Bloody Garden - Handout #1', 'Shanghai'], ['Last Stand - Handout #2', 'New York']]);
    assert.equal((await fetch(`${URL}${pictures[0].url}`)).status, 200, 'saved like any upload');

    const list = next(gm, 'handouts');
    let playerGotList = false;
    pl.on('handouts', () => { playerGotList = true; });
    assert.match((await emit(pl, 'handouts:add', { items: pictures.map((p) => ({ ...p, image: p.url })) })).error, /GM/);
    assert.equal((await emit(gm, 'handouts:add', { items: pictures.map((p) => ({ ...p, image: p.url, width: 10, height: 10 })) })).added, 2);
    const hs = await list;
    assert.equal(hs.length, 2);
    // show one: everyone gets it in chat, and the list remembers it's been shown
    const chat = next(pl, 'chat'), after = next(gm, 'handouts');
    await emit(gm, 'handout:show', { id: hs[0].id, image: hs[0].image, caption: hs[0].name });
    const m = await chat;
    assert.equal(m.kind, 'handout'); assert.equal(m.caption, 'Bloody Garden - Handout #1');
    assert.ok((await after).find((h) => h.id === hs[0].id).shown);
    const renamed = next(gm, 'handouts');
    await emit(gm, 'handouts:update', { id: hs[1].id, name: 'Cutting', group: 'Harlem' });
    assert.deepEqual((await renamed).find((h) => h.id === hs[1].id) && ['Cutting', 'Harlem'], ['Cutting', 'Harlem']);
    const gone = next(gm, 'handouts');
    await emit(gm, 'handouts:delete', { id: hs[1].id });
    assert.equal((await gone).length, 1);
    assert.ok(!playerGotList, 'players never get the list');
  } finally { gm.close(); pl.close(); }
});

test('secret doors: players see wall until the GM opens it once', async () => {
  const { generateMap1920 } = await import('../shared/mapgen1920.js');
  const gm = client(), pl = client();
  try {
    await emit(gm, 'join', { room: 'old-house', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'old-house', name: 'Ben' });
    await emit(gm, 'settings:update', { ruleset: 'coc7' });
    const L = generateMap1920({ kind: 'manor', size: 'small', seed: 3 });
    const P = 70, px = (q) => [Math.round(q[0] * P), Math.round(q[1] * P)];
    const made = await emit(gm, 'scene:build', {
      name: 'The house', map: { width: L.cols * P, height: L.rows * P, gridSize: P },
      walls: L.walls.map((w) => ({ a: px(w.a), b: px(w.b), kind: w.kind, locked: w.locked, name: w.name, secret: w.secret })),
      devices: [], fog: 'sight',
    });
    const both = () => Promise.all([next(gm, 'scene'), next(pl, 'scene')]);
    let seen = both();
    await emit(gm, 'scene:activate', { id: made.id });
    let [gs, ps] = await seen;
    const hidden = gs.walls.find((w) => w.secret);
    assert.ok(hidden && hidden.kind === 'door' && !hidden.found, 'the GM sees the secret door');
    const theirs = ps.walls.find((w) => w.id === hidden.id);
    assert.deepEqual(Object.keys(theirs).sort(), ['a', 'b', 'id', 'kind'], 'players get a bare wall');
    assert.equal(theirs.kind, 'wall');
    assert.ok(!ps.walls.some((w) => w.secret || w.name === hidden.name && w.kind === 'wall' && w.name), 'no hint of it');
    assert.equal((await emit(pl, 'door:toggle', { id: hidden.id })).error, 'No such door', "players can't open what they haven't found");

    // the GM opens it: found for good, an ordinary door from now on
    seen = both();
    await emit(gm, 'door:toggle', { id: hidden.id });
    [gs, ps] = await seen;
    assert.ok(gs.walls.find((w) => w.id === hidden.id).found);
    const found = ps.walls.find((w) => w.id === hidden.id);
    assert.equal(found.kind, 'door'); assert.ok(found.open);
    seen = both();
    assert.ok((await emit(pl, 'door:toggle', { id: hidden.id })).ok, 'and players can shut it again');
    [, ps] = await seen;
    assert.equal(ps.walls.find((w) => w.id === hidden.id).kind, 'door', 'still a door once closed');

    // the GM can make any door secret (and it is hidden again)
    const plain = gs.walls.find((w) => w.kind === 'door' && !w.secret && w.name !== 'Front door');
    seen = both();
    await emit(gm, 'wall:update', { id: plain.id, secret: true });
    [, ps] = await seen;
    assert.equal(ps.walls.find((w) => w.id === plain.id).kind, 'wall');
  } finally { gm.close(); pl.close(); }
});

test('generated maps: walls, devices, and the security console working them', async () => {
  const { generateMap } = await import('../shared/mapgen.js');
  const gm = client(), pl = client();
  try {
    const g = await emit(gm, 'join', { room: 'heist', name: 'Flick', gmPassword: 'secret' });
    const p = await emit(pl, 'join', { room: 'heist', name: 'Ben' });
    await emit(gm, 'settings:update', { ruleset: 'cpr' });
    const L = generateMap({ kind: 'server', size: 'small', seed: 5 });
    const P = 70, px = (q) => [Math.round(q[0] * P), Math.round(q[1] * P)];
    const build = {
      name: 'Colo hall', title: L.title, map: { width: L.cols * P, height: L.rows * P, gridSize: P },
      walls: L.walls.map((w) => ({ a: px(w.a), b: px(w.b), kind: w.kind, locked: w.locked, name: w.name })),
      devices: L.devices.map((d) => ({ ...d, x: Math.round(d.x * P), y: Math.round(d.y * P) })),
      rooms: L.rooms, fog: 'sight', security: true,
    };
    assert.equal((await emit(pl, 'scene:build', build)).error, 'GM only');
    const made = await emit(gm, 'scene:build', build);
    assert.ok(made.ok && made.devices === L.devices.length);
    const sceneP = next(gm, 'scene');
    await emit(gm, 'scene:activate', { id: made.id });
    const sc = await sceneP;
    assert.equal(sc.walls.length, L.walls.filter((w) => w.a.join() !== w.b.join()).length);
    assert.equal(sc.fog.mode, 'sight');
    const lock = sc.devices.find((d) => d.type === 'lock');
    const cam = sc.devices.find((d) => d.type === 'camera');
    const turret = sc.devices.find((d) => d.type === 'turret');
    const door = sc.walls.find((w) => w.id === lock.wall);
    assert.ok(door.locked, 'the door starts locked');
    assert.ok(sc.tokens.some((t) => t.id === turret.token), 'the turret is a token');

    // the security console in the Thaw props now describes this building, linked to the map
    await emit(gm, 'prop:show', { coll: 'thaw', file: 'security.html', to: 'all' });
    const api = (key) => `${URL}/p/${key}/thaw/__lantern`;
    const sec = JSON.parse((await (await fetch(`${api(p.propKey)}/state`)).json()).state['security.v1']);
    assert.equal(sec.scene, made.id);
    assert.equal(sec.devices.length, L.devices.length);
    assert.ok(sec.devices.every((d) => d.ref && d.node));

    // players don't know about the cameras until they've hacked one
    const plScene = async () => { const s = next(pl, 'scene'); await emit(gm, 'token:add', { x: 0, y: 0, label: 'nudge' }); return s; };
    assert.deepEqual((await plScene()).devices, []);

    const work = (ref, state) => fetch(`${api(p.propKey)}/device`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref, state }) });
    assert.equal((await work(lock.id, 'unlocked')).status, 200);
    assert.equal((await work(cam.id, 'looped')).status, 200);
    assert.equal((await work(turret.id, 'slaved')).status, 200);
    assert.equal((await work(cam.id, 'exploded')).status, 400);
    assert.equal((await work('nope', 'looped')).status, 404);
    const alarmP = next(pl, 'alarm');
    const alarm = sc.devices.find((d) => d.type === 'alarm');
    assert.equal((await work(alarm.id, 'triggered')).status, 200);
    assert.equal((await alarmP).name, alarm.name);

    const after = await plScene();
    assert.equal(after.walls.find((w) => w.id === lock.wall).locked, false, 'the door unlocked');
    assert.deepEqual(after.devices.map((d) => d.id), [cam.id], 'the hacked camera is theirs to see through');
    const tt = after.tokens.find((t) => t.id === turret.token);
    assert.deepEqual(tt.owners, ['*']); assert.match(tt.label, /yours/);
    // the hacked camera shows the party what it sees (explored fog)
    assert.notEqual(after.fog.explored, sc.fog.explored);
    // the door can now be opened by a player; locking it again shuts it
    assert.ok((await emit(pl, 'door:toggle', { id: lock.wall })).ok);
    await work(lock.id, 'locked');
    const relocked = await plScene();
    const d2 = relocked.walls.find((w) => w.id === lock.wall);
    assert.ok(d2.locked && !d2.open);
  } finally { gm.close(); pl.close(); }
});

test('opening a .lantern module: GM only, into a blank game, both the new format and an old zip', async () => {
  const { writeLantern } = await import('../modulefile.js');
  const { zipSync } = await import('fflate');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-mod-'));
  const gm = client(), pl = client();
  try {
    const gj = await emit(gm, 'join', { room: 'gallows', name: 'Flick', gmPassword: 'secret' });
    const pj = await emit(pl, 'join', { room: 'gallows', name: 'Portia' });
    const pic = 'a1b2c3d4e5f60718293a4b5c.png';
    const pdfId = 'abcdef0123456789';
    const head = {
      format: 1,
      meta: { title: 'The Haunting of Gallows Hill', ruleset: 'coc7', visibility: 'private', pdfs: [{ id: pdfId, title: 'Players’ guide', share: 'all' }] },
      snapshot: {
        scenes: [{ id: 's1', name: 'The Hill', map: { image: `/uploads/${pic}`, width: 1400, height: 1000, gridSize: 70 },
          tokens: [{ id: 't1', x: 70, y: 70, label: 'Ghost', sheetId: 'sh1', hidden: true }],
          walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 140, y: 0 }, kind: 'door', locked: true }],
          devices: [{ id: 'd1', kind: 'lock', wall: 'w1' }] }],
        activeScene: 's1',
        sheets: [{ id: 'sh1', owner: '', system: 'coc7', data: { name: 'The Ghost' } }],
        notes: [{ id: 'n1', title: 'Arrival', body: 'Read [[pdf:Players’ guide#1]].', folder: 'Chapter 1', share: 'all' }],
        handouts: [{ id: 'h1', name: 'The Letter', group: 'Chapter 1', image: `/uploads/${pic}`, width: 10, height: 10, shown: true }],
        page: { title: 'Gallows Hill', description: 'A small town with a big secret.' },
      },
      docs: [{ id: pdfId, title: 'Players’ guide', pages: 1 }],
    };
    fs.writeFileSync(path.join(tmp, pic), Buffer.from('89504e470d0a1a0a', 'hex'));
    fs.writeFileSync(path.join(tmp, 'g.pdf'), '%PDF-1.4\n%%EOF\n');
    const file = path.join(tmp, 'Gallows Hill.lantern');
    await writeLantern(file, head, [{ name: `uploads/${pic}`, file: path.join(tmp, pic) }, { name: `pdfs/${pdfId}.pdf`, file: path.join(tmp, 'g.pdf') }]);
    const post = (token, f = file) => {
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
      return fetch(`${URL}/api/import-module`, { method: 'POST', body: fd, headers: token ? { 'x-upload-token': token } : {} });
    };
    assert.equal((await post(null)).status, 401, 'strangers cannot');
    assert.equal((await post(pj.uploadToken)).status, 403, 'players cannot');
    fs.writeFileSync(path.join(tmp, 'junk.lantern'), 'not a module');
    const bad = await post(gj.uploadToken, path.join(tmp, 'junk.lantern'));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /isn't a Lantern module/);

    const scenesP = next(gm, 'scenes');
    const res = await post(gj.uploadToken);
    assert.equal(res.status, 200);
    const { report } = await res.json();
    assert.deepEqual([report.title, report.scenes, report.notes, report.handouts, report.sheets, report.pdfs], ['The Haunting of Gallows Hill', 1, 1, 1, 1, 1]);
    const scenes = await scenesP;
    assert.deepEqual(scenes.list.map((s) => s.name), ['The Hill'], 'the blank Scene 1 made way for the module');
    assert.ok(fs.existsSync(path.join(dataDir, 'uploads', pic)), 'its pictures are unpacked');

    // everything is in the game, and nothing is shown to players
    const saved = await (async () => { await new Promise((r) => setTimeout(r, 1200)); return JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms', 'gallows.json'), 'utf8')); })();
    const sc = saved.scenes[0];
    assert.equal(saved.activeScene, sc.id);
    assert.equal(sc.map.image, `/uploads/${pic}`);
    assert.equal(sc.tokens[0].sheetId, saved.sheets[0].id, 'tokens follow their sheets to the new ids');
    assert.equal(sc.tokens[0].hidden, true);
    assert.equal(sc.devices[0].wall, sc.walls[0].id, 'devices still point at their walls');
    assert.deepEqual([saved.sheets[0].owner, saved.sheets[0].data.name], ['Flick', 'The Ghost']);
    assert.deepEqual([saved.notes[0].title, saved.notes[0].folder, saved.notes[0].share], ['Arrival', 'Chapter 1', 'none']);
    assert.deepEqual([saved.handouts[0].name, saved.handouts[0].shown], ['The Letter', false]);
    assert.equal(saved.settings.ruleset, 'coc7');
    assert.equal(saved.page.title, 'Gallows Hill');
    const lib = JSON.parse(fs.readFileSync(path.join(dataDir, 'library', 'library.json'), 'utf8'));
    const doc = (lib.docs || lib).find((d) => d.id === pdfId);
    assert.equal(doc?.title, 'Players’ guide', 'the PDF is in the library, keeping its id');
    assert.equal(doc.share.gallows, 'all', 'shared with the players as the module had it');

    // an older zip-style .lantern, a folder down (as a Mac re-zips it), adds to a game that's already going
    const entries = { 'Gallows Hill/lantern-module.json': new TextEncoder().encode(JSON.stringify({ ...head, meta: { ...head.meta, title: 'Act Two' } })), '__MACOSX/Gallows Hill/._x': new Uint8Array([0]) };
    entries[`Gallows Hill/uploads/${pic}`] = fs.readFileSync(path.join(tmp, pic));
    const zipFile = path.join(tmp, 'Act Two.zip');
    fs.writeFileSync(zipFile, zipSync(entries));
    const r2 = await post(gj.uploadToken, zipFile);
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).report.title, 'Act Two');
    await new Promise((r) => setTimeout(r, 1200));
    const again = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms', 'gallows.json'), 'utf8'));
    assert.equal(again.scenes.length, 2, 'added alongside, not replacing');
    assert.equal(again.page.title, 'Gallows Hill', "a game that's going keeps its own page");
  } finally { gm.close(); pl.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('custom dice: saved per person with the campaign, cleaned, and sent back on joining', async () => {
  const a = client();
  try {
    await emit(a, 'join', { room: 'dicestyles', name: 'Rick' });
    const bad = await emit(a, 'dice:style', { style: { body: 'blood' } });
    assert.match(bad.error, /pick a colour/);
    const r = await emit(a, 'dice:style', { style: { body: '#7A1020', finish: 'pearl', pattern: 'marble', picture: 'http://x/y.png' } });
    assert.deepEqual([r.style.body, r.style.finish, r.style.picture], ['#7a1020', 'pearl', null]);
    // the free app: every material is there
    assert.equal((await emit(a, 'dice:style', { style: { body: '#0b0b2a', finish: 'eldritch' } })).style.finish, 'eldritch');
    assert.equal((await emit(a, 'dice:style', { style: { body: '#7A1020', finish: 'pearl', pattern: 'marble' } })).style.finish, 'pearl');
  } finally { a.close(); }
  const b = client();
  try {
    const back = next(b, 'dice:style'), unlocks = next(b, 'dice:unlocks');
    await emit(b, 'join', { room: 'dicestyles', name: 'Rick' });
    assert.equal(await unlocks, null, 'nothing locked without an add-on');
    assert.equal((await back).body, '#7a1020', 'your dice come back when you rejoin');
    await new Promise((res) => setTimeout(res, 1200));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms', 'dicestyles.json'), 'utf8'));
    assert.equal(saved.diceStyles.Rick.pattern, 'marble');
  } finally { b.close(); }
});

test('dice designer sets and token designer tokens: no add-on, so the browser keeps them; tokens for characters', async () => {
  const gm = client();
  try {
    await emit(gm, 'join', { room: 'tokendesign', name: 'Keeper', gmPassword: 'secret' });
    assert.equal((await emit(gm, 'dice:sets', {})).sets, null);
    assert.equal((await emit(gm, 'tokens:get', {})).tokens, null);
    assert.equal((await emit(gm, 'tokens:save', { tokens: [] })).tokens, null);
    const set = await emit(gm, 'dice:style', { style: { body: '#101010', finish: 'obsidian', overlay: 'galaxy', rim: 'royal', dice: { d20: { body: '#aa0000', finish: 'garnet' } } } });
    assert.equal(set.style.dice.d20.finish, 'garnet');
    const pic = '/uploads/0123456789abcdef0123.png';
    const { id: sheetId } = await emit(gm, 'sheet:create', { system: 'generic', data: { name: 'Hale' } });
    const t = await emit(gm, 'token:from-sheet', { sheetId, x: 0, y: 0 });
    assert.ok(t.ok, t.error);
    const scene = next(gm, 'scene');
    assert.ok((await emit(gm, 'sheet:token', { sheetId, image: pic })).ok);
    const tok = (await scene).tokens.find((x) => x.sheetId === sheetId);
    assert.deepEqual([tok.image, tok.framed], [pic, true], 'the token on the map changes');
    assert.match((await emit(gm, 'sheet:token', { sheetId, image: 'https://elsewhere/x.png' })).error, /isn't on this server/);
    const add = await emit(gm, 'token:add', { label: 'Cultist', image: pic, framed: true });
    assert.ok(add.ok);
    // character cards: shown in chat, kept with the character
    assert.ok((await emit(gm, 'card:show', { sheetId, image: pic })).ok);
    assert.ok((await emit(gm, 'sheet:card', { sheetId, image: pic, design: { theme: 'gothic', layout: 'framed' } })).ok);
    assert.match((await emit(gm, 'card:show', { sheetId, image: 'https://x/y.png' })).error, /isn't on this server/);
  } finally { gm.close(); }
});

test('game plugins: the GM installs one, turns it on, plays its game; its rolls keep their outcome table', async () => {
  const gm = client(), pl = client();
  try {
    const gj = await emit(gm, 'join', { room: 'plugged', name: 'Flick', gmPassword: 'secret' });
    const pj = await emit(pl, 'join', { room: 'plugged', name: 'Portia' });
    const zip = await (await fetch(`${URL}/api/plugins/example.zip`)).arrayBuffer();
    const send = (token) => { const fd = new FormData(); fd.append('file', new Blob([zip], { type: 'application/zip' }), 'hearth.zip'); return fetch(`${URL}/api/plugins`, { method: 'POST', body: fd, headers: { 'x-upload-token': token } }); };
    assert.equal((await send(pj.uploadToken)).status, 403, 'players can’t add plugins');
    const seen = next(pl, 'plugins');
    const res = await (await send(gj.uploadToken)).json();
    assert.equal(res.name, 'Hearth & Hazard');
    const list = await seen;
    assert.equal(list[0].key, res.key, 'it’s on in the campaign it was added from, for everyone');
    const rs = list[0].ruleset;
    assert.match(rs, /^p:[a-f0-9]{12}$/);
    // its panels are a prop collection in this campaign
    const props = next(gm, 'props');
    await emit(gm, 'plugins:enable', { key: res.key, on: true });
    assert.ok((await props).some((c) => c.id === `plugin-${res.key}` && c.pages[0].file === 'clocks.html'));
    // play its game; combat initiative uses its dice
    assert.ok((await emit(gm, 'settings:update', { ruleset: rs })).ok);
    assert.match((await emit(gm, 'plugins:enable', { key: res.key, on: false })).error, /pick another ruleset first/);
    assert.equal((await emit(pl, 'plugins:enable', { key: res.key, on: false })).error, 'GM only');
    // a roll with its outcome table keeps it (cleaned)
    const chat = next(pl, 'chat');
    await emit(gm, 'roll:digital', { expr: '3d6kh1', label: 'Might', meta: { outcome: { bands: [{ min: 6, text: 'It works', tone: 'good' }, { max: 5, text: 'x'.repeat(99), tone: 'odd' }], crit: { face: 6, count: 2, text: 'Triumph' } } } });
    const m = await chat;
    assert.equal(m.meta.outcome.bands[1].text.length, 40);
    assert.equal(m.meta.outcome.bands[1].tone, 'neutral');
    assert.equal(m.meta.outcome.crit.text, 'Triumph');
    // a campaign without it can't pick its game
    const other = client();
    try {
      await emit(other, 'join', { room: 'unplugged', name: 'Ben', gmPassword: 'secret' });
      assert.match((await emit(other, 'settings:update', { ruleset: rs })).error, /Turn that plugin on/);
      const listed = (await emit(other, 'plugins:list', {})).plugins.find((p) => p.key === res.key);
      assert.deepEqual([listed.on, listed.has.system, listed.has.panels], [false, true, 1]);
      assert.match((await emit(other, 'plugins:remove', { key: res.key })).error, /Other campaigns on this server use it/);
    } finally { other.close(); }
    assert.equal((await fetch(`${URL}/api/plugins/${res.key}.zip?t=${pj.uploadToken}`)).status, 403);
    assert.equal((await fetch(`${URL}/api/plugins/${res.key}.zip?t=${gj.uploadToken}`)).headers.get('content-type'), 'application/zip');
  } finally { gm.close(); pl.close(); }
});
