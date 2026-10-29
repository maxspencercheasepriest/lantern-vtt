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
  info.append(el('span', 'nm', titleOf(c.id)));
  const bits = [RULESETS[c.ruleset], c.scenes > 1 ? `${c.scenes} scenes` : c.scene].filter(Boolean);
  info.append(el('span', 'meta', bits.join(' · ') || 'No ruleset yet'));
  info.append(el('span', 'meta', `Played ${ago(c.played)}`));
  b.append(th, info);
  b.onclick = () => openCampaign(c.id);
  return b;
}

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
  const shown = campaigns.filter((c) => !q || c.id.includes(q.replace(/\s+/g, '-')) || (RULESETS[c.ruleset] || '').toLowerCase().includes(q));
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
