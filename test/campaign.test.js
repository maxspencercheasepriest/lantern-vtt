// Combat tracker and notes: rules in campaign.js, permissions through the real server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { freshCombat, newEntry, rollInitiative, nextTurn, combatFor, sortEntries } from '../campaign.js';

test('Year Zero cards are unique and lowest goes first', () => {
  const c = freshCombat();
  for (let i = 0; i < 6; i++) c.entries.push(newEntry({ name: `K${i}` }));
  rollInitiative(c, 'tftl', () => 1, { all: true });
  const inits = c.entries.map((e) => e.init);
  assert.equal(new Set(inits).size, 6);
  assert.deepEqual(inits, [...inits].sort((a, b) => a - b));
});

test('Savage Worlds deals cards, highest first, and redeals each round', () => {
  const c = freshCombat();
  for (let i = 0; i < 4; i++) c.entries.push(newEntry({ name: `H${i}` }));
  rollInitiative(c, 'swade', () => 1, { all: true });
  assert.ok(c.entries.every((e) => e.initLabel));
  const inits = c.entries.map((e) => e.init);
  assert.deepEqual(inits, [...inits].sort((a, b) => b - a));
  c.active = true; c.round = 1; c.turn = 0;
  const before = c.entries.map((e) => e.initLabel).join();
  for (let i = 0; i < 4; i++) nextTurn(c, 'swade', () => 1);
  assert.equal(c.round, 2);
  assert.notEqual(c.entries.map((e) => e.initLabel).join(), before + 'x'); // dealt again (labels present)
  assert.ok(c.entries.every((e) => e.initLabel));
});

test('rolled initiative adds the modifier; conditions expire', () => {
  const c = freshCombat();
  c.entries.push(newEntry({ name: 'Orc', initMod: 1 }), newEntry({ name: 'Elf', initMod: 3, conditions: [{ name: 'Prone', rounds: 1 }, { name: 'Blessed', rounds: null }] }));
  rollInitiative(c, 'dnd5e', () => 10, { all: true });
  assert.deepEqual(c.entries.map((e) => [e.name, e.init]), [['Elf', 13], ['Orc', 11]]);
  c.active = true; c.round = 1; c.turn = 0;
  nextTurn(c, 'dnd5e', () => 10);
  const lines = nextTurn(c, 'dnd5e', () => 10);
  assert.equal(c.round, 2);
  assert.ok(lines.some((l) => /Prone ended/.test(l)));
  assert.deepEqual(c.entries.find((e) => e.name === 'Elf').conditions.map((x) => x.name), ['Blessed']);
});

test('players never see hidden entries or NPC hit points', () => {
  const c = freshCombat();
  c.entries.push(newEntry({ name: 'Spy', hidden: true, init: 20 }), newEntry({ name: 'Ogre', hp: { cur: 10, max: 59 }, init: 5 }), newEntry({ name: 'Mira', side: 'pc', hp: { cur: 7, max: 10 }, init: 12 }));
  sortEntries(c, 'dnd5e');
  c.active = true; c.turn = 0; // the hidden spy's turn
  const v = combatFor(c, { isGM: false, name: 'Portia' });
  assert.deepEqual(v.entries.map((e) => e.name), ['Mira', 'Ogre']);
  assert.equal(v.entries[1].hp, null);
  assert.equal(v.entries[1].status, 'Critical');
  assert.equal(v.turn, -1);
  assert.equal(combatFor(c, { isGM: true }).entries.length, 3);
});

