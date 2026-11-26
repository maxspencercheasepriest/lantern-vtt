// "My games": logging in, invite links, the list of your games and characters, and managing people.
// Only used when the server runs with logins switched on (ACCOUNTS=1).
import { RULESET_INFO } from '/rules/references.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const inviteCode = params.get('invite');
const nextUrl = (() => { const n = params.get('next') || ''; return /^\/(?!\/)/.test(n) ? n : ''; })();
let me = null;

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  (document.querySelector('dialog[open]') || document.body).appendChild(t); // stay visible above an open dialog
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function api(url, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(url, { credentials: 'same-origin', ...opts });
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error(data.error || `Something went wrong (${r.status})`), { status: r.status });
  return data;
}

const ago = (ms) => {
  if (!ms) return 'not played yet';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const until = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const rulesetName = (id) => RULESET_INFO[id]?.name || (id ? id : 'Ruleset not chosen yet');
const playUrl = (room) => `/?room=${encodeURIComponent(room)}`;

// ---------- start ----------
async function start() {
  let st;
  try { st = await api('/api/auth/status'); } catch (e) {
    if (e.status === 404) { location.href = '/'; return; } // logins are off on this server: use the normal join screen
    showGate(); $('#gate-error').textContent = "Can't reach the server — try again in a moment."; return;
  }
  if (st.setup) return showGate('setup');
  if (st.user) {
    me = st.user;
    if (inviteCode) {
      try {
        const r = await api('/api/auth/redeem', { invite: inviteCode });
        toast(`You're in ${r.room}`);
        history.replaceState(null, '', '/home.html');
      } catch (e) { toast(e.message, true); }
    }
    if (nextUrl) { location.href = nextUrl; return; }
    return showDash();
  }
  if (inviteCode) return showInvite();
  showGate('login');
}

// ---------- signed out ----------
function showGate(which) {
  $('#dash').hidden = true;
  $('#gate').hidden = false;
  for (const f of ['setup-form', 'register-form', 'login-form']) $(`#${f}`).hidden = f !== `${which}-form`;
  $('#gate-error').textContent = '';
  const first = which && $(`#${which}-form input`);
  if (first) first.focus();
}

async function showInvite() {
  try {
    const i = await api(`/api/auth/invite/${encodeURIComponent(inviteCode)}`);
    $('#invite-banner').innerHTML = `${i.by ? `<strong>${esc(i.by)}</strong> has invited you` : "You've been invited"} to <strong>${esc(i.room)}</strong>${i.role === 'gm' ? ' as a GM' : ''}.`;
    $('#invite-banner').hidden = false;
    $('#invite-tabs').hidden = false;
    $('#login-hint').textContent = "Log in and we'll add the game to your list.";
    showGate('register');
  } catch (e) {
    showGate('login');
    $('#gate-error').textContent = e.message;
  }
}
for (const b of document.querySelectorAll('#invite-tabs button')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('#invite-tabs button')) x.classList.toggle('active', x === b);
    showGate(b.dataset.tab);
  };
}

function formError(form, msg) { (form.closest('dialog')?.querySelector('.error') || $('#gate-error')).textContent = msg; }
function matching(form) {
  if (form.password.value !== form.password2.value) { formError(form, "The two passwords don't match"); return false; }
  return true;
}
async function afterLogin(user) {
  me = user;
  if (inviteCode) {
    try { await api('/api/auth/redeem', { invite: inviteCode }); } catch (e) { toast(e.message, true); }
    history.replaceState(null, '', '/home.html');
  }
  if (nextUrl) { location.href = nextUrl; return; }
  showDash();
}
function busy(form, on) { const b = form.querySelector('button[type=submit]'); if (b) b.disabled = on; }

