const $ = (id) => document.getElementById(id);
const api = window.launcher;
let mode = 'host';

function setMode(m) {
  mode = m;
  $('tab-host').classList.toggle('active', m === 'host');
  $('tab-join').classList.toggle('active', m === 'join');
  $('host').hidden = m !== 'host';
  $('join').hidden = m !== 'join';
  $('error').textContent = '';
}
$('tab-host').onclick = () => setMode('host');
$('tab-join').onclick = () => setMode('join');

const isTailscale = (ip) => { const m = /^100\.(\d+)\./.exec(ip); return !!m && +m[1] >= 64 && +m[1] <= 127; };
function showLan(all) {
  const port = $('port').value || 3000;
  $('portEcho').textContent = port;
  const lan = all.filter((ip) => !isTailscale(ip));
  const ts = all.filter(isTailscale);
  const fill = (el, list) => {
    el.innerHTML = '';
    for (const ip of list) {
      const s = document.createElement('span');
      s.className = 'addr';
      s.textContent = `${ip}:${port}`;
      el.append(s);
    }
  };
  fill($('lan'), lan);
  if (!lan.length) $('lan').textContent = 'no network found';
  fill($('ts'), ts);
  $('tsBox').hidden = !ts.length;
}

// On a Chromebook, Linux apps sit behind ChromeOS's own network: say what to do
// instead of showing an address nobody can reach.
function showChromeOS(cros) {
  if (!cros) return;
  const box = $('crosBox');
  box.hidden = false;
  box.innerHTML = `<b>${cros.title}</b><ol>${cros.steps.map((x) => `<li></li>`).join('')}</ol>
    <div class="muted" style="margin-top:6px"></div>`;
  box.querySelectorAll('li').forEach((li, i) => { li.textContent = cros.steps[i]; });
  box.querySelector('.muted').textContent = cros.note;
  $('lanLabel').textContent = 'Inside the Linux container this computer looks like:';
}

function godiceStatus(installed) {
  $('godiceStatus').innerHTML = installed ? '<span class="ok">Installed</span>' : '<span class="muted">Not installed</span>';
  $('godiceBtn').textContent = installed ? 'Update' : 'Download';
}

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  $('error').textContent = '';
  try { await fn(); } catch (e) { $('error').textContent = e.message; } finally { btn.disabled = false; btn.textContent = label; }
}

(async () => {
  const s = await api.state();
  const st = s.settings;
  $('name').value = st.name || '';
  $('room').value = st.room || '';
  $('port').value = st.port || 3000;
  $('gmPassword').value = st.gmPassword || '';
  $('ruleset').value = st.ruleset || '';
  $('shareOnline').checked = !!st.shareOnline;
  $('address').value = st.joinAddress || '';
  $('version').textContent = `Lantern VTT ${s.version}`;
  showLan(s.lan);
  showChromeOS(s.chromeos);
  godiceStatus(s.godice);
  for (const r of st.recent || []) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = r.replace(/^http:\/\//, '');
    b.onclick = () => { $('address').value = b.textContent; };
    $('recent').append(b);
  }
  $('port').oninput = () => showLan(s.lan);
  setMode(st.mode === 'join' ? 'join' : 'host');
  ($('name').value ? $(st.mode === 'join' ? 'address' : 'room') : $('name')).focus();
})();

// pasting a whole invite link fills in the room too
$('address').addEventListener('input', (e) => {
  const m = /[?&]room=([a-z0-9-]{1,40})/i.exec(e.target.value);
  if (m) $('room').value = m[1].toLowerCase();
});
$('showPw').onclick = () => { const i = $('gmPassword'); i.type = i.type === 'password' ? 'text' : 'password'; };
$('room').addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '-'); });

