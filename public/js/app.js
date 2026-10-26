import { $, $$, esc, store, toast, call, uploadImage, imageSize, debounce, openWindow } from './util.js';
import { initMap, viewCenter, requestDraw, snapToken } from './map.js';
import { initRolls, roll, renderRollCard, rollSource, setRollSource } from './rolls.js';
import { initSheets, openSheet } from './sheets.js';
import { initGoDice } from './godice.js';
import { initLibrary, renderHandoutCard } from './library.js';

const socket = io({ autoConnect: true });
let joined = null; // last successful join payload, for reconnects

// ---------- join ----------
const form = $('#join-form');
const params = new URLSearchParams(location.search);
form.room.value = params.get('room') || localStorage.getItem('lantern.room') || '';
form.name.value = localStorage.getItem('lantern.name') || '';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { room: form.room.value.trim().toLowerCase(), name: form.name.value.trim(), gmPassword: form.gmPassword.value };
  try {
    await join(payload);
  } catch (err) {
    $('#join-error').textContent = err.message;
  }
});

// Desktop app: the launcher already asked for room / name / password, so join straight away.
const desktop = window.lanternDesktop;
if (desktop?.autoJoin) {
  const a = desktop.autoJoin;
  form.room.value = a.room || form.room.value;
  form.name.value = a.name || form.name.value;
  form.gmPassword.value = a.gmPassword || '';
  if (socket.connected) form.requestSubmit();
  else socket.once('connect', () => form.requestSubmit());
}

async function join(payload) {
  const res = await call(socket, 'join', { ...payload, resumeToken: store.uploadToken || undefined });
  joined = payload;
  Object.assign(store, { me: res.name, isGM: res.isGM, color: res.color, uploadToken: res.uploadToken, room: payload.room });
  localStorage.setItem('lantern.room', payload.room);
  localStorage.setItem('lantern.name', payload.name);
  const url = new URL(location.href);
  url.searchParams.set('room', payload.room);
  history.replaceState(null, '', url);
  document.body.classList.toggle('is-gm', res.isGM);
  $('#room-name').textContent = payload.room;
  document.title = `${payload.room} — Lantern`;
  $('#join').hidden = true;
  $('#app').hidden = false;
  requestDraw();
}

socket.on('connect', () => {
  if (joined) join(joined).catch((e) => toast(`Rejoin failed: ${e.message}`, true));
});
socket.on('disconnect', () => joined && toast('Connection lost — reconnecting…', true));

// ---------- server events ----------
socket.on('scene', (scene) => { store.scene = scene; store.emit('scene', scene); syncSceneForm(); });
socket.on('sheets', (sheets) => { store.sheets = sheets; store.emit('sheets', sheets); });
socket.on('presence', (users) => { store.users = users; renderPresence(); renderOwnerSelect(); });
socket.on('ping', (p) => store.emit('ping', p));
socket.on('chat:history', (msgs) => { store.chat = msgs; $('#chat-log').innerHTML = ''; msgs.forEach(addMessage); scrollChat(true); });
socket.on('chat', (m) => { store.chat.push(m); addMessage(m); scrollChat(); });