$('#setup-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!matching(f)) return;
  busy(f, true);
  try {
    const r = await api('/api/auth/setup', { gmPassword: f.gmPassword.value, name: f.name.value, password: f.password.value });
    toast("You're set up — welcome!");
    afterLogin(r.user);
  } catch (err) { formError(f, err.message); } finally { busy(f, false); }
};
$('#register-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!matching(f)) return;
  busy(f, true);
  try {
    const r = await api('/api/auth/register', { invite: inviteCode, name: f.name.value, password: f.password.value, remember: f.remember.checked });
    history.replaceState(null, '', '/home.html');
    me = r.user;
    showDash();
  } catch (err) { formError(f, err.message); } finally { busy(f, false); }
};
$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  busy(f, true);
  try {
    const r = await api('/api/auth/login', { name: f.name.value, password: f.password.value, remember: f.remember.checked });
    afterLogin(r.user);
  } catch (err) { formError(f, err.message); f.password.select(); } finally { busy(f, false); }
};

// ---------- My games ----------
async function showDash() {
  $('#gate').hidden = true;
  $('#dash').hidden = false;
  $('#me-name').textContent = me.name;
  $('#btn-admin').hidden = !me.admin;
  await loadGames();
}

async function loadGames() {
  let data;
  try { data = await api('/api/me/games'); } catch (e) {
    if (e.status === 401) { me = null; return showGate('login'); }
    return toast(e.message, true);
  }
  me = data.user;
  const box = $('#games');
  $('#no-games').hidden = data.games.length > 0;
  box.innerHTML = data.games.map((g) => `
    <article class="game" data-room="${esc(g.room)}">
      <a class="game-thumb" href="${playUrl(g.room)}" title="Join ${esc(g.room)}">
        ${g.thumb ? `<img src="/api/games/${encodeURIComponent(g.room)}/thumb?t=${Math.round(g.played)}" alt="" loading="lazy">` : '<span class="flame big"></span>'}
        ${g.online ? `<span class="live">${g.online} at the table</span>` : ''}
      </a>
      <div class="game-body">
        <div class="game-top">
          <h2>${esc(g.title || g.room)}</h2>
          <span class="badge ${g.role}">${g.role === 'gm' ? 'GM' : 'Player'}</span>
        </div>
        <p class="muted small">${esc(rulesetName(g.ruleset))}${g.scene ? ` · ${esc(g.scene)}` : ''} · ${g.played ? `played ${ago(g.played)}` : g.started ? 'just started' : 'not started yet'}</p>
        ${g.nextSession && Date.parse(g.nextSession) > Date.now() - 3 * 3600e3 ? `<p class="next-game">Next game: <b>${esc(new Date(g.nextSession).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }))}</b></p>` : ''}
        ${g.blurb ? `<p class="small blurb">${esc(g.blurb)}</p>` : ''}
        ${g.lastWriteup ? `<p class="muted small">Latest write-up: ${esc(g.lastWriteup)} · open <b>Campaign</b> at the table to read it</p>` : ''}
        <div class="chars">
          ${g.characters.length
            ? g.characters.map((c) => `<span class="char">${esc(c.name)}</span>`).join('')
            : `<span class="muted small">${g.role === 'gm' ? (g.totalSheets ? `${g.totalSheets} character sheet${g.totalSheets === 1 ? '' : 's'} in this game` : 'No character sheets yet') : 'No character yet — make one at the table'}</span>`}
        </div>
        <div class="game-actions">
          <a class="btn primary" href="${playUrl(g.room)}">Join</a>
          ${g.role === 'gm' || me.admin ? `<button class="btn" data-manage="${esc(g.room)}">Players &amp; invites</button>` : ''}
        </div>
      </div>
    </article>`).join('');
}

$('#games').addEventListener('click', (e) => {
  const b = e.target.closest('[data-manage]');
  if (b) openGame(b.dataset.manage);
});

$('#new-game').onsubmit = async (e) => {
  e.preventDefault();
  const room = e.target.room.value.trim().toLowerCase();
  try {
    const r = await api('/api/games', { room });
    location.href = playUrl(r.room);
  } catch (err) { toast(err.message, true); }
};

