// Logins for the always-on server (ACCOUNTS=1): the Accounts store, then the real server over HTTP and sockets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { Accounts, readCookie, sessionCookie, cleanAccountName } from '../accounts.js';

test('Accounts store: users, sessions, roles and invites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-acc-'));
  try {
    let t = 1_000_000;
    const a = new Accounts(dir, { now: () => t });
    assert.ok(a.needsSetup);
    assert.throws(() => a.createUser('x', 'longenough'), /2–32/);
    assert.throws(() => a.createUser('Flick', 'short'), /8 characters/);
    a.createUser('Flick', 'correct horse', { admin: true });
    assert.throws(() => a.createUser('flick', 'another one'), /taken/);
    assert.equal(a.login('FLICK', 'correct horse').name, 'Flick');
    assert.equal(a.login('Flick', 'wrong'), null);
    assert.equal(a.login('nobody', 'whatever'), null);

    const { token } = a.startSession('Flick', false);
    assert.equal(a.sessionUser(token).name, 'Flick');
    assert.equal(a.sessionUser('made-up'), null);
    t += 13 * 3600 * 1000; // short sessions last 12 hours
    assert.equal(a.sessionUser(token), null);

    // stored on disk, without the token itself
    const remembered = a.startSession('Flick', true).token;
    const raw = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
    assert.ok(!raw.includes(remembered) && !raw.includes('correct horse'));
    assert.equal(new Accounts(dir, { now: () => t }).sessionUser(remembered).name, 'Flick');

    a.setRole('Flick', 'thaw', 'gm');
    const inv = a.createInvite('thaw', 'player', 'Flick');
    a.createUser('Portia', 'portia-pass');
    a.redeem('Portia', inv.code);
    assert.equal(a.roleIn('Portia', 'thaw'), 'player');
    a.redeem('Flick', inv.code); // a GM opening a player link stays GM
    assert.equal(a.roleIn('Flick', 'thaw'), 'gm');
    assert.deepEqual(a.membersOf('thaw').map((m) => m.name), ['Flick', 'Portia']);
    assert.ok(a.canManage('Flick', 'thaw') && !a.canManage('Portia', 'thaw'));
    t += 15 * 24 * 3600 * 1000; // invites expire after two weeks
    assert.throws(() => a.redeem('Portia', inv.code), /expired/);

    // a new password signs that person out everywhere
    const s2 = a.startSession('Portia', true).token;
    a.setPassword('Portia', 'brand new pass');
    assert.equal(a.sessionUser(s2), null);
    assert.ok(a.login('Portia', 'brand new pass'));
    assert.throws(() => a.setAdmin('Flick', false), /at least one admin/);
    a.deleteUser('Portia');
    assert.equal(a.user('Portia'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('names and cookies', () => {
  assert.equal(cleanAccountName('  Ben   S '), 'Ben S');
  assert.equal(cleanAccountName("O'Neil"), "O'Neil");
  assert.equal(cleanAccountName('<script>'), null);
  assert.equal(readCookie('a=1; lantern_session=abc%2Fd; b=2'), 'abc/d');
  assert.equal(readCookie('a=1'), null);
  const c = sessionCookie('tok', { maxAge: 60_000, secure: true });
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=60/);
  assert.match(c, /Secure/);
});

// ---------- the real server with ACCOUNTS=1 ----------
const PORT = 3996;
const URL = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-acc-srv-'));
let proc;
before(async () => {
  // an old campaign saved before logins existed
  fs.mkdirSync(path.join(dataDir, 'rooms'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'rooms', 'oldgame.json'), JSON.stringify({ id: 'oldgame', sheets: [{ id: 's1', owner: 'Portia', system: 'generic', data: { name: 'Mags' } }] }));
  proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, GM_PASSWORD: 'secret', DATA_DIR: dataDir, ACCOUNTS: '1' }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => d.toString().includes('running') && resolve());
    proc.on('exit', reject);
  });
});
after(() => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// a tiny browser: remembers its cookie
// (ip: as if through a Cloudflare tunnel from that address, so the password-guessing limit counts it apart)
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
    try { data = await r.json(); } catch { /* redirects and pages */ }
    return { status: r.status, data, location: r.headers.get('location') };
  };
  const socket = () => io(URL, { transports: ['websocket'], forceNew: true, extraHeaders: cookie ? { cookie } : {} });
  return { req, socket, get cookie() { return cookie; } };
}
const emit = (s, evt, p) => new Promise((r) => s.emit(evt, p, r));

