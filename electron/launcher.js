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

function showLan(lan) {
  const port = $('port').value || 3000;
  $('portEcho').textContent = port;
  $('lan').innerHTML = '';
  if (!lan.length) { $('lan').textContent = 'no network found'; return; }
  for (const ip of lan) {
    const s = document.createElement('span');
    s.className = 'addr';
    s.textContent = `${ip}:${port}`;
    $('lan').append(s);
  }
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

$('showPw').onclick = () => { const i = $('gmPassword'); i.type = i.type === 'password' ? 'text' : 'password'; };
$('room').addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '-'); });

$('hostBtn').onclick = () => busy($('hostBtn'), async () => {
  $('hostBtn').textContent = 'Starting…';
  await api.host({ name: $('name').value, room: $('room').value, port: $('port').value, gmPassword: $('gmPassword').value, ruleset: $('ruleset').value });
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