$('hostBtn').onclick = () => busy($('hostBtn'), async () => {
  $('hostBtn').textContent = 'Starting…';
  await api.host({ name: $('name').value, room: $('room').value, port: $('port').value, gmPassword: $('gmPassword').value, ruleset: $('ruleset').value, shareOnline: $('shareOnline').checked });
});
$('joinBtn').onclick = () => busy($('joinBtn'), async () => {
  $('joinBtn').textContent = 'Connecting…';
  await api.join({ name: $('name').value, room: $('room').value, address: $('address').value, gmPassword: $('joinPassword').value });
});
for (const id of ['name', 'room', 'port', 'gmPassword', 'address', 'joinPassword']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') (mode === 'host' ? $('hostBtn') : $('joinBtn')).click(); });
}

$('godiceBtn').onclick = () => busy($('godiceBtn'), async () => {
  $('godiceBtn').textContent = 'Downloading…';
  await api.downloadGoDice();
  godiceStatus(true);
});
$('godiceLicence').onclick = () => api.openExternal('https://github.com/ParticulaCode/GoDiceJavaScriptAPI/blob/main/LICENSE.md');
$('openData').onclick = () => api.openData();
$('findIp').onclick = async () => {
  $('publicIp').textContent = ' …';
  try { $('publicIp').textContent = `: ${await api.publicIp()}`; } catch (e) { $('publicIp').textContent = ' (lookup failed)'; }
};