// ---------- tabs ----------
$$('.tabs [data-tab]').forEach((b) => (b.onclick = () => {
  $$('.tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
  if (b.dataset.tab === 'chat') scrollChat(true);
}));

function renderPresence() {
  $('#presence').innerHTML = store.users
    .filter((u, i, a) => a.findIndex((x) => x.name === u.name) === i)
    .map((u) => `<span class="${u.isGM ? 'gm' : ''}" style="color:${esc(u.color)}" title="${u.isGM ? 'GM' : 'Player'}">${esc(u.name)}</span>`).join('');
}

// ---------- chat ----------
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function addMessage(m) {
  const li = document.createElement('li');
  li.className = `msg ${m.visibility === 'whisper' ? 'whisper' : ''}`;
  const tags = [
    m.isGM ? '<span class="tag gm">GM</span>' : '',
    m.visibility === 'gm' ? '<span class="tag gm">to GM</span>' : '',
    m.visibility === 'whisper' ? `<span class="tag">to ${esc((m.to || []).join(', '))}</span>` : '',
  ].join('');
  const body = m.kind === 'roll' ? renderRollCard(m) : m.kind === 'handout' ? renderHandoutCard(m) : `<div class="body">${esc(m.text)}</div>`;
  li.innerHTML = `<div class="who"><span style="color:${esc(m.color || '#ccc')}">${esc(m.from)}</span>${tags}<time>${fmtTime(m.ts)}</time></div>${body}`;
  $('#chat-log').append(li);
}
let chatPinned = true; // follow new messages unless the reader has scrolled up
$('#chat-log').addEventListener('scroll', (e) => {
  const log = e.target;
  if (log.clientHeight) chatPinned = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
});
function scrollChat(force) {
  const log = $('#chat-log');
  const near = chatPinned;
  if (force || near) log.scrollTop = log.scrollHeight;
}

const chatInput = $('#chat-input');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
const gmOnly = $('#gm-only-rolls');
gmOnly.checked = localStorage.getItem('lantern.gmRolls') === '1';
gmOnly.onchange = () => localStorage.setItem('lantern.gmRolls', gmOnly.checked ? '1' : '0');

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  let m;
  if ((m = /^\/(r|roll|gr|gmroll)\s+(.+)$/i.exec(text))) {
    // "/r 2d6+1 Pilot check" — anything after the expression becomes the label
    const [, cmd, rest] = m;
    const [, ex, label] = /^(\S+)\s*(.*)$/.exec(rest);
    await roll(ex, { label: label || undefined, visibility: /^g/i.test(cmd) ? 'gm' : undefined });
  } else if ((m = /^\/w\s+(\S+)\s+([\s\S]+)$/i.exec(text))) {
    const target = store.users.find((u) => u.name.toLowerCase() === m[1].toLowerCase())?.name || m[1];
    call(socket, 'chat:send', { text: m[2], to: [target] }).catch((e) => toast(e.message, true));
  } else if (text.startsWith('/')) {
    toast('Commands: /r 2d6+1 [label] · /gr (roll to GM) · /w Name message', true);
    chatInput.value = text;
  } else {
    call(socket, 'chat:send', { text }).catch((e) => toast(e.message, true));
  }
}

// ---------- dice panel ----------
function syncSource() {
  $$('#dice-source button').forEach((b) => b.classList.toggle('active', b.dataset.source === rollSource.value));
  $('#dice-source-note').textContent = rollSource.value === 'godice'
    ? 'Checks wait for your connected GoDice. You can type values or finish digitally from the tray.'
    : 'Rolls are made on the server with secure randomness.';
}
$$('#dice-source button').forEach((b) => (b.onclick = () => { setRollSource(b.dataset.source); syncSource(); }));
syncSource();

const quickExpr = $('#quick-expr');
$$('#quick-dice button').forEach((b) => (b.onclick = () => {
  // clicking d6 three times builds "3d6"; mixing dice builds "2d6+1d8"
  const d = b.dataset.d;
  const parts = quickExpr.value.split('+').filter(Boolean);
  const idx = parts.findIndex((p) => new RegExp(`^\\d*d${d}$`).test(p));
  if (idx >= 0) parts[idx] = `${(parseInt(parts[idx], 10) || 1) + 1}d${d}`;
  else parts.push(`1d${d}`);
  quickExpr.value = parts.join('+');
}));
$('#quick-roll').onclick = () => quickExpr.value.trim() && roll(quickExpr.value.trim());
quickExpr.onkeydown = (e) => { if (e.key === 'Enter') $('#quick-roll').click(); };
$('#quick-clear').onclick = () => { quickExpr.value = ''; };

// ---------- scene panel (GM) ----------
const mapUpdate = (patch) => call(socket, 'map:update', patch).catch((e) => toast(e.message, true));
$('#map-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    toast('Uploading map…');
    const url = await uploadImage(file);
    const { width, height } = await imageSize(url);
    await mapUpdate({ image: url, width, height });
    toast('Map set. Line the grid up with Grid px and offsets.');
    setTimeout(() => $('#zoom-fit').click(), 200);
  } catch (err) { toast(err.message, true); }
};
$('#map-clear').onclick = () => confirm('Remove the map image?') && mapUpdate({ image: null, width: 2800, height: 2100 });

