// Lantern Server's community side: modules (marketplace, library, reviews, export/import), the character
// vault and looking for group. First the stores on their own, then the real server with logins on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { moduleSnapshot, gameFromModule, assetsOf, Modules, Vault, Lfg } from '../community.js';

const played = {
  id: 'masks',
  activeScene: 'sc1',
  scenes: [{
    id: 'sc1', name: 'Jackson Elias’s room', map: { image: '/uploads/aaaaaaaaaaaaaaaaaaaaaaaa.png' },
    tokens: [{ id: 't1', sheetId: 'npc', label: 'Cultist', owners: ['Ada'] }, { id: 't2', sheetId: 'pc', label: 'Ada’s investigator' }, { id: 't3', label: 'Lamp', fallen: 1.2 }],
    walls: [{ id: 'w1', kind: 'door', secret: true, found: true, open: true }, { id: 'w2', kind: 'wall' }],
    fog: { mode: 'sight', ops: [{ reveal: 1 }], explored: { bits: 'abc' } },
    devices: [{ id: 'd1', kind: 'alarm', triggered: true }],
    drawings: [{ id: 'g1', author: 'Flick', gmOnly: false }, { id: 'g2', author: 'Ada' }],
  }],
  sheets: [{ id: 'npc', owner: 'Flick', system: 'coc7', data: { name: 'Cultist' } }, { id: 'pc', owner: 'Ada', system: 'coc7', data: { name: 'Mabel' } }, { id: 'npc2', owner: '', system: 'coc7', data: { name: 'Mr Mukunga' } }],
  chat: [{ text: 'hello' }],
  settings: { ruleset: 'coc7' },
  notes: [{ id: 'n1', owner: '', share: 'all', text: 'Keeper only' }, { id: 'n2', owner: 'Ada', text: 'my notes' }],
  audio: { tracks: [{ id: 'tr', url: '/uploads/bbbbbbbbbbbbbbbbbbbbbbbb.mp3' }], music: { trackId: 'tr', playing: true, offset: 40 }, ambience: [{ trackId: 'tr' }] },
  handouts: [{ id: 'h1', image: '/uploads/cccccccccccccccccccccccc.jpg', shown: true }],
  page: { title: 'Masks', description: 'Around the world', log: [{ id: 'l1', title: 'Session 1' }], nextSession: '2026-12-01T19:00:00Z' },
  played: { Flick: { gm: true, days: ['2026-11-20'] }, Ada: { days: ['2026-11-20'] } },
  propState: { x: 1 },
};

test('a module keeps what the GM set up and none of what the group did', () => {
  const snap = moduleSnapshot(played, { gms: ['Flick'] });
  assert.deepEqual(snap.sheets.map((s) => [s.id, s.owner]), [['npc', ''], ['npc2', '']], 'NPCs only, with no owner');
  const sc = snap.scenes[0];
  assert.deepEqual(sc.tokens.map((t) => t.id), ['t1', 't3'], 'the player character’s token stays behind');
  assert.deepEqual(sc.tokens[0].owners, []);
  assert.equal(sc.tokens[1].fallen, undefined, 'knocked-over tokens stand up again');
  assert.deepEqual([sc.walls[0].found, sc.walls[0].open], [false, false], 'the secret door is secret again');
  assert.deepEqual([sc.fog.ops, sc.fog.explored, sc.fog.mode], [[], null, 'sight']);
  assert.equal(sc.devices[0].triggered, undefined);
  assert.deepEqual(sc.drawings.map((d) => d.id), ['g1'], 'players’ scribbles go');
  assert.deepEqual(snap.notes.map((n) => [n.id, n.share]), [['n1', 'none']], 'GM notes, unrevealed');
  assert.equal(snap.audio.music.playing, false);
  assert.deepEqual(snap.audio.ambience, []);
  assert.equal(snap.handouts[0].shown, false);
  assert.deepEqual(snap.page, { title: 'Masks', description: 'Around the world', banner: '' });
  for (const k of ['chat', 'played', 'propState']) assert.equal(snap[k], undefined, `no ${k}`);
  assert.deepEqual(assetsOf(snap).sort(), ['aaaaaaaaaaaaaaaaaaaaaaaa.png', 'bbbbbbbbbbbbbbbbbbbbbbbb.mp3', 'cccccccccccccccccccccccc.jpg']);

  const lean = moduleSnapshot(played, { gms: ['Flick'], include: { scenes: false, audio: false, sheets: false } });
  assert.deepEqual([lean.scenes.length, lean.sheets.length, lean.audio, lean.notes.length], [0, 0, undefined, 1]);

  const game = gameFromModule(snap, { id: 'masks-friday', title: 'Masks (Friday)', gm: 'Kirsty' });
  assert.equal(game.id, 'masks-friday');
  assert.deepEqual(game.sheets.map((s) => s.owner), ['Kirsty', 'Kirsty'], 'the new GM runs the NPCs');
  assert.deepEqual([game.page.title, game.page.log, game.page.nextSession, game.chat, game.played], ['Masks (Friday)', [], null, [], {}]);
});