// ---- through the server ----
const PORT = 3997;
const URL = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-camp-'));
let proc;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, GM_PASSWORD: 'secret', DATA_DIR: dataDir }, stdio: 'pipe' });
  await new Promise((resolve, reject) => { proc.stdout.on('data', (d) => d.toString().includes('running') && resolve()); proc.on('exit', reject); });
});
after(() => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });
const client = () => io(URL, { transports: ['websocket'], forceNew: true });
const emit = (s, evt, p) => new Promise((r) => s.emit(evt, p, r));
const latest = (s, evt) => { const box = { v: null }; s.on(evt, (x) => { box.v = x; }); return box; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('ruleset, combat and notes permissions', async () => {
  const gm = client(), pl = client(), other = client();
  const plNotes = latest(pl, 'notes'), otherNotes = latest(other, 'notes'), gmNotes = latest(gm, 'notes');
  const plCombat = latest(pl, 'combat'), settings = latest(pl, 'settings');
  try {
    await emit(gm, 'join', { room: 'c1', name: 'Flick', gmPassword: 'secret' });
    await emit(pl, 'join', { room: 'c1', name: 'Portia' });
    await emit(other, 'join', { room: 'c1', name: 'Ben' });

    assert.equal((await emit(pl, 'settings:update', { ruleset: 'dnd5e' })).error, 'GM only');
    assert.ok((await emit(gm, 'settings:update', { ruleset: 'tftl' })).ok);
    await wait(100);
    assert.equal(settings.v.ruleset, 'tftl');

    // combat: GM adds, player can't edit or advance unless it's their turn
    const tok = await emit(gm, 'token:add', { x: 0, y: 0, label: 'Portia', owners: ['Portia'] });
    const add = await emit(gm, 'combat:add', { entries: [{ name: 'Portia', tokenId: tok.id, side: 'pc' }, { name: 'Loop robot', hp: { cur: 5, max: 5 } }] });
    assert.equal(add.ids.length, 2);
    assert.equal((await emit(pl, 'combat:update', { id: add.ids[1], patch: { name: 'x' } })).error, 'GM only');
    assert.ok((await emit(pl, 'combat:set-init', { id: add.ids[0], value: 3 })).ok);
    assert.equal((await emit(pl, 'combat:set-init', { id: add.ids[1], value: 3 })).error, "That isn't your combatant");
    assert.ok((await emit(gm, 'combat:start', {})).ok);
    await wait(100);
    assert.equal(plCombat.v.round, 1);
    assert.equal(plCombat.v.entries.find((e) => e.name === 'Loop robot').hp, null);
    const r = await emit(gm, 'combat:damage', { id: add.ids[1], amount: 2 });
    assert.equal(r.hp.cur, 3);

    // notes: private to the GM until shared
    const n = await emit(gm, 'notes:create', { title: 'Secret', body: 'The robot is friendly' });
    await wait(100);
    assert.equal(plNotes.v.length, 0);
    assert.equal((await emit(pl, 'notes:update', { id: n.id, body: 'hacked' })).error, 'No such note');
    await emit(gm, 'notes:update', { id: n.id, share: ['Portia'] });
    await wait(100);
    assert.equal(plNotes.v.length, 1);
    assert.equal(otherNotes.v.length, 0);
    assert.equal((await emit(pl, 'notes:update', { id: n.id, body: 'hacked' })).error, "You can't edit that note");
    // players' own notes are theirs alone
    const mine = await emit(pl, 'notes:create', { title: 'My clues' });
    await wait(100);
    assert.equal(gmNotes.v.some((x) => x.id === mine.id), false);
    assert.equal(plNotes.v.some((x) => x.id === mine.id), true);
    await emit(gm, 'notes:reveal', { id: n.id });
    await wait(100);
    assert.equal(otherNotes.v.length, 1);
  } finally { gm.close(); pl.close(); other.close(); }
});

test('video call signalling only flows between people in the call', async () => {
  const a = client(), b = client(), c = client();
  try {
    await emit(a, 'join', { room: 'v1', name: 'A' });
    await emit(b, 'join', { room: 'v1', name: 'B' });
    await emit(c, 'join', { room: 'v2', name: 'C' }); // another campaign
    const ja = await emit(a, 'av:join', { video: true });
    assert.deepEqual(ja.peers, []);
    assert.ok(ja.iceServers.length >= 1);
    const joined = new Promise((r) => a.once('av:peer-joined', r));
    const jb = await emit(b, 'av:join', { video: false });
    assert.equal(jb.peers[0].name, 'A');
    assert.equal((await joined).name, 'B');
    // B -> A arrives
    const got = new Promise((r) => a.once('av:signal', r));
    b.emit('av:signal', { to: ja.id, data: { description: { type: 'offer', sdp: 'x' } } });
    assert.equal((await got).from, jb.id);
    // C is in another room and not in the call: nothing reaches A
    let leaked = false;
    a.on('av:signal', (m) => { if (m.from === c.id) leaked = true; });
    c.emit('av:signal', { to: ja.id, data: { candidate: {} } });
    await wait(150);
    assert.equal(leaked, false);
    // leaving tells the others
    const left = new Promise((r) => a.once('av:peer-left', r));
    await emit(b, 'av:leave', {});
    assert.equal((await left).id, jb.id);
  } finally { a.close(); b.close(); c.close(); }
});