// ---------- campaigns: a card for each, with the screen you last used ----------
const RULESETS = { dnd5e: 'D&D 5e', coc7: 'Call of Cthulhu', traveller: 'Traveller', tftl: 'Tales from the Loop', cpr: 'Cyberpunk RED', swade: 'Savage Worlds', generic: 'Generic' };
function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const d = Math.round(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const titleOf = (id) => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function campaignCard(c) {
  const b = el('button', 'camp');
  b.type = 'button';
  b.title = `Open ${c.id}`;
  if (c.id === $('room').value) b.classList.add('current');
  const th = el('div', 'thumb');
  if (c.thumb) th.style.backgroundImage = `url("${c.thumb}")`;
  else th.append(el('span', 'ph', titleOf(c.id)[0] || '?'));
  const info = el('div', 'info');
  info.append(el('span', 'nm', c.title || titleOf(c.id)));
  const bits = [RULESETS[c.ruleset], c.scenes > 1 ? `${c.scenes} scenes` : c.scene].filter(Boolean);
  info.append(el('span', 'meta', bits.join(' · ') || 'No ruleset yet'));
  const soon = c.nextSession && Date.parse(c.nextSession) > Date.now() - 3 * 3600e3;
  info.append(el('span', 'meta', soon ? `Next game ${new Date(c.nextSession).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : `Played ${ago(c.played)}`));
  b.append(th, info);
  b.onclick = () => showCampaign(c);
  return b;
}

// ---------- a campaign's page: picture, next game, description, who plays, the last write-up ----------
function showCampaign(c) {
  const box = $('cdetail');
  const body = box.querySelector('.cd-body');
  body.innerHTML = '';
  const ban = el('div', 'cd-banner');
  if (c.thumb) ban.style.backgroundImage = `url("${c.thumb}")`;
  ban.append(el('h1', 'cd-title', c.title || titleOf(c.id)));
  body.append(ban);
  const wrap = el('div', 'cd-cols');
  const main = el('div', 'cd-main'), side = el('div', 'cd-side');
  const meta = el('div', 'cd-meta');
  if (c.ruleset) meta.append(el('span', 'chip', RULESETS[c.ruleset] || c.ruleset));
  meta.append(el('span', 'muted small', [c.sessions ? `${c.sessions} session${c.sessions === 1 ? '' : 's'} played` : 'No sessions yet', `last opened ${ago(c.played)}`].join(' · ')));
  main.append(meta);
  const next = c.nextSession ? new Date(c.nextSession) : null;
  const nx = el('div', 'cd-next');
  if (next && next.getTime() > Date.now() - 3 * 3600e3) {
    const cal = el('div', 'cal');
    cal.append(el('span', 'm', next.toLocaleDateString(undefined, { month: 'short' })), el('b', null, String(next.getDate())), el('span', 'd', next.toLocaleDateString(undefined, { weekday: 'long' })));
    const when = el('div');
    when.append(el('div', 'muted small', 'Next game will be'), el('div', 'big', `${next.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`));
    nx.append(cal, when);
  } else nx.append(el('div', 'muted', 'No date set for the next game. Set one on the Campaign page once you’re in.'));
  main.append(nx);
  if (c.description) for (const para of c.description.split(/\n{2,}/).slice(0, 6)) main.append(el('p', 'cd-p', para.replace(/[*_#>`]/g, '').trim()));
  else main.append(el('p', 'muted', 'No description yet: write one on the Campaign page in the game.'));
  if (c.lastWriteup) {
    const w = el('div', 'cd-write');
    w.append(el('div', 'muted small', `Latest write-up (${c.writeups} in all)`), el('b', null, c.lastWriteup.title), el('div', 'muted small', `${c.lastWriteup.date} · by ${c.lastWriteup.by}`), el('p', 'cd-p', c.lastWriteup.text.replace(/[*_#>`]/g, '')));
    main.append(w);
  }
  side.append(el('h2', null, `${c.players.length} player${c.players.length === 1 ? '' : 's'}`));
  for (const u of c.players.slice(0, 14)) {
    const row = el('div', 'cd-player');
    const av = el('span', 'av', (u.name[0] || '?').toUpperCase());
    av.style.background = u.color || '#888';
    const who = el('span');
    who.append(el('b', null, u.name + (u.gm ? ' (GM)' : '')), el('br'), el('span', 'muted small', `${u.sessions} session${u.sessions === 1 ? '' : 's'}`));
    row.append(av, who);
    side.append(row);
  }
  if (!c.players.length) side.append(el('p', 'muted small', 'Everyone who plays shows up here.'));
  wrap.append(main, side);
  body.append(wrap);
  box.querySelector('.cd-start').onclick = () => { box.hidden = true; openCampaign(c.id); };
  box.hidden = false;
  box.querySelector('.cd-start').focus();
}
$('cdetail').addEventListener('click', (e) => { if (e.target.id === 'cdetail' || e.target.closest('.cd-close')) $('cdetail').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('cdetail').hidden = true; });

function openCampaign(id) {
  setMode('host');
  $('room').value = id;
  if (!$('name').value.trim()) { $('error').textContent = 'Pick your name first, then click the campaign again'; $('name').focus(); return; }
  $('hostBtn').click();
}

let campaigns = [];
function renderCampaigns() {
  const q = $('campFilter').value.trim().toLowerCase();
  const grid = $('cgrid');
  grid.innerHTML = '';
  const shown = campaigns.filter((c) => !q || c.id.includes(q.replace(/\s+/g, '-')) || (c.title || '').toLowerCase().includes(q) || (RULESETS[c.ruleset] || '').toLowerCase().includes(q));
  for (const c of shown) grid.append(campaignCard(c));
  if (!q) {
    const n = el('button', 'camp new');
    n.type = 'button';
    const th = el('div', 'thumb', '+');
    const info = el('div', 'info');
    info.append(el('span', 'nm', 'New campaign'), el('span', 'meta', 'Give it a name, then Start hosting'));
    n.append(th, info);
    n.onclick = () => { setMode('host'); $('room').value = ''; $('room').placeholder = 'name your new campaign'; $('room').focus(); };
    grid.append(n);
  }
  if (q && !shown.length) grid.append(el('div', 'empty', 'No campaign by that name.'));
}

(async () => {
  try { campaigns = await api.campaigns(); } catch { campaigns = []; }
  $('campaigns').hidden = false;
  $('campFilter').hidden = campaigns.length < 7;
  if (!campaigns.length) {
    $('cgrid').append(el('div', 'empty', "Campaigns you host appear here, with a picture of where you left off. Pick a name for your first one and press Start hosting."));
    return;
  }
  renderCampaigns();
})();
$('campFilter').addEventListener('input', renderCampaigns);
