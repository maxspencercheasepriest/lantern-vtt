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
  if (st.openSignup) {
    // anyone can make an account here: offer it next to logging in
    $('#invite-tabs').hidden = false;
    const [newBtn, loginBtn] = document.querySelectorAll('#invite-tabs button');
    newBtn.textContent = 'Make an account'; loginBtn.textContent = 'Log in';
    newBtn.classList.remove('active'); loginBtn.classList.add('active');
    $('#register-form button[type=submit]').textContent = 'Make my account';
  }
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
  $('#btn-admin').hidden = !me.admin;
  await loadGames();
}

// the profile panel: who you are, since when, and how long you've played
function renderProfile(games) {
  $('#me-name').textContent = me.name;
  $('#me-avatar').textContent = (me.name[0] || '?').toUpperCase();
  $('#me-role').textContent = me.admin ? 'Admin' : `${games.filter((g) => g.role === 'gm').length ? 'GM and player' : 'Player'}`;
  $('#me-since').textContent = me.created ? longDate(me.created) : '—';
  $('#me-hours').textContent = hoursOf(me.playMs);
  $('#me-games').textContent = `${games.length} (GM of ${games.filter((g) => g.role === 'gm').length})`;
  const top = Object.entries(me.gameMs || {}).filter(([, ms]) => ms > 60e3).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('#me-recent-card').hidden = !top.length;
  $('#me-recent').innerHTML = top.map(([room, ms]) => `<li><span>${esc(games.find((g) => g.room === room)?.title || room)}</span><b>${esc(hoursOf(ms))}</b></li>`).join('');
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
  const sorted = [...data.games].map((g) => ({ ...g, gameMs: me.gameMs?.[g.room] || 0 }))
    .sort((a, b) => (upcoming(b) - upcoming(a)) || (upcoming(a) ? Date.parse(a.nextSession) - Date.parse(b.nextSession) : b.played - a.played));
  box.innerHTML = sorted.map(gameCard).join('');
  renderProfile(data.games);
  // admins: every other campaign on the server
  const others = data.others || [];
  $('#others-section').hidden = !others.length;
  $('#others').innerHTML = others.map((g) => gameCard({ ...g, other: true })).join('');
}

const hoursOf = (ms) => { const h = (ms || 0) / 3600e3; return h < 1 ? (ms > 60e3 ? `${Math.round(ms / 60e3)} minutes` : 'none yet') : `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} hour${Math.round(h) === 1 && h < 1.05 ? '' : 's'}`; };
const longDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const upcoming = (g) => g.nextSession && Date.parse(g.nextSession) > Date.now() - 3 * 3600e3;

