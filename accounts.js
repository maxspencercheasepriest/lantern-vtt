// Player accounts for an always-on Lantern server: logins, which games each person is in, and invite links.
//
// Off unless the server is started with ACCOUNTS=1 (or startServer({ accounts: true })). The desktop app's
// Host/Join flow doesn't use it. Everything lives in DATA_DIR/accounts.json:
//   users:    { [lowercase name]: { name, salt, hash, admin, games: { [room]: 'gm' | 'player' }, created } }
//   sessions: { [sha256 of token]: { user, expires } }       (the token itself is only ever in the cookie)
//   invites:  { [code]: { room, role, by, created, expires } }
// A person's account name is the name they appear as in games, so character sheets owned by that name
// (including ones made before accounts were switched on) are theirs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SESSION_SHORT = 12 * 3600 * 1000;      // "remember me" off
export const SESSION_LONG = 60 * 24 * 3600 * 1000;  // "remember me" on: 60 days
export const INVITE_LIFE = 14 * 24 * 3600 * 1000;
const ROLES = ['gm', 'player'];

const key = (name) => String(name || '').trim().toLowerCase();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function cleanAccountName(n) {
  const s = String(n ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 32) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '._-]*$/u.test(s)) return null;
  return s;
}
export const okRoom = (r) => typeof r === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(r);

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function passwordMatches(user, password) {
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Passwords need at least 8 characters';
  if (pw.length > 200) return 'That password is too long';
  return null;
}

export class Accounts {
  constructor(dataDir, { now = () => Date.now() } = {}) {
    this.file = path.join(dataDir, 'accounts.json');
    this.now = now;
    this.data = { users: {}, sessions: {}, invites: {} };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first run */ }
    this.prune();
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  prune() {
    const t = this.now();
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.expires < t || !this.data.users[s.user]) delete this.data.sessions[k];
    for (const [k, i] of Object.entries(this.data.invites)) if (i.expires < t) delete this.data.invites[k];
  }

  get needsSetup() { return Object.keys(this.data.users).length === 0; }
  user(name) { return this.data.users[key(name)] || null; }
  publicUser(u) { return u && { name: u.name, admin: !!u.admin, games: { ...u.games } }; }
  listUsers() {
    return Object.values(this.data.users).map((u) => this.publicUser(u)).sort((a, b) => a.name.localeCompare(b.name));
  }

  createUser(name, password, { admin = false } = {}) {
    const clean = cleanAccountName(name);
    if (!clean) throw new Error('Names are 2–32 letters, numbers or spaces');
    if (this.user(clean)) throw new Error('That name is already taken');
    const weak = checkPasswordStrength(password);
    if (weak) throw new Error(weak);
    const u = { name: clean, ...hashPassword(password), admin: !!admin, games: {}, created: this.now() };
    this.data.users[key(clean)] = u;
    this.save();
    return u;
  }

  setPassword(name, password) {
    const u = this.user(name);
    if (!u) throw new Error('No such person');
    const weak = checkPasswordStrength(password);
    if (weak) throw new Error(weak);
    Object.assign(u, hashPassword(password));
    // a new password signs that person out everywhere
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.user === key(name)) delete this.data.sessions[k];
    this.save();
  }

  deleteUser(name) {
    if (!this.user(name)) throw new Error('No such person');
    delete this.data.users[key(name)];
    this.prune();
    this.save();
  }

  setAdmin(name, admin) {
    const u = this.user(name);
    if (!u) throw new Error('No such person');
    if (!admin && u.admin && this.listUsers().filter((x) => x.admin).length === 1) throw new Error("There has to be at least one admin");
    u.admin = !!admin;
    this.save();
  }

  setRole(name, room, role) {
    const u = this.user(name);
    if (!u) throw new Error('No such person');
    if (!okRoom(room)) throw new Error('Game names: lowercase letters, numbers and dashes');
    if (role === null || role === undefined || role === '') delete u.games[room];
    else if (ROLES.includes(role)) u.games[room] = role;
    else throw new Error('Role is gm or player');
    this.save();
  }

  roleIn(name, room) { return this.user(name)?.games?.[room] || null; }
  canManage(name, room) { const u = this.user(name); return !!u && (u.admin || u.games[room] === 'gm'); }
  membersOf(room) {
    return Object.values(this.data.users).filter((u) => u.games[room]).map((u) => ({ name: u.name, role: u.games[room] }))
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'gm' ? -1 : 1));
  }
  // a game nobody is in yet can be claimed by whoever creates it
  roomTaken(room) { return Object.values(this.data.users).some((u) => u.games[room]); }

  // ----- logging in -----
  login(name, password) {
    const u = this.user(name);
    // same work whether or not the name exists, so timing doesn't reveal who has an account
    if (!u) { hashPassword(password); return null; }
    return passwordMatches(u, password) ? u : null;
  }

  startSession(name, remember) {
    const token = crypto.randomBytes(32).toString('base64url');
    const life = remember ? SESSION_LONG : SESSION_SHORT;
    this.data.sessions[sha(token)] = { user: key(name), expires: this.now() + life, remember: !!remember };
    this.prune();
    this.save();
    return { token, maxAge: life };
  }

  sessionUser(token) {
    if (typeof token !== 'string' || !token) return null;
    const s = this.data.sessions[sha(token)];
    if (!s || s.expires < this.now()) return null;
    return this.data.users[s.user] || null;
  }

  endSession(token) {
    if (typeof token !== 'string') return;
    if (delete this.data.sessions[sha(token)]) this.save();
  }

  // ----- invites -----
  createInvite(room, role, by) {
    if (!okRoom(room)) throw new Error('Game names: lowercase letters, numbers and dashes');
    if (!ROLES.includes(role)) throw new Error('Role is gm or player');
    const code = crypto.randomBytes(9).toString('base64url');
    this.data.invites[code] = { room, role, by: by || '', created: this.now(), expires: this.now() + INVITE_LIFE };
    this.save();
    return { code, ...this.data.invites[code] };
  }
  invite(code) {
    if (typeof code !== 'string') return null;
    const i = this.data.invites[code];
    return i && i.expires >= this.now() ? i : null;
  }
  invitesFor(room) {
    this.prune();
    return Object.entries(this.data.invites).filter(([, i]) => i.room === room).map(([code, i]) => ({ code, ...i }));
  }
  revokeInvite(code) { if (delete this.data.invites[code]) this.save(); }

  // joining by invite never demotes: a GM who opens a player link stays GM
  redeem(name, code) {
    const i = this.invite(code);
    if (!i) throw new Error('That invite link has expired — ask your GM for a new one');
    const u = this.user(name);
    if (!u) throw new Error('No such person');
    if (u.games[i.room] !== 'gm') u.games[i.room] = i.role;
    this.save();
    return i;
  }
}

// ----- cookies (no dependency needed for one cookie) -----
export const COOKIE = 'lantern_session';
export function readCookie(header, name = COOKIE) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
export function sessionCookie(token, { maxAge, secure }) {
  const bits = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge === 0) bits.push('Max-Age=0');
  else if (maxAge) bits.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  if (secure) bits.push('Secure');
  return bits.join('; ');
}
