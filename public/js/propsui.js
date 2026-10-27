// Props in the table: Library → Props lists the GM's interactive screens (e.g. the Thaw set). The GM can open
// any page, show it to everyone or to chosen players (it pops up for them and stays in chat), upload new props
// as a .zip or .html files, and wipe a prop's saved state. Pages run sealed off from Lantern; see props.js.
import { $, esc, store, call, toast, openWindow } from './util.js';
import { serverUrl } from './net.js';

let socket;
const err = (e) => toast(e.message, true);
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
const propUrl = (coll, file) => serverUrl(`/p/${store.propKey}/${encodeURIComponent(coll)}/${file.split('/').map(encodeURIComponent).join('/')}`);

export function initProps(s) {
  socket = s;
  store.props = [];
  socket.on('props', (list) => { store.props = list; render(); });
  // shown to me: open it straight away (like a handout)
  socket.on('chat', (m) => { if (m.kind === 'prop' && m.from !== store.me) openProp(m.coll, m.file, m.title); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-prop-open]');
    if (b) openProp(b.dataset.coll, b.dataset.file, b.dataset.title);
  });
  $('#prop-file').onchange = (e) => { upload([...e.target.files]); e.target.value = ''; };
}

export function renderPropCard(m) {
  return `<button class="propcard" data-prop-open data-coll="${esc(m.coll)}" data-file="${esc(m.file)}" data-title="${esc(m.title)}">
    <span class="muted small">${m.to?.length ? `Showed ${esc(m.to.join(', '))}` : 'Shared'} a screen</span><b>📟 ${esc(m.title)}</b><span class="open">Open</span></button>`;
}

export function openProp(coll, file, title) {
  const key = `prop:${coll}/${file}`;
  const w = openWindow(key, { title: title || file, width: Math.min(1000, innerWidth - 40), height: Math.min(720, innerHeight - 60) });
  if (w.existed) return;
  w.el.classList.add('propwin');
  const src = propUrl(coll, file);
  w.body.innerHTML = `
    <div class="propbar">
      <span class="muted small">${esc(file)}</span><span class="grow"></span>
      <button class="b" data-a="reload" title="Reload this screen">⟳</button>
      <button class="b" data-a="tab" title="Open in its own browser tab (handy on a second screen or a phone)">Pop out ↗</button>
    </div>
    <iframe class="propframe" sandbox="${SANDBOX}" allow="autoplay; clipboard-write; fullscreen" src="${esc(src)}" title="${esc(title || file)}"></iframe>`;
  const frame = w.body.querySelector('iframe');
  w.body.querySelector('[data-a=reload]').onclick = () => { frame.src = src; };
  w.body.querySelector('[data-a=tab]').onclick = () => window.open(src, '_blank', 'noopener');
}

function players() {
  return [...new Set((store.users || []).filter((u) => !u.isGM).map((u) => u.name))];
}