$('#btn-logout').onclick = async () => {
  try { await api('/api/auth/logout', {}); } catch { /* signed out anyway */ }
  me = null;
  showGate('login');
};

// ---------- one game's players and invites ----------
let gameRoom = null;
async function openGame(room) {
  gameRoom = room;
  $('#dlg-game-title').textContent = `${room}: players`;
  $('#dlg-game-error').textContent = '';
  await renderGame();
  $('#dlg-game').showModal();
}
async function renderGame() {
  let d;
  try { d = await api(`/api/games/${encodeURIComponent(gameRoom)}`); } catch (e) { $('#dlg-game-error').textContent = e.message; return; }
  $('#members').innerHTML = d.members.map((m) => `
    <li data-name="${esc(m.name)}">
      <span class="grow">${esc(m.name)}${m.name === me.name ? ' <span class="muted small">(you)</span>' : ''}</span>
      <select data-role>${['player', 'gm'].map((r) => `<option value="${r}"${m.role === r ? ' selected' : ''}>${r === 'gm' ? 'GM' : 'Player'}</option>`).join('')}</select>
      <button class="btn ghost danger" data-remove title="Take them out of this game (their account stays)">Remove</button>
    </li>`).join('') || '<li class="muted">Nobody yet.</li>';
  $('#invites').innerHTML = d.invites.map((i) => {
    const url = `${location.origin}/invite/${i.code}`;
    return `<li data-code="${esc(i.code)}">
      <span class="badge ${i.role}">${i.role === 'gm' ? 'GM' : 'Player'}</span>
      <input class="grow mono small" readonly value="${esc(url)}">
      <button class="btn" data-copy="${esc(url)}">Copy</button>
      <span class="muted small">until ${until(i.expires)}</span>
      <button class="btn ghost danger" data-revoke title="Stop this link working">✕</button>
    </li>`;
  }).join('') || '<li class="muted small">No open links.</li>';
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied — send it to your player'); } catch { toast('Select the link and copy it', true); }
}
async function newInvite(role) {
  try {
    const i = await api(`/api/games/${encodeURIComponent(gameRoom)}/invites`, { role });
    await renderGame();
    copyText(`${location.origin}/invite/${i.code}`);
  } catch (e) { $('#dlg-game-error').textContent = e.message; }
}
$('#invite-player').onclick = () => newInvite('player');
$('#invite-gm').onclick = () => newInvite('gm');
$('#dlg-game').addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  try {
    if (e.target.dataset.copy) return copyText(e.target.dataset.copy);
    if (e.target.matches('input[readonly]')) return e.target.select();
    if ('revoke' in e.target.dataset) {
      await api(`/api/games/${encodeURIComponent(gameRoom)}/invites/${encodeURIComponent(li.dataset.code)}/revoke`, {});
      return renderGame();
    }
    if ('remove' in e.target.dataset) {
      if (!confirm(`Take ${li.dataset.name} out of ${gameRoom}? Their account and characters stay.`)) return;
      await api(`/api/games/${encodeURIComponent(gameRoom)}/members`, { name: li.dataset.name, role: null });
      await renderGame();
      loadGames();
    }
  } catch (err) { $('#dlg-game-error').textContent = err.message; }
});
$('#dlg-game').addEventListener('change', async (e) => {
  if (!('role' in e.target.dataset)) return;
  const name = e.target.closest('li').dataset.name;
  try {
    await api(`/api/games/${encodeURIComponent(gameRoom)}/members`, { name, role: e.target.value });
    toast(`${name} is now ${e.target.value === 'gm' ? 'a GM' : 'a player'}`);
    loadGames();
  } catch (err) { $('#dlg-game-error').textContent = err.message; renderGame(); }
});
$('#add-member').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/api/games/${encodeURIComponent(gameRoom)}/members`, { name: f.name.value.trim(), role: f.role.value });
    f.reset();
    renderGame();
  } catch (err) { $('#dlg-game-error').textContent = err.message; }
};

// ---------- password ----------
$('#btn-password').onclick = () => { $('#password-form').reset(); $('#password-error').textContent = ''; $('#dlg-password').showModal(); };
$('#password-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!matching(f)) return;
  try {
    await api('/api/auth/password', { current: f.current.value, password: f.password.value });
    $('#dlg-password').close();
    toast('Password changed');
  } catch (err) { $('#password-error').textContent = err.message; }
};

// ---------- admin: people ----------
$('#btn-admin').onclick = async () => { $('#admin-error').textContent = ''; await renderAdmin(); $('#dlg-admin').showModal(); };
let adminData = null;
async function renderAdmin() {
  try { adminData = await api('/api/admin/users'); } catch (e) { $('#admin-error').textContent = e.message; return; }
  const { users, campaigns } = adminData;
  $('#users').innerHTML = users.map((u) => {
    const games = Object.entries(u.games).map(([r, role]) => `${esc(r)}${role === 'gm' ? ' (GM)' : ''}`).join(', ');
    return `<li data-name="${esc(u.name)}">
      <span class="grow"><strong>${esc(u.name)}</strong>${u.admin ? ' <span class="badge gm">Admin</span>' : ''}<br><span class="muted small">${games || 'No games'}</span></span>
      <button class="btn ghost" data-reset>Reset password</button>
      ${u.name === me.name ? '' : `<button class="btn ghost" data-admin="${u.admin ? '0' : '1'}">${u.admin ? 'Remove admin' : 'Make admin'}</button>
      <button class="btn ghost danger" data-delete>Delete</button>`}
    </li>`;
  }).join('');
  const claimed = new Set(users.flatMap((u) => Object.entries(u.games).filter(([, r]) => r === 'gm').map(([g]) => g)));
  const orphans = campaigns.filter((c) => !claimed.has(c));
  $('#orphans-section').hidden = !orphans.length;
  const options = users.map((u) => `<option>${esc(u.name)}</option>`).join('');
  $('#orphans').innerHTML = orphans.map((c) => `
    <li data-room="${esc(c)}"><span class="grow">${esc(c)}</span><select data-gm>${options}</select><button class="btn" data-assign>Make GM</button></li>`).join('');
}
$('#dlg-admin').addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const name = li.dataset.name;
  try {
    if ('reset' in e.target.dataset) {
      const pw = prompt(`New password for ${name} (at least 8 characters). Tell them it, and they can change it after logging in.`);
      if (!pw) return;
      await api(`/api/admin/users/${encodeURIComponent(name)}/password`, { password: pw });
      toast(`${name}'s password is reset`);
    } else if (e.target.dataset.admin) {
      await api(`/api/admin/users/${encodeURIComponent(name)}/admin`, { admin: e.target.dataset.admin === '1' });
    } else if ('delete' in e.target.dataset) {
      if (!confirm(`Delete ${name}'s account? Their characters stay in each game, and you can give them a new account with the same name later.`)) return;
      await api(`/api/admin/users/${encodeURIComponent(name)}/delete`, {});
    } else if ('assign' in e.target.dataset) {
      const who = li.querySelector('[data-gm]').value;
      await api(`/api/games/${encodeURIComponent(li.dataset.room)}/members`, { name: who, role: 'gm' });
      toast(`${who} is GM of ${li.dataset.room}`);
      loadGames();
    } else return;
    renderAdmin();
  } catch (err) { $('#admin-error').textContent = err.message; }
});
$('#add-user').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/users', { name: f.name.value, password: f.password.value, admin: f.admin.checked });
    toast(`${f.name.value} can log in now`);
    f.reset();
    renderAdmin();
  } catch (err) { $('#admin-error').textContent = err.message; }
};

start();