test('modules: publish, versions, library, update notes, reviews, withdraw and take down', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-mod-'));
  try {
    const mods = new Modules(path.join(dir, 'modules'), { uploadsDir: path.join(dir, 'uploads') });
    const snap = moduleSnapshot(played, { gms: ['Flick'] });
    assert.throws(() => mods.publish({ room: 'masks', author: 'Flick', title: 'Masks', visibility: 'public', snapshot: snap }), /yours to share/);
    const m = mods.publish({ room: 'masks', author: 'Flick', title: 'Masks', visibility: 'private', snapshot: snap });
    assert.deepEqual([m.version, m.contents.scenes, m.contents.npcs, m.contents.tracks], [1, 1, 2, 1]);
    assert.ok(mods.inLibrary('Flick', m.id), 'the author has it');
    mods.addToLibrary('Kirsty', m.id);
    assert.equal(mods.libraryOf('Kirsty')[0].update, false);
    const m2 = mods.publish({ room: 'masks', author: 'Flick', title: 'Masks of N.', visibility: 'private', snapshot: snap });
    assert.equal(m2.id, m.id, 'publishing again is a new version of the same module');
    assert.equal(m2.version, 2);
    assert.equal(mods.libraryOf('Kirsty')[0].update, true, 'Kirsty is told there’s an update');
    mods.seen('Kirsty', m.id);
    assert.equal(mods.libraryOf('Kirsty')[0].update, false);
    assert.equal(fs.readdirSync(path.join(dir, 'modules', m.id)).join(), 'v2.json', 'only the latest version is kept');

    assert.throws(() => mods.review(m.id, 'Flick', 5), /your own/);
    assert.throws(() => mods.review(m.id, 'Kirsty', 9), /between 1 and 5/);
    mods.review(m.id, 'Kirsty', 4, 'Brilliant handouts');
    mods.review(m.id, 'Ada', 5);
    mods.review(m.id, 'Kirsty', 3, 'Changed my mind');
    const d = mods.detail(m.id, 'Kirsty');
    assert.deepEqual([d.stars, d.reviews.length, d.reviews.find((r) => r.by === 'Kirsty').text], [4, 2, 'Changed my mind']);

    mods.withdraw(m.id);
    assert.equal(mods.market().length, 0, 'withdrawn: not in the marketplace');
    assert.equal(mods.libraryOf('Kirsty').length, 1, '…but still in Kirsty’s library');
    assert.throws(() => mods.addToLibrary('Bob', m.id), /isn't offered/);

    const fresh = new Modules(path.join(dir, 'modules'), { uploadsDir: path.join(dir, 'uploads') });
    assert.equal(fresh.get(m.id).version, 2, 'saved to disk');
    fresh.remove(m.id);
    assert.deepEqual([fresh.libraryOf('Kirsty').length, fs.existsSync(path.join(dir, 'modules', m.id))], [0, false], 'taken down: gone from libraries');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('export and import: a .lantern file carries the module, its pictures and music', async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-exp-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-exp-b-'));
  try {
    for (const d of [a, b]) fs.mkdirSync(path.join(d, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(a, 'uploads', 'aaaaaaaaaaaaaaaaaaaaaaaa.png'), Buffer.alloc(3 * 1024 * 1024, 7)); // bigger than one read
    fs.writeFileSync(path.join(a, 'uploads', 'bbbbbbbbbbbbbbbbbbbbbbbb.mp3'), 'music');
    const ma = new Modules(path.join(a, 'modules'), { uploadsDir: path.join(a, 'uploads') });
    const snap = moduleSnapshot(played, { gms: ['Flick'] });
    const priv = ma.publish({ room: 'masks', author: 'Flick', title: 'Masks', visibility: 'private', snapshot: snap });
    await assert.rejects(ma.exportTo(priv.id, path.join(a, 'x.lantern')), /Only public/);
    const pub = ma.publish({ room: 'masks', author: 'Flick', title: 'The Haunting of Gallows Hill', visibility: 'public', shareOk: true, snapshot: snap });
    const file = path.join(a, 'gallows.lantern');
    await ma.exportTo(pub.id, file);

    const mb = new Modules(path.join(b, 'modules'), { uploadsDir: path.join(b, 'uploads') });
    const r = await mb.importFrom(file, { user: 'Dave' });
    assert.equal(r.uploads, 2, 'the missing picture (the handout) is skipped, the rest arrive');
    assert.equal(fs.statSync(path.join(b, 'uploads', 'aaaaaaaaaaaaaaaaaaaaaaaa.png')).size, 3 * 1024 * 1024);
    assert.equal(fs.readFileSync(path.join(b, 'uploads', 'bbbbbbbbbbbbbbbbbbbbbbbb.mp3'), 'utf8'), 'music');
    const m = r.module;
    assert.deepEqual([m.title, m.author, m.importedBy, m.visibility, m.origin.author, m.version], ['The Haunting of Gallows Hill', 'Flick', 'Dave', 'public', 'Flick', 1]);
    assert.ok(mb.inLibrary('Dave', m.id));
    assert.deepEqual(mb.snapshot(m.id).sheets.map((s) => s.data.name), ['Cultist', 'Mr Mukunga']);
    mb.review(m.id, 'Flick', 5); // on another server, the original author can review the imported copy… it's a different copy
    const junk = path.join(b, 'junk.lantern');
    fs.writeFileSync(junk, 'not a zip');
    await assert.rejects(mb.importFrom(junk, { user: 'Dave' }), /couldn't be unpacked|isn't a Lantern module/);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('export and import carry the module’s PDFs, keeping their ids', async () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-pdf-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-pdf-b-'));
  const fakeLibrary = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const docs = [];
    return { dir, docs, get: (id) => docs.find((d) => d.id === id), pdfPath: (d) => path.join(dir, `${d.id}.pdf`), adopt(list) { docs.push(...list); return list.length; } };
  };
  try {
    for (const d of [a, b]) fs.mkdirSync(path.join(d, 'uploads'), { recursive: true });
    const la = fakeLibrary(path.join(a, 'library'));
    la.docs.push({ id: 'abcdef0123456789', title: 'Gallows Hill (players’ guide)', pages: 4, size: 9 });
    fs.writeFileSync(path.join(a, 'library', 'abcdef0123456789.pdf'), '%PDF-1.4 x');
    const ma = new Modules(path.join(a, 'modules'), { uploadsDir: path.join(a, 'uploads'), library: la });
    const m = ma.publish({ room: 'g', author: 'Flick', title: 'Gallows Hill', visibility: 'public', shareOk: true, pdfs: [{ id: 'abcdef0123456789', title: 'Gallows Hill (players’ guide)', share: 'all' }], snapshot: moduleSnapshot(played, { gms: ['Flick'] }) });
    await ma.exportTo(m.id, path.join(a, 'g.lantern'));
    const lb = fakeLibrary(path.join(b, 'library'));
    const r = await new Modules(path.join(b, 'modules'), { uploadsDir: path.join(b, 'uploads'), library: lb }).importFrom(path.join(a, 'g.lantern'), { user: 'Dave' });
    assert.equal(r.pdfs, 1);
    assert.equal(fs.readFileSync(path.join(b, 'library', 'abcdef0123456789.pdf'), 'utf8'), '%PDF-1.4 x');
    assert.deepEqual(lb.docs.map((d) => [d.id, d.title]), [['abcdef0123456789', 'Gallows Hill (players’ guide)']]);
    assert.deepEqual(r.module.pdfs, [{ id: 'abcdef0123456789', title: 'Gallows Hill (players’ guide)', share: 'all' }]);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('character vault and looking-for-group stores', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-vault-'));
  try {
    const v = new Vault(dir);
    const sheet = { id: 's1', system: 'coc7', data: { name: 'Mabel Grimsby', str: 50 } };
    const c = v.save('Ada', sheet, { room: 'masks', roomTitle: 'Masks' });
    v.save('Ada', { ...sheet, data: { name: 'Mabel Grimsby', str: 55 } }, { room: 'masks' });
    assert.equal(v.list('Ada').length, 1, 'saving the same sheet again updates it');
    assert.equal(v.get('Ada', c.id).data.str, 55);
    v.save('Ada', sheet, { room: 'other' });
    assert.equal(v.list('Ada').length, 2);
    assert.equal(v.list('Ben').length, 0, 'everyone has their own');
    v.rename('Ada', c.id, 'Mabel G.');
    assert.equal(new Vault(dir).get('Ada', c.id).data.name, 'Mabel G.');
    assert.ok(v.remove('Ada', c.id));

    const l = new Lfg(dir);
    assert.throws(() => l.request('masks', 'Bob'), /isn't looking/);
    l.set('masks', { open: true, seats: 99, schedule: 'Fridays 7:30pm', newPlayers: true }, 'Flick');
    assert.equal(l.get('masks').seats, 12);
    const r = l.request('masks', 'Bob', 'Hi!');
    assert.equal(l.request('masks', 'Bob', 'Hi again').id, r.id, 'one open request each');
    assert.equal(l.requestsFor('masks')[0].message, 'Hi again');
    l.decide(r.id, 'accepted');
    assert.equal(new Lfg(dir).getRequest(r.id).status, 'accepted');
    l.set('masks', { open: false }, 'Flick');
    assert.equal(l.open().length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the real server ----------
const PORT = 3994;
const URL = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-community-'));
let proc;
before(async () => {
  fs.mkdirSync(path.join(dataDir, 'rooms'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'uploads', 'aaaaaaaaaaaaaaaaaaaaaaaa.png'), 'map');
  fs.writeFileSync(path.join(dataDir, 'rooms', 'masks.json'), JSON.stringify({ ...played, id: 'masks' }));
  fs.writeFileSync(path.join(dataDir, 'rooms', 'masks.thumb.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
  proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, GM_PASSWORD: 'secret', DATA_DIR: dataDir, ACCOUNTS: '1' }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => d.toString().includes('running') && resolve());
    proc.on('exit', reject);
  });
});
after(() => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function browser(ip) {
  let cookie = '';
  const req = async (url, body) => {
    const r = await fetch(URL + url, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null;
    try { data = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, data, res: r };
  };
  const socket = () => io(URL, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { cookie } : {} });
  return { req, socket, get cookie() { return cookie; } };
}
const emit = (s, evt, p) => new Promise((r) => s.emit(evt, p, r));

test('Lantern Server: publish, the marketplace, library, starting a game from a module, export and import', async () => {
  const gm = browser('198.51.100.1'), kirsty = browser('198.51.100.2');
  assert.equal((await gm.req('/api/auth/setup', { gmPassword: 'secret', name: 'Flick', password: 'lantern-gm' })).status, 200);
  await gm.req('/api/games', { room: 'masks' }); // the admin runs the old campaign
  await gm.req('/api/admin/settings', { openSignup: true });
  assert.equal((await kirsty.req('/api/auth/register', { name: 'Kirsty', password: 'kirsty-pw' })).status, 200);

  // what publishing would include
  assert.equal((await kirsty.req('/api/games/masks/publish')).status, 403, 'only its GM');
  const pre = (await gm.req('/api/games/masks/publish')).data;
  assert.deepEqual([pre.title, pre.ruleset, pre.contents.scenes, pre.contents.npcs, pre.module], ['Masks', 'coc7', 1, 2, null]);
  assert.equal((await gm.req('/api/games/masks/publish', { title: 'Masks', visibility: 'public' })).status, 400, 'public needs the tick');
  const pub = (await gm.req('/api/games/masks/publish', { title: 'Masks of Nyarlathotep', description: 'Around the world, 1925', visibility: 'private' })).data.module;
  assert.deepEqual([pub.version, pub.visibility, pub.author], [1, 'private', 'Flick']);
  assert.match(pub.cover, /^\/uploads\/[a-f0-9]{24}\.jpg$/, 'the game’s thumbnail is the cover');
  assert.equal((await fetch(URL + pub.cover)).status, 200);

  // the marketplace and Kirsty's library
  const market = (await kirsty.req('/api/modules')).data.modules;
  assert.deepEqual(market.map((m) => [m.title, m.inLibrary]), [['Masks of Nyarlathotep', false]]);
  assert.equal((await kirsty.req('/api/games', { title: 'Masks Friday', module: pub.id })).status, 400, 'add it to your library first');
  assert.ok((await kirsty.req(`/api/modules/${pub.id}/library`, { on: true })).data.inLibrary);
  assert.equal((await kirsty.req('/api/my-library')).data.modules[0].id, pub.id);

  // start a game from it: she's its GM, the NPCs are hers, the group's history isn't there
  const g = await kirsty.req('/api/games', { title: 'Masks Friday', module: pub.id });
  assert.equal(g.status, 200);
  assert.equal(g.data.room, 'masks-friday');
  const ks = kirsty.socket();
  try {
    const j = await emit(ks, 'join', { room: 'masks-friday' });
    assert.ok(j.ok, j.error);
    const sheets = await new Promise((r) => { ks.once('sheets', r); ks.emit('scene:view', { id: null }, () => {}); setTimeout(() => r(null), 1500); });
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms', 'masks-friday.json'), 'utf8'));
    assert.deepEqual(saved.sheets.map((s) => [s.data.name, s.owner]), [['Cultist', 'Kirsty'], ['Mr Mukunga', 'Kirsty']]);
    assert.deepEqual([saved.chat.length, saved.page.title, saved.page.log.length], [0, 'Masks Friday', 0]);
    assert.ok(sheets === null || Array.isArray(sheets));

    // the character vault: save a character, then use it in another game
    const made = await emit(ks, 'sheet:create', { system: 'coc7', data: { name: 'Harvey Walters' } });
    const sv = await emit(ks, 'vault:save', { id: made.id });
    assert.ok(sv.ok, sv.error);
    const v = (await kirsty.req('/api/vault')).data.characters;
    assert.deepEqual(v.map((c) => [c.name, c.system, c.from.title]), [['Harvey Walters', 'coc7', 'Masks Friday']]);
  } finally { ks.close(); }

  // update notes: Flick republishes, Kirsty sees there's an update
  await gm.req('/api/games/masks/publish', { title: 'Masks of Nyarlathotep', visibility: 'private' });
  assert.equal((await kirsty.req('/api/my-library')).data.modules[0].update, true);
  assert.equal((await kirsty.req('/api/games/masks/publish', { title: 'Mine now', visibility: 'private' })).status, 403);

  // reviews
  assert.equal((await gm.req(`/api/modules/${pub.id}/review`, { stars: 5 })).status, 400, 'not your own');
  const rv = (await kirsty.req(`/api/modules/${pub.id}/review`, { stars: 4, text: 'Brilliant' })).data.module;
  assert.deepEqual([rv.stars, rv.reviews[0].by], [4, 'Kirsty']);

  // private modules don't leave the server; public ones export to a file another server can import
  assert.equal((await kirsty.req(`/api/modules/${pub.id}/export`)).status, 403);
  await gm.req('/api/games/masks/publish', { title: 'Gallows Hill', visibility: 'public', shareOk: true });
  const ex = await kirsty.req(`/api/modules/${pub.id}/export`);
  assert.equal(ex.status, 200);
  assert.match(ex.res.headers.get('content-disposition'), /Gallows Hill\.lantern/);
  const file = Buffer.from(await (await fetch(`${URL}/api/modules/${pub.id}/export`, { headers: { cookie: kirsty.cookie } })).arrayBuffer());
  const fd = new FormData();
  fd.append('file', new Blob([file]), 'Gallows Hill.lantern');
  const im = await fetch(`${URL}/api/modules/import`, { method: 'POST', body: fd, headers: { cookie: kirsty.cookie } });
  assert.equal(im.status, 200);
  const imported = (await im.json()).module;
  assert.deepEqual([imported.title, imported.importedBy, imported.origin.author], ['Gallows Hill', 'Kirsty', 'Flick']);

  // withdrawing and taking down
  assert.equal((await kirsty.req(`/api/modules/${pub.id}/withdraw`, {})).status, 403);
  await gm.req(`/api/modules/${pub.id}/withdraw`, {});
  assert.ok(!(await kirsty.req('/api/modules')).data.modules.some((m) => m.id === pub.id));
  assert.equal((await kirsty.req(`/api/modules/${imported.id}/takedown`, {})).status, 403, 'admins only');
  assert.equal((await gm.req(`/api/modules/${imported.id}/takedown`, {})).status, 200);
  assert.ok(!(await kirsty.req('/api/my-library')).data.modules.some((m) => m.id === imported.id));
});

test('Lantern Server: looking for group, from a public listing to a seat at the table', async () => {
  const gm = browser('198.51.100.3'), visitor = browser('198.51.100.4'), bob = browser('198.51.100.5');
  assert.equal((await gm.req('/api/auth/login', { name: 'Flick', password: 'lantern-gm' })).status, 200);
  await gm.req('/api/admin/settings', { openSignup: false });

  // a listing, visible without logging in
  assert.equal((await visitor.req('/api/games/masks/lfg', { open: true })).status, 401);
  const set = await gm.req('/api/games/masks/lfg', { open: true, seats: 4, schedule: 'Fridays 7:30pm', newPlayers: true, howWePlay: 'Lantern video' });
  assert.equal(set.status, 200);
  const pub = (await visitor.req('/api/lfg')).data;
  assert.equal(pub.signedIn, false);
  assert.deepEqual(pub.listings.map((l) => [l.title, l.schedule, l.seats, l.newPlayers, l.gm, l.thumb]), [['Masks', 'Fridays 7:30pm', 4, true, 'Flick', true]]);
  assert.equal((await fetch(`${URL}/api/lfg/masks/thumb`)).status, 200);
  assert.equal((await fetch(`${URL}/api/lfg/masks-friday/thumb`)).status, 404, 'only listed games show their picture');
  assert.equal((await fetch(`${URL}/lfg.html`)).status, 200);

  // sign-up is closed, but asking to join a listed game makes an account and the request together
  assert.equal((await visitor.req('/api/auth/register', { name: 'Bob', password: 'bob-password' })).status, 403);
  assert.equal((await visitor.req('/api/auth/register', { name: 'Bob', password: 'bob-password', lfg: 'masks', message: 'Never played, keen!' })).status, 200);
  let mine = (await visitor.req('/api/lfg')).data.listings[0];
  assert.deepEqual([mine.member, mine.request.status], [false, 'pending']);

  // the GM sees it and says yes: Bob is a player in the game
  const reqs = (await gm.req('/api/games/masks/lfg')).data.requests;
  assert.deepEqual(reqs.map((r) => [r.name, r.message, r.status]), [['Bob', 'Never played, keen!', 'pending']]);
  const games = (await gm.req('/api/me/games')).data.games;
  assert.equal(games.find((x) => x.room === 'masks').lfg, 1, 'the card says one request is waiting');
  assert.equal((await visitor.req(`/api/games/masks/lfg/requests/${reqs[0].id}`, { accept: true })).status, 403);
  await gm.req(`/api/games/masks/lfg/requests/${reqs[0].id}`, { accept: true });
  const bobGames = (await visitor.req('/api/me/games')).data.games;
  assert.deepEqual(bobGames.map((x) => [x.room, x.role]), [['masks', 'player']]);
  mine = (await visitor.req('/api/lfg')).data.listings[0];
  assert.deepEqual([mine.member, mine.seatsLeft], [true, 3]);
  assert.equal((await visitor.req('/api/lfg/masks/request', { message: 'again' })).status, 400, 'already in');

  // closing the listing: it's gone, and so is the back door into sign-up
  await gm.req('/api/games/masks/lfg', { open: false });
  assert.equal((await bob.req('/api/lfg')).data.listings.length, 0);
  assert.equal((await bob.req('/api/auth/register', { name: 'Bobby', password: 'bob-password', lfg: 'masks' })).status, 403);
});
