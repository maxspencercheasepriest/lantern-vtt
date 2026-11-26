// Library → Handouts: the GM's own picture handouts (letters, photos, clippings), grouped by chapter or place.
// Add pictures or a .zip of them; "Show" puts one in the chat for everyone, the same as a handout from the
// PDF prep. Only the GM sees this list. A zip's file names are tidied on the server (shared/picnames.js).
import { $, esc, store, call, toast, uploadImage, imageSize, uploadZip, isZip } from './util.js';
import { serverUrl } from './net.js';

let socket;
let list = [];
const open = new Set(); // groups the GM has opened
let filter = '';

export function initHandouts(s) {
  socket = s;
  const input = $('#handout-files');
  if (!input) return;
  input.onchange = () => { add([...input.files]); input.value = ''; };
  const sec = $('.lib-sec[data-sec="handouts"]');
  sec.addEventListener('dragover', (e) => { if (store.isGM && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); e.stopPropagation(); sec.classList.add('dragging'); } });
  sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('dragging'); });
  sec.addEventListener('drop', (e) => {
    sec.classList.remove('dragging');
    if (!store.isGM) return;
    e.preventDefault(); e.stopPropagation();
    add([...e.dataTransfer.files]);
  });
  $('#handout-q').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); render(); };
  socket.on('handouts', (l) => { list = l || []; render(); });
}

async function add(files) {
  files = files.filter((f) => /^image\//.test(f.type) || isZip(f));
  if (!files.length) return toast('Handouts are pictures (PNG, JPG, WebP or GIF), or a .zip of them', true);
  const status = $('#handout-status');
  const items = [];
  try {
    for (const f of files) {
      if (isZip(f)) {
        status.textContent = `Unpacking ${f.name}…`;
        const pics = await uploadZip(f);
        for (let i = 0; i < pics.length; i++) {
          status.textContent = `Reading ${i + 1} of ${pics.length}…`;
          const size = await imageSize(pics[i].url).catch(() => ({ width: 0, height: 0 }));
          items.push({ name: pics[i].name, group: pics[i].group, image: pics[i].url, ...size });
        }
      } else {
        status.textContent = `Uploading ${f.name}…`;
        const url = await uploadImage(f);
        const size = await imageSize(url).catch(() => ({ width: 0, height: 0 }));
        items.push({ name: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(), group: '', image: url, ...size });
      }
    }
    for (let i = 0; i < items.length; i += 100) await call(socket, 'handouts:add', { items: items.slice(i, i + 100) });
    toast(`${items.length} handout${items.length === 1 ? '' : 's'} added`);
    for (const it of items) open.add(it.group || '');
  } catch (e) { toast(e.message, true); }
  status.textContent = 'Pictures, or a .zip of them. Only you see this list.';
}

function render() {
  const el = $('#handouts-list');
  if (!el) return;
  $('#handout-q').hidden = list.length < 8;
  if (!list.length) { el.innerHTML = '<p class="muted small empty">No handouts yet. Add the pictures you\'ll show your players: a letter, a photo, a newspaper cutting.</p>'; return; }
  const shown = list.filter((h) => !filter || h.name.toLowerCase().includes(filter) || (h.group || '').toLowerCase().includes(filter));
  const groups = new Map();
  for (const h of shown) { const g = h.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(h); }
  const keys = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  el.innerHTML = keys.map((g) => {
    const items = groups.get(g).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const isOpen = filter || open.has(g) || keys.length === 1;
    return `<details class="ho-group" data-group="${esc(g)}" ${isOpen ? 'open' : ''}>
      <summary><b>${esc(g || 'Other handouts')}</b> <span class="muted small">${items.length}${items.some((h) => h.shown) ? ` · ${items.filter((h) => h.shown).length} shown` : ''}</span></summary>
      <ul class="ho-list">${items.map((h) => `
        <li class="ho" data-id="${h.id}">
          <img loading="lazy" src="${esc(serverUrl(h.image))}" alt="">
          <span class="ho-name" title="${esc(h.name)}">${esc(h.name)}${h.shown ? ' <span class="ho-shown" title="Already shown to the players">✓</span>' : ''}</span>
          <button class="btn" data-act="show" title="Show it to everyone: it pops up and stays in the chat">Show</button>
          <button class="iconbtn" data-act="rename" title="Rename">✎</button>
          <button class="iconbtn" data-act="delete" title="Delete (click twice)">✕</button>
        </li>`).join('')}</ul>
    </details>`;
  }).join('');
  el.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => { d.open ? open.add(d.dataset.group) : open.delete(d.dataset.group); }));
  el.querySelectorAll('.ho').forEach((li) => {
    const h = list.find((x) => x.id === li.dataset.id);
    li.querySelector('img').onclick = () => window.open(serverUrl(h.image), '_blank');
    li.querySelector('[data-act="show"]').onclick = (e) => {
      e.target.disabled = true;
      call(socket, 'handout:show', { id: h.id, image: h.image, caption: h.name, width: h.width, height: h.height })
        .then(() => toast(`Shown: ${h.name}`)).catch((er) => toast(er.message, true)).finally(() => { e.target.disabled = false; });
    };
    li.querySelector('[data-act="rename"]').onclick = () => {
      const span = li.querySelector('.ho-name');
      span.innerHTML = `<input value="${esc(h.name)}" maxlength="80">`;
      const inp = span.querySelector('input');
      inp.focus(); inp.select();
      const done = (save) => { if (save && inp.value.trim() && inp.value.trim() !== h.name) call(socket, 'handouts:update', { id: h.id, name: inp.value.trim() }).catch((er) => toast(er.message, true)); else render(); };
      inp.onkeydown = (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
    };
    const del = li.querySelector('[data-act="delete"]');
    del.onclick = () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Delete?'; del.classList.add('armed'); setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '✕'; del.classList.remove('armed'); } }, 4000); return; }
      call(socket, 'handouts:delete', { id: h.id }).catch((er) => toast(er.message, true));
    };
  });
}