function render() {
  const box = $('#props-list');
  if (!box) return;
  const list = store.props || [];
  if (!list.length) {
    box.innerHTML = `<p class="muted small">${store.isGM ? 'No props yet. Upload a .zip of HTML pages, or single .html files.' : 'The GM hasn\'t shared any screens with you yet.'}</p>`;
    return;
  }
  box.innerHTML = list.map((c) => `
    <div class="propcoll" data-coll="${esc(c.id)}">
      <div class="head">
        <b>${esc(c.title)}</b>${c.builtin ? '<span class="tag">built in</span>' : ''}
        ${store.isGM ? `<span class="muted small share">${c.share === 'all' ? 'shared with everyone' : Array.isArray(c.share) ? `shared with ${esc(c.share.join(', '))}` : 'not shared yet'}</span>` : ''}
        ${store.isGM ? `<span class="acts">
          ${c.share && c.share !== 'none' ? '<button class="linkish" data-a="unshare" title="Players lose access (they keep what they saw)">Unshare</button>' : ''}
          <button class="linkish" data-a="reset" title="Forget everything this prop has saved: purses, edits, progress">Reset</button>
          ${c.builtin ? '' : '<button class="linkish danger" data-a="delete">Delete</button>'}
        </span>` : ''}
      </div>
      <ul>${c.pages.map((p) => `
        <li data-file="${esc(p.file)}">
          <button class="t" data-prop-open data-coll="${esc(c.id)}" data-file="${esc(p.file)}" data-title="${esc(p.title)}" title="Open">${esc(p.title)}</button>
          ${store.isGM ? '<button class="btn small-btn show" title="Show this screen to players">Show…</button>' : ''}
        </li>`).join('')}</ul>
    </div>`).join('');
  if (!store.isGM) return;
  for (const div of box.querySelectorAll('.propcoll')) {
    const coll = div.dataset.coll;
    const c = list.find((x) => x.id === coll);
    div.querySelector('[data-a=unshare]')?.addEventListener('click', () => call(socket, 'prop:unshare', { coll }).catch(err));
    div.querySelector('[data-a=reset]').onclick = () => {
      if (confirm(`Reset "${c.title}"? Everything it has saved (money, edits, progress) goes back to the start for everyone.`)) call(socket, 'prop:reset', { coll }).then(() => toast('Reset'), err);
    };
    div.querySelector('[data-a=delete]')?.addEventListener('click', () => {
      if (confirm(`Delete the prop "${c.title}" from this server?`)) call(socket, 'prop:delete', { coll }).catch(err);
    });
    for (const li of div.querySelectorAll('li')) li.querySelector('.show').onclick = (e) => showMenu(e.target, c, li.dataset.file);
  }
}

/** "Show…": everyone, or tick players. */
function showMenu(anchor, c, file) {
  document.querySelector('.showmenu')?.remove();
  const page = c.pages.find((p) => p.file === file);
  const m = document.createElement('div');
  m.className = 'showmenu';
  const ps = players();
  m.innerHTML = `<b>Show “${esc(page?.title || file)}” to</b>
    <button class="btn primary" data-to="all">Everyone</button>
    ${ps.length ? `<div class="who">${ps.map((p) => `<label class="check"><input type="checkbox" value="${esc(p)}"> ${esc(p)}</label>`).join('')}</div>
    <button class="btn" data-to="some">Just them</button>` : '<span class="muted small">No players connected right now.</span>'}`;
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  Object.assign(m.style, { top: `${Math.min(innerHeight - m.offsetHeight - 10, r.bottom + 4)}px`, left: `${Math.max(8, r.right - m.offsetWidth)}px` });
  const close = (ev) => { if (!ev || !m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', close, true); } };
  setTimeout(() => addEventListener('pointerdown', close, true), 0);
  m.addEventListener('click', (ev) => {
    const to = ev.target.closest('[data-to]')?.dataset.to;
    if (!to) return;
    const names = to === 'all' ? [] : [...m.querySelectorAll('input:checked')].map((x) => x.value);
    if (to === 'some' && !names.length) return toast('Tick who should see it', true);
    call(socket, 'prop:show', { coll: c.id, file, to: names }).then(() => toast(names.length ? `Shown to ${names.join(', ')}` : 'Shown to everyone'), err);
    close();
  });
}

function upload(files) {
  if (!files.length) return;
  const status = $('#prop-status');
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', serverUrl('/api/props'));
  xhr.setRequestHeader('x-upload-token', store.uploadToken);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) status.textContent = `Uploading… ${Math.round((e.loaded / e.total) * 100)}%`; };
  xhr.onload = () => {
    status.textContent = '';
    let j = {};
    try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
    if (xhr.status !== 200) return toast(j.error || `Upload failed (${xhr.status})`, true);
    toast('Prop added. Open it here, then Show… it to players.');
  };
  xhr.onerror = () => { status.textContent = ''; toast('Upload failed — connection lost', true); };
  xhr.send(fd);
}