function gameCard(g) {
  const when = upcoming(g) ? new Date(g.nextSession) : null;
  return `
    <article class="game" data-room="${esc(g.room)}">
      <a class="game-thumb" href="${g.other ? '#' : playUrl(g.room)}" title="${g.other ? '' : `Launch ${esc(g.title || g.room)}`}" ${g.other ? 'data-takeover-thumb' : ''}>
        ${g.thumb ? `<img src="/api/games/${encodeURIComponent(g.room)}/thumb?t=${Math.round(g.played)}" alt="" loading="lazy">` : '<span class="flame big"></span>'}
        ${g.online ? `<span class="live">${g.online} at the table</span>` : ''}
        ${g.other ? '' : `<span class="badge corner ${g.role}">${g.role === 'gm' ? 'GM' : 'Player'}</span>`}
      </a>
      <div class="game-body">
        <h2 class="game-name">${esc(g.title || g.room)}</h2>
        <p class="muted small">${esc(rulesetName(g.ruleset))}${g.sessions ? ` · played ${ago(g.played)}` : ' · not played yet'}</p>
        <p class="next"><span class="muted small">Next game</span><br>${when ? `<b>${esc(when.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</b>` : 'Not scheduled'}</p>
        ${g.characters?.length ? `<div class="chars">${g.characters.map((c) => `<span class="char">${esc(c.name)}</span>`).join('')}</div>` : ''}
        ${g.gameMs >= 60e3 ? `<p class="muted small">You've played ${esc(hoursOf(g.gameMs))}</p>` : ''}
        <div class="game-actions">
          ${g.other
            ? `<button class="btn primary" data-takeover="${esc(g.room)}">Run as GM</button><span class="muted small">${g.gms?.length ? `GM: ${esc(g.gms.join(', '))}` : 'No GM yet'}</span>`
            : `<a class="launch" href="${playUrl(g.room)}">Launch game</a>
          ${g.role === 'gm' || me.admin ? `<button class="btn ghost small-btn" data-manage="${esc(g.room)}" title="Players and invite links">Players &amp; invites</button>` : ''}`}
        </div>
      </div>
    </article>`;
}

$('#games').addEventListener('click', (e) => {
  const b = e.target.closest('[data-manage]');
  if (b) openGame(b.dataset.manage);
});
$('#others').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-takeover]');
  if (!b) return;
  try { await api('/api/games', { room: b.dataset.takeover }); toast("You're a GM of it now"); loadGames(); } catch (er) { toast(er.message, true); }
});
// the game systems, for a new game
for (const [id, info] of Object.entries(RULESET_INFO)) $('#new-game select').insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(info.name)}</option>`);

$('#btn-new-game').onclick = () => { $('#new-error').textContent = ''; $('#dlg-new').showModal(); $('#new-game').title.focus(); };
$('#btn-join-game').onclick = () => { $('#join-error').textContent = ''; $('#dlg-join').showModal(); $('#join-game').invite.focus(); };
$('#new-game').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/api/games', { title: f.title.value.trim(), ruleset: f.ruleset.value });
    location.href = playUrl(r.room);
  } catch (err) { $('#new-error').textContent = err.message; }
};
// an invite link (…/invite/CODE or ?invite=CODE), or just the code
$('#join-game').onsubmit = async (e) => {
  e.preventDefault();
  const raw = e.target.invite.value.trim();
  const code = (/invite[/=]([\w-]+)/.exec(raw) || [])[1] || raw.split(/[/?#=]/).pop();
  try {
    const r = await api('/api/auth/redeem', { invite: code });
    location.href = playUrl(r.room);
  } catch (err) { $('#join-error').textContent = err.message; }
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
$('#btn-admin').onclick = async () => { $('#admin-error').textContent = ''; await renderAdmin(); renderServer(); $('#dlg-admin').showModal(); };

// ---------- admin: the server itself (Lantern Server only): version, updates, backups ----------
let serverInfo = null;
async function renderServer(note = '') {
  const box = $('#server-info');
  try { serverInfo = await api('/api/admin/server'); } catch { $('#server-section').hidden = true; return; } // not the server edition
  $('#server-section').hidden = false;
  const s = serverInfo, c = s.lastCheck;
  const up = Math.round((Date.now() - s.started) / 3600e3);
  box.innerHTML = `
    <p>Lantern <b>${esc(s.version)}</b> on ${esc(s.platform)} · running ${up < 1 ? 'for under an hour' : up < 48 ? `${up} hours` : `${Math.round(up / 24)} days`}</p>
    ${s.tunnel ? `<div class="tunnel-box">${s.tunnel.url
      ? `<p>Temporary address: <a href="${esc(s.tunnel.url)}" target="_blank" rel="noopener"><b>${esc(s.tunnel.url)}</b></a> <button class="btn ghost small-btn" id="srv-copy">Copy</button></p>
         <p class="muted small">It changes whenever the server restarts (an update, a reboot). ${location.origin === s.tunnel.url ? 'You’re on it now, so invite links you make will use it.' : '<b>Open Lantern at that address before making invite links</b>, so the links use it.'} When you have your own domain, run Install.cmd again and paste the Cloudflare tunnel token.</p>`
      : `<p class="muted small">Getting a temporary address from Cloudflare…${s.tunnel.error ? ` (${esc(s.tunnel.error)})` : ''}</p>`}</div>` : ''}
    <p class="muted small">Campaigns are kept in <code>${esc(s.dataDir)}</code></p>
    <div class="row-btns">
      <button class="btn" id="srv-check">Check for updates</button>
      ${c?.newer && c.url ? `<button class="btn primary" id="srv-update">Update to ${esc(c.latest)}</button>` : ''}
      <button class="btn ghost" id="srv-backup">Back up now</button>
    </div>
    <p class="small" id="srv-note">${esc(note || (s.updating ? `Updating to ${s.updating.version}…` : c ? (c.newer ? (c.url ? `Version ${c.latest} is out. Updating takes about a minute: everyone at the table drops off and reconnects by themselves. Your campaigns are backed up first.` : c.message) : c.latest ? `You're up to date (the latest is ${c.latest}).` : c.message) : ''))}</p>
    <p class="muted small">Backups (one a day, the last ${s.backups.length ? s.backups.length : 'few'} kept): ${s.backups.length ? s.backups.slice(0, 5).map(esc).join(', ') + (s.backups.length > 5 ? '…' : '') : 'none yet'}. They're in <code>backups</code> inside the campaigns folder. Uploaded pictures and PDFs aren't included: copy the <code>uploads</code> and <code>library</code> folders now and then.</p>`;
  $('#srv-copy')?.addEventListener('click', () => navigator.clipboard.writeText(s.tunnel.url).then(() => toast('Copied'), () => toast(s.tunnel.url)));
  $('#srv-check').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Checking…';
    try { await api('/api/admin/server/check', {}); renderServer(); } catch (er) { renderServer(er.message); }
  };
  const upd = $('#srv-update');
  if (upd) upd.onclick = async () => {
    upd.disabled = true; upd.textContent = 'Downloading…';
    try {
      const r = await api('/api/admin/server/update', {});
      $('#srv-note').textContent = `Installing ${r.version} and restarting. This page will come back by itself.`;
      waitForServer(r.version);
    } catch (er) { renderServer(er.message); }
  };
  $('#srv-backup').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api('/api/admin/server/backup', {}); renderServer(`Backed up ${r.files} files.`); } catch (er) { renderServer(er.message); }
  };
}
// after an update: wait for the server to come back, then reload
function waitForServer(version) {
  const t0 = Date.now();
  const poll = async () => {
    try {
      const r = await fetch('/api/auth/status', { cache: 'no-store' });
      const d = await r.json();
      if (d.version === version) { toast(`Updated to ${version}`); setTimeout(() => location.reload(), 600); return; }
    } catch { /* still restarting */ }
    if (Date.now() - t0 > 5 * 60e3) { $('#srv-note').textContent = "It's taking a while. Check the server's computer: the service should restart by itself."; return; }
    setTimeout(poll, 2000);
  };
  setTimeout(poll, 3000);
}
let adminData = null;
async function renderAdmin() {
  try { adminData = await api('/api/admin/users'); } catch (e) { $('#admin-error').textContent = e.message; return; }
  const { users, campaigns } = adminData;
  $('#open-signup').checked = !!adminData.openSignup;
  $('#users').innerHTML = users.map((u) => {
    const games = Object.entries(u.games).map(([r, role]) => `${esc(r)}${role === 'gm' ? ' (GM)' : ''}`).join(', ');
    return `<li data-name="${esc(u.name)}">
      <span class="grow"><strong>${esc(u.name)}</strong>${u.admin ? ' <span class="badge gm">Admin</span>' : ''}<br><span class="muted small">${games || 'No games'}</span>
        <br><span class="muted small">Joined ${u.created ? esc(longDate(u.created)) : 'before dates were kept'} · played ${esc(hoursOf(u.playMs))}${u.lastPlayed ? ` · last ${esc(ago(u.lastPlayed))}` : ''}</span></span>
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

$('#open-signup').onchange = async (e) => {
  try { const r = await api('/api/admin/settings', { openSignup: e.target.checked }); toast(r.openSignup ? 'Anyone can make an account now' : 'New people need an invite link now'); } catch (er) { e.target.checked = !e.target.checked; toast(er.message, true); }
};

// ---------- admin: bring campaigns in from the desktop app ----------
$('#bring-file').onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('#bring-status');
  const fd = new FormData();
  fd.append('file', file);
  const xhr = new XMLHttpRequest(); // XHR, for the upload progress
  xhr.open('POST', '/api/admin/bring-in');
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) status.textContent = `Uploading… ${Math.round((ev.loaded / ev.total) * 100)}%`; };
  xhr.upload.onload = () => { status.textContent = 'Unpacking…'; };
  xhr.onload = () => {
    let d = {};
    try { d = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
    if (xhr.status !== 200) { status.textContent = d.error || `That didn't work (${xhr.status})`; return; }
    const names = d.campaigns.map((c) => (c.id === c.from ? c.id : `${c.from} → ${c.id}`));
    status.textContent = d.campaigns.length
      ? `Brought in ${d.campaigns.length} campaign${d.campaigns.length === 1 ? '' : 's'}: ${names.join(', ')}. ${d.uploads} pictures, ${d.pdfs} PDFs.`
      : "No campaigns in that zip. Zip the whole campaigns folder (it has a 'rooms' folder inside).";
    loadGames();
  };
  xhr.onerror = () => { status.textContent = 'The upload stopped. Try again.'; };
  status.textContent = 'Uploading…';
  xhr.send(fd);
};