const gridFields = {
  'grid-size': ['gridSize', Number], 'grid-ox': ['offsetX', Number], 'grid-oy': ['offsetY', Number],
  'grid-color': ['gridColor', String], 'grid-opacity': ['gridOpacity', Number], 'grid-show': ['showGrid', null],
  'grid-units': ['unitsPerSquare', Number], 'grid-unit': ['unitName', String],
};
const pushGrid = debounce((patch) => mapUpdate(patch), 150);
for (const [id, [key, cast]] of Object.entries(gridFields)) {
  $(`#${id}`).addEventListener('input', (e) => {
    const v = cast ? cast(e.target.value) : e.target.checked;
    store.scene.map[key] = v; // preview locally straight away
    requestDraw();
    pushGrid({ [key]: v });
  });
}
function syncSceneForm() {
  if (!store.isGM || !store.scene) return;
  const m = store.scene.map;
  for (const [id, [key]] of Object.entries(gridFields)) {
    const el = $(`#${id}`);
    if (el === document.activeElement) continue;
    if (el.type === 'checkbox') el.checked = !!m[key]; else el.value = m[key];
  }
  $('#fog-enabled').checked = store.scene.fog.enabled;
}
$('#fog-enabled').onchange = (e) => call(socket, 'fog:set', { enabled: e.target.checked }).catch((er) => toast(er.message, true));
$('#fog-hide-all').onclick = () => confirm('Cover the whole map in fog?') && call(socket, 'fog:set', { reset: 'hide-all', enabled: true });
$('#fog-reveal-all').onclick = () => call(socket, 'fog:set', { reset: 'reveal-all' });
$('#chat-clear').onclick = () => confirm('Clear the chat log for everyone?') && call(socket, 'chat:clear', {});

function renderOwnerSelect() {
  const sel = $('#tok-owner');
  const cur = sel.value;
  const players = [...new Set(store.users.filter((u) => !u.isGM).map((u) => u.name))];
  sel.innerHTML = `<option value="">GM only</option><option value="*">Everyone</option>${players.map((p) => `<option>${esc(p)}</option>`).join('')}`;
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
}

let tokenImage = null;
$('#tok-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    tokenImage = await uploadImage(file);
    $('#tok-file-name').textContent = `Image: ${file.name}`;
  } catch (err) { toast(err.message, true); }
};
$('#tok-add').onclick = async () => {
  const size = Number($('#tok-size').value) || 1;
  const c = viewCenter();
  const g = store.scene.map.gridSize;
  const t = { size };
  const pos = snapToken(t, c.x - (size * g) / 2, c.y - (size * g) / 2);
  const owner = $('#tok-owner').value;
  try {
    await call(socket, 'token:add', {
      ...pos, size, label: $('#tok-label').value.trim(), color: $('#tok-color').value,
      owners: owner ? [owner] : [], hidden: $('#tok-hidden').checked, image: tokenImage,
    });
    tokenImage = null;
    $('#tok-file-name').textContent = '';
    $('#tok-label').value = '';
  } catch (err) { toast(err.message, true); }
};

