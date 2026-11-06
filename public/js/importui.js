// Library → Import: bring a Roll20 campaign in. The GM saves a file from the
// little extension in tools/roll20-export, drops it here, and the server fetches
// the pictures and builds the scenes, sheets and notes (see importer.js).
import { $, store, toast, call } from './util.js';
import { RULESET_INFO } from '/rules/references.js';
import { serverUrl } from './net.js';

let socket;

const setStatus = (html) => { const el = $('#import-status'); if (el) el.innerHTML = html; };

export function initImport(s) {
  socket = s;
  const input = $('#import-file');
  if (!input) return;
  input.onchange = () => { send(input.files[0]); input.value = ''; };

  const addon = $('#import-addon');
  if (addon) addon.href = serverUrl('/api/import/extension.zip');

  const drop = $('.lib-sec[data-sec="import"]');
  for (const ev of ['dragover', 'drop']) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.toggle('dragging', ev === 'dragover');
      if (ev === 'drop') send(e.dataTransfer.files[0]);
    });
  }
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));

  socket.on('import:progress', (p) => {
    if (p.stage === 'images') {
      setStatus(p.total
        ? `Fetching pictures from Roll20 — ${p.done} of ${p.total}…`
        : 'No pictures to fetch…');
    } else setStatus('Building scenes, sheets and notes…');
  });
  socket.on('import:error', (p) => {
    setStatus(`<span class="bad">Import failed: ${p.message}</span>`);
    toast(`Import failed: ${p.message}`, true);
  });
  socket.on('import:done', ({ report, warnings }) => {
    const bits = [
      `${report.scenes} map${report.scenes === 1 ? '' : 's'}`,
      `${report.tokens} token${report.tokens === 1 ? '' : 's'}`,
      `${report.walls} wall segment${report.walls === 1 ? '' : 's'}`,
      `${report.sheets} character${report.sheets === 1 ? '' : 's'}`,
      `${report.notes} handout${report.notes === 1 ? '' : 's'}`,
    ];
    setStatus(`<b>${esc(report.campaign)}</b> imported: ${bits.join(', ')}.`
      + (warnings?.length ? `<ul class="import-warn">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '')
      + `<div class="muted small">The maps are in the scene bar, the characters under Sheets, the handouts in Notes (folder “Roll20”). Nothing is shared with players until you share it.</div>`);
    toast('Campaign imported');
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function send(file) {
  if (!file) return;
  if (!store.isGM) return toast('Only the GM can import a campaign', true);
  if (!/\.json$/i.test(file.name)) return toast('Choose the .lantern.json file the Roll20 extension saved', true);
  // characters are built for the campaign's game, so settle that first
  if (!store.settings?.ruleset) return askGame(file);
  upload(file);
}

function askGame(file) {
  setStatus(`<b>Which game is this campaign?</b><div class="muted small">The characters are made into sheets for it. You can change it later in the Scene tab.</div>
    <div class="import-games">${Object.entries(RULESET_INFO).map(([k, v]) => `<button class="btn ghost" data-rs="${k}">${esc(v.name)}</button>`).join('')}</div>`);
  $('#import-status').querySelectorAll('[data-rs]').forEach((b) => (b.onclick = () => {
    call(socket, 'settings:update', { ruleset: b.dataset.rs }).then(() => upload(file), (e) => toast(e.message, true));
  }));
}

function upload(file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', serverUrl('/api/import'));
  xhr.setRequestHeader('x-upload-token', store.uploadToken);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) setStatus(`Sending the file… ${Math.round((e.loaded / e.total) * 100)}%`);
  };
  xhr.onload = () => {
    let j = {};
    try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
    if (xhr.status !== 200) {
      setStatus(`<span class="bad">${esc(j.error || `Import failed (${xhr.status})`)}</span>`);
      return;
    }
    setStatus(`Reading ${j.pages} maps, ${j.characters} characters and ${j.handouts} handouts…`);
  };
  xhr.onerror = () => setStatus('<span class="bad">Import failed — connection lost</span>');
  setStatus('Sending the file…');
  xhr.send(fd);
}