test('ACCOUNTS=1: setup, invites, games list and joining by login', async () => {
  const gm = browser(), pl = browser(), stranger = browser();

  // pages: the front page is My games; the table wants a login
  assert.equal((await gm.req('/')).location, '/home.html');
  assert.match((await gm.req('/?room=thaw')).location, /^\/home\.html\?next=/);
  assert.equal((await gm.req('/invite/abc')).location, '/home.html?invite=abc');

  let st = (await gm.req('/api/auth/status')).data;
  assert.ok(st.accounts && st.setup && !st.user);

  // first admin needs the GM password
  assert.equal((await gm.req('/api/auth/setup', { gmPassword: 'nope', name: 'Flick', password: 'lantern-gm' })).status, 403);
  assert.equal((await gm.req('/api/auth/setup', { gmPassword: 'secret', name: 'Flick', password: 'lantern-gm' })).status, 200);
  assert.ok(gm.cookie.startsWith('lantern_session='));
  assert.equal((await stranger.req('/api/auth/setup', { gmPassword: 'secret', name: 'Mallory', password: 'mallory-pw' })).status, 409);
  st = (await gm.req('/api/auth/status')).data;
  assert.equal(st.user.name, 'Flick');
  assert.ok(st.user.admin);

  // must be JSON (so other websites can't post forms here with the cookie)
  const form = await fetch(`${URL}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Flick&password=lantern-gm' });
  assert.equal(form.status, 415);

  // start a game, make an invite, a new player signs up through it
  assert.equal((await gm.req('/api/games', { room: 'thaw' })).data.room, 'thaw');
  const inv = (await gm.req('/api/games/thaw/invites', { role: 'player' })).data;
  assert.ok(inv.code);
  assert.equal((await pl.req(`/api/auth/invite/${inv.code}`)).data.room, 'thaw');
  assert.equal((await pl.req('/api/auth/register', { invite: 'bogus', name: 'Portia', password: 'portia-pw' })).status, 403);
  const reg = await pl.req('/api/auth/register', { invite: inv.code, name: 'Portia', password: 'portia-pw', remember: true });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.games.thaw, 'player');
  assert.equal((await pl.req('/api/games/thaw/invites', { role: 'player' })).status, 403); // players can't invite

  // joining: identity comes from the login, not the form
  const gs = gm.socket(), ps = pl.socket(), ss = stranger.socket();
  try {
    assert.equal((await emit(ss, 'join', { room: 'thaw', name: 'Flick', gmPassword: 'secret' })).error, 'Log in first');
    const gj = await emit(gs, 'join', { room: 'thaw' });
    assert.ok(gj.ok && gj.isGM && gj.name === 'Flick' && gj.accounts);
    const pj = await emit(ps, 'join', { room: 'thaw', name: 'Flick', gmPassword: 'secret' });
    assert.ok(pj.ok && !pj.isGM);
    assert.equal(pj.name, 'Portia');
    assert.match((await emit(ps, 'join', { room: 'oldgame' })).error, /not in that game/);
    // her character shows up on her games list
    assert.ok((await emit(ps, 'sheet:create', { system: 'generic', data: { name: 'Jax' } })).id);
    await new Promise((r) => setTimeout(r, 50));
    const mine = (await pl.req('/api/me/games')).data.games.find((g) => g.room === 'thaw');
    assert.deepEqual(mine.characters.map((c) => c.name), ['Jax']);
    assert.equal(mine.online, 2);
  } finally { gs.close(); ps.close(); ss.close(); }

  // the old campaign: only an admin can claim it; then Portia's sheet from before is hers
  assert.equal((await pl.req('/api/games', { room: 'oldgame' })).status, 409);
  assert.equal((await gm.req('/api/admin/users')).data.campaigns.includes('oldgame'), true);
  assert.equal((await pl.req('/api/admin/users')).status, 403);
  await gm.req('/api/games', { room: 'oldgame' });
  await gm.req('/api/games/oldgame/members', { name: 'Portia', role: 'player' });
  const old = (await pl.req('/api/me/games')).data.games.find((g) => g.room === 'oldgame');
  assert.deepEqual(old.characters.map((c) => c.name), ['Mags']);

  // wrong passwords run out after 10 tries
  for (let i = 0; i < 10; i++) await stranger.req('/api/auth/login', { name: 'Portia', password: 'guess' + i });
  assert.equal((await stranger.req('/api/auth/login', { name: 'Portia', password: 'portia-pw' })).status, 429);

  // logging out ends the session
  await pl.req('/api/auth/logout', {});
  assert.equal((await pl.req('/api/me/games')).status, 401);
});

test('ACCOUNTS=1: signing up, every campaign for admins, new games with a name, bringing campaigns in', async () => {
  const { zipSync } = await import('fflate');
  const gm = browser('203.0.113.7'), newb = browser('203.0.113.8');
  assert.equal((await gm.req('/api/auth/login', { name: 'Flick', password: 'lantern-gm' })).status, 200, 'another address isn’t blocked by the guesses above');

  // without an invite, only once an admin lets anyone sign up
  assert.equal((await newb.req('/api/auth/register', { name: 'Kirsty', password: 'kirsty-pw' })).status, 403);
  assert.ok(!(await newb.req('/api/auth/status')).data.openSignup);
  assert.equal((await newb.req('/api/admin/settings', { openSignup: true })).status, 401);
  assert.ok((await gm.req('/api/admin/settings', { openSignup: true })).data.openSignup);
  assert.ok((await newb.req('/api/auth/status')).data.openSignup);
  assert.equal((await newb.req('/api/auth/register', { name: 'Kirsty', password: 'kirsty-pw', remember: true })).status, 200);

  // anyone can start a game with a proper name and pick the system: they're its GM
  const g = await newb.req('/api/games', { title: 'Forest of Fear: Flight into Darkness', ruleset: 'swade' });
  assert.equal(g.data.room, 'forest-of-fear-flight-into-darkness');
  const mine = (await newb.req('/api/me/games')).data;
  const game = mine.games.find((x) => x.room === g.data.room);
  assert.deepEqual([game.title, game.ruleset, game.role], ['Forest of Fear: Flight into Darkness', 'swade', 'gm']);
  assert.equal(mine.others, undefined, 'only admins see everyone else’s');
  assert.equal((await newb.req('/api/games', { title: 'Forest of Fear: Flight into Darkness' })).data.room, g.data.room, 'asking again just opens it');
  assert.equal((await newb.req('/api/games', { title: '!!!' })).status, 400);

  // an admin sees it among the other campaigns, with its GM, and can run it too
  let all = (await gm.req('/api/me/games')).data;
  assert.deepEqual(all.others.find((x) => x.room === g.data.room).gms, ['Kirsty']);
  await gm.req('/api/games', { room: g.data.room });
  all = (await gm.req('/api/me/games')).data;
  assert.equal(all.games.find((x) => x.room === g.data.room).role, 'gm');

  // bringing campaigns in from the desktop app's folder
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const pdf = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'handouts.pdf'));
  const docId = '0123456789abcdef';
  const zip = zipSync({
    'campaigns/rooms/forest-of-fear-flight-into-darkness.json': new TextEncoder().encode(JSON.stringify({ id: 'forest-of-fear-flight-into-darkness', scenes: [{ id: 'a', name: 'Crash site', map: { image: '/uploads/abc123.png' } }] })),
    'campaigns/rooms/masks.json': new TextEncoder().encode(JSON.stringify({ id: 'masks', scenes: [], settings: { ruleset: 'coc7' }, page: { title: 'Masks of Nyarlathotep' } })),
    'campaigns/rooms/masks.thumb.jpg': jpeg,
    'campaigns/rooms/notes.txt': new TextEncoder().encode('not a campaign'),
    'campaigns/uploads/abc123.png': png,
    'campaigns/library/library.json': new TextEncoder().encode(JSON.stringify({ docs: [{ id: docId, title: 'Old book', status: 'ready', pages: 2, share: {} }] })),
    [`campaigns/library/${docId}.pdf`]: new Uint8Array(pdf),
    [`campaigns/library/${docId}.text.json`]: new TextEncoder().encode(JSON.stringify({ pages: ['one', 'two'] })),
    'campaigns/accounts.json': new TextEncoder().encode('{"users":{}}'),
    '__MACOSX/campaigns/rooms/._masks.json': new Uint8Array([0, 5, 22, 7]),
  });
  const send = (who) => {
    const fd = new FormData();
    fd.append('file', new Blob([zip], { type: 'application/zip' }), 'campaigns.zip');
    return fetch(`${URL}/api/admin/bring-in`, { method: 'POST', body: fd, headers: { cookie: who.cookie, 'cf-connecting-ip': '203.0.113.7' } });
  };
  assert.equal((await send(newb)).status, 403, 'admins only');
  const res = await send(gm);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.deepEqual(r.campaigns.map((c) => [c.from, c.id]).sort(), [['forest-of-fear-flight-into-darkness', 'forest-of-fear-flight-into-darkness-2'], ['masks', 'masks']]);
  assert.equal(r.uploads, 1); assert.equal(r.pdfs, 1);
  assert.equal((await fetch(`${URL}/uploads/abc123.png`)).status, 200);
  all = (await gm.req('/api/me/games')).data;
  const masks = all.games.find((x) => x.room === 'masks');
  assert.deepEqual([masks.role, masks.title, masks.ruleset, masks.thumb], ['gm', 'Masks of Nyarlathotep', 'coc7', true]);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, 'library', 'library.json'), 'utf8')).docs.some((d) => d.id === docId), 'the PDF is in the library');
  assert.equal((await newb.req('/api/auth/login', { name: 'Kirsty', password: 'kirsty-pw' })).status, 200, 'accounts weren’t touched');
  // time at the table is counted onto the account, overall and per game
  const ks = newb.socket();
  try {
    assert.ok((await emit(ks, 'join', { room: g.data.room })).ok);
    await new Promise((r) => setTimeout(r, 1300));
  } finally { ks.close(); }
  await new Promise((r) => setTimeout(r, 300));
  const me = (await newb.req('/api/auth/status')).data.user;
  assert.ok(me.playMs >= 1000 && me.gameMs[g.data.room] >= 1000, 'played time counted');
  assert.ok(me.created > Date.now() - 600e3, 'sign-up date kept');
  assert.ok((await gm.req('/api/admin/users')).data.users.find((u) => u.name === 'Kirsty').playMs >= 1000, 'admins see it');
  await gm.req('/api/admin/settings', { openSignup: false });
});