// ---------- token dialog ----------
function openTokenDialog(t) {
  if (!store.isGM) {
    if (t.sheetId && store.sheets.some((s) => s.id === t.sheetId)) openSheet(t.sheetId);
    return;
  }
  const w = openWindow(`token:${t.id}`, { title: `Token — ${t.label || 'unnamed'}`, width: 360, height: 470 });
  const players = [...new Set([...store.users.filter((u) => !u.isGM).map((u) => u.name), ...(t.owners || []).filter((o) => o !== '*')])];
  w.body.innerHTML = `
    <div class="dialog">
      <div class="grid-form">
        <label>Name <input name="label" value="${esc(t.label || '')}" maxlength="40"></label>
        <label>Colour <input type="color" name="color" value="${esc(t.color || '#c0392b')}"></label>
        <label>Size (squares) <input type="number" name="size" value="${t.size}" min="0.25" max="20" step="0.25"></label>
        <label>Sheet <select name="sheetId"><option value="">— none —</option>${store.sheets.map((s) => `<option value="${s.id}" ${s.id === t.sheetId ? 'selected' : ''}>${esc(s.data?.name || 'Unnamed')}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="hidden" ${t.hidden ? 'checked' : ''}> Hidden from players</label>
        <label class="check"><input type="checkbox" name="locked" ${t.locked ? 'checked' : ''}> Locked (only GM can move)</label>
      </div>
      <h3>Who can move it</h3>
      <div class="grid-form">
        <label class="check"><input type="checkbox" name="owner" value="*" ${(t.owners || []).includes('*') ? 'checked' : ''}> Everyone</label>
        ${players.map((p) => `<label class="check"><input type="checkbox" name="owner" value="${esc(p)}" ${(t.owners || []).includes(p) ? 'checked' : ''}> ${esc(p)}</label>`).join('')}
      </div>
      <div class="row" style="margin-top:14px">
        <label class="btn file">New image…<input type="file" name="image" accept="image/*" hidden></label>
        ${t.image ? '<button class="btn ghost" data-act="noimg">Remove image</button>' : ''}
      </div>
      <div class="row">
        <button class="btn primary" data-act="save">Save</button>
        ${t.sheetId ? '<button class="btn" data-act="sheet">Open sheet</button>' : ''}
        <button class="btn ghost" data-act="front" title="Bring to front">↑</button>
        <button class="btn ghost" data-act="back" title="Send to back">↓</button>
        <span style="flex:1"></span>
        <button class="btn ghost danger" data-act="delete">Delete</button>
      </div>
    </div>`;
  const q = (n) => w.body.querySelector(`[name="${n}"]`);
  let image;
  q('image').onchange = async (e) => {
    try { image = await uploadImage(e.target.files[0]); toast('Image ready — press Save'); } catch (er) { toast(er.message, true); }
  };
  const act = async (a) => {
    try {
      if (a === 'save') {
        const patch = {
          label: q('label').value.trim(), color: q('color').value, size: Number(q('size').value) || 1,
          sheetId: q('sheetId').value || null, hidden: q('hidden').checked, locked: q('locked').checked,
          owners: [...w.body.querySelectorAll('[name=owner]:checked')].map((x) => x.value),
        };
        if (image) patch.image = image;
        if (patch.sheetId) {
          const sheet = store.sheets.find((s) => s.id === patch.sheetId);
          if (sheet?.owner && !patch.owners.length) patch.owners = [sheet.owner]; // sensible default
        }
        await call(socket, 'token:update', { id: t.id, patch });
        w.close();
      } else if (a === 'noimg') { await call(socket, 'token:update', { id: t.id, patch: { image: null } }); w.close(); }
      else if (a === 'sheet') openSheet(t.sheetId);
      else if (a === 'front' || a === 'back') await call(socket, 'token:order', { id: t.id, to: a });
      else if (a === 'delete' && confirm('Delete this token?')) { await call(socket, 'token:remove', { id: t.id }); w.close(); }
    } catch (er) { toast(er.message, true); }
  };
  w.body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act)));
}

// ---------- boot ----------
// Desktop app: if this server doesn't have the GoDice library, use the copy the launcher downloaded.
if (desktop && (typeof GoDice === 'undefined' || window.__godiceMissing)) { // eslint-disable-line no-undef
  const src = desktop.godiceSource();
  if (src) {
    const s = document.createElement('script');
    s.textContent = src;
    document.head.append(s);
    window.__godiceMissing = false;
  }
}
initRolls(socket);
initLibrary(socket, {
  setMapFromImage: (image, width, height) => mapUpdate({ image, width, height }).then(() => setTimeout(() => $('#zoom-fit').click(), 200)),
});
initMap(socket, { onTokenOpen: openTokenDialog });
initSheets(socket);
initGoDice({
  postLooseRoll: ({ result, sources, label }) =>
    call(socket, 'roll:physical', { result, sources, label, visibility: gmOnly.checked ? 'gm' : 'all' }).catch((e) => toast(e.message, true)),
});
