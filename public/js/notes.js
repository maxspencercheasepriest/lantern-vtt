// Story notes: the GM's adventure prep (shared with players when you choose) and players' own notes.
import { $, esc, store, call, toast, debounce, openWindow, getWindow } from './util.js';
import { renderMarkdown, plainText } from './markdown.js';

let socket;
export let notes = [];
const open = new Map(); // id -> { mode, dirty }

export function initNotes(s) {
  socket = s;
  socket.on('notes', (list) => {
    notes = list;
    store.notes = list;
    store.emit('notes', list);
    renderNotesList();
    for (const n of notes) refreshWindow(n.id);
    for (const [id] of open) if (!notes.find((n) => n.id === id)) getWindow(`note:${id}`)?.close();
  });
}

const isMine = (n) => (n.owner === '' ? store.isGM : n.owner === store.me);
const shareText = (s) => (s === 'all' ? 'Shared with everyone' : Array.isArray(s) ? `Shared with ${s.join(', ')}` : 'Private');

export function renderNotesList() {
  const box = $('#notes-list');
  if (!box) return;
  const visible = [...notes].sort((a, b) => (a.folder || '').localeCompare(b.folder || '') || a.title.localeCompare(b.title));
  if (!visible.length) {
    box.innerHTML = `<p class="muted small">${store.isGM ? 'Keep your adventure here: scenes, NPCs, clues, read-aloud text. Notes stay private until you share them.' : 'Your own notes, and anything the GM shares, appear here.'}</p>`;
    return;
  }
  const groups = new Map();
  for (const n of visible) {
    const g = n.owner === '' ? (n.folder || (store.isGM ? 'Notes' : 'From the GM')) : n.owner === store.me ? `My notes${n.folder ? ` · ${n.folder}` : ''}` : `${n.owner}'s notes`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(n);
  }
  box.innerHTML = [...groups].map(([g, list]) => `<h3>${esc(g)}</h3><ul class="note-list">${list.map((n) => `
    <li><button data-id="${n.id}"><span class="t">${esc(n.title)}</span>
      <span class="m">${isMine(n) ? `<span class="${n.share === 'none' ? '' : 'on'}">${esc(shareText(n.share))}</span>` : ''}</span></button></li>`).join('')}</ul>`).join('');
  box.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => openNote(b.dataset.id)));
}

export async function newNote() {
  try {
    const { id } = await call(socket, 'notes:create', { title: 'New note', body: '' });
    setTimeout(() => openNote(id, 'edit'), 150);
  } catch (e) { toast(e.message, true); }
}

export function openNoteByTitle(title) {
  const t = title.toLowerCase();
  const n = notes.find((x) => x.title.toLowerCase() === t) || notes.find((x) => x.title.toLowerCase().startsWith(t));
  if (!n) return toast(`No note called "${title}"${store.isGM ? '' : ' has been shared with you'}`, true);
  openNote(n.id);
}

export function openNote(id, mode = 'read') {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  const w = openWindow(`note:${id}`, { title: n.title, width: 560, height: 620, onClose: () => { open.get(id)?.save?.flush?.(); open.delete(id); } });
  if (!open.has(id)) open.set(id, { mode });
  else if (mode === 'edit') open.get(id).mode = 'edit';
  draw(id);
  return w;
}

function refreshWindow(id) {
  const st = open.get(id);
  if (!st) return;
  if (st.mode === 'edit' && st.dirty) return; // don't clobber typing
  draw(id);
}

function draw(id) {
  const w = getWindow(`note:${id}`);
  const n = notes.find((x) => x.id === id);
  const st = open.get(id);
  if (!w || !n || !st) return;
  const mine = isMine(n);
  w.setTitle(n.title);
  if (st.mode === 'edit' && mine) {
    if (w.body.querySelector('.note-edit')) return; // already editing
    w.body.innerHTML = `
      <div class="note-edit">
        <div class="row"><input class="n-title" value="${esc(n.title)}" maxlength="120" placeholder="Title"><input class="n-folder" value="${esc(n.folder || '')}" maxlength="60" placeholder="Folder" list="note-folders"></div>
        <datalist id="note-folders">${[...new Set(notes.map((x) => x.folder).filter(Boolean))].map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
        <textarea class="n-body" spellcheck="true" placeholder="Write here. # Heading, **bold**, > read-aloud text, - lists, | tables |, [[Other note]], [[pdf:Book title#12]], [[monster:Goblin]]">${esc(n.body)}</textarea>
        <div class="row"><button class="btn primary" data-a="done">Done</button><span class="muted small saved"></span><span style="flex:1"></span><button class="btn ghost danger" data-a="delete">Delete</button></div>
      </div>`;
    const q = (s) => w.body.querySelector(s);
    const save = debounce(async () => {
      st.dirty = false;
      try { await call(socket, 'notes:update', { id, title: q('.n-title').value, folder: q('.n-folder').value, body: q('.n-body').value }); q('.saved').textContent = 'Saved'; } catch (e) { toast(e.message, true); }
    }, 600);
    st.save = save;
    for (const el of [q('.n-title'), q('.n-folder'), q('.n-body')]) el.addEventListener('input', () => { st.dirty = true; q('.saved').textContent = 'Editing…'; save(); });
    q('[data-a=done]').onclick = () => { save.flush(); st.mode = 'read'; setTimeout(() => draw(id), 200); };
    q('[data-a=delete]').onclick = async () => {
      if (!confirm(`Delete "${n.title}"?`)) return;
      try { await call(socket, 'notes:delete', { id }); w.close(); } catch (e) { toast(e.message, true); }
    };
    q('.n-body').focus();
    return;
  }
  w.body.innerHTML = `
    <div class="note-read">
      <div class="row note-tools">
        ${n.folder ? `<span class="muted small">${esc(n.folder)}</span>` : ''}<span style="flex:1"></span>
        ${mine ? `<span class="muted small">${esc(shareText(n.share))}</span><button class="btn" data-a="share">Share…</button>` : `<span class="muted small">by ${esc(n.owner || 'the GM')}</span>`}
        ${mine && store.isGM && n.share !== 'all' ? '<button class="btn" data-a="reveal" title="Share with everyone and post it in chat">Reveal to players</button>' : ''}
        ${mine ? '<button class="btn primary" data-a="edit">Edit</button>' : ''}
      </div>
      <div class="md">${renderMarkdown(n.body) || '<p class="muted">Empty note.</p>'}</div>
    </div>`;
  const q = (s) => w.body.querySelector(s);
  if (q('[data-a=edit]')) q('[data-a=edit]').onclick = () => { st.mode = 'edit'; draw(id); };
  if (q('[data-a=reveal]')) q('[data-a=reveal]').onclick = () => call(socket, 'notes:reveal', { id }).then(() => toast('Shared with everyone'), (e) => toast(e.message, true));
  if (q('[data-a=share]')) q('[data-a=share]').onclick = () => shareDialog(n);
}

function shareDialog(n) {
  const w = openWindow(`noteshare:${n.id}`, { title: `Share “${n.title}”`, width: 340, height: 360 });
  const known = [...new Set([...store.users.map((u) => u.name), ...store.sheets.map((s) => s.owner).filter(Boolean), ...(Array.isArray(n.share) ? n.share : [])])].filter((x) => x !== store.me).sort();
  const mode = n.share === 'all' ? 'all' : Array.isArray(n.share) ? 'some' : 'none';
  w.body.innerHTML = `<div class="dialog pdfset">
    <label class="check"><input type="radio" name="m" value="none" ${mode === 'none' ? 'checked' : ''}> Private</label>
    <label class="check"><input type="radio" name="m" value="all" ${mode === 'all' ? 'checked' : ''}> Everyone</label>
    <label class="check"><input type="radio" name="m" value="some" ${mode === 'some' ? 'checked' : ''}> These people:</label>
    <div class="players">${known.map((k) => `<label class="check"><input type="checkbox" name="p" value="${esc(k)}" ${Array.isArray(n.share) && n.share.includes(k) ? 'checked' : ''}> ${esc(k)}</label>`).join('') || '<span class="muted small">Nobody else has joined yet.</span>'}</div>
    <button class="btn primary" data-a="save">Save</button></div>`;
  w.body.querySelectorAll('[name=p]').forEach((c) => (c.onchange = () => { w.body.querySelector('[name=m][value=some]').checked = true; }));
  w.body.querySelector('[data-a=save]').onclick = async () => {
    const m = w.body.querySelector('[name=m]:checked').value;
    const picked = [...w.body.querySelectorAll('[name=p]:checked')].map((c) => c.value);
    try { await call(socket, 'notes:update', { id: n.id, share: m === 'all' ? 'all' : m === 'some' ? picked : 'none' }); w.close(); } catch (e) { toast(e.message, true); }
  };
}

/** Client-side note search for the Library's unified search. */
export function searchNotes(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return notes.map((n) => {
    const text = plainText(n.body);
    const hay = `${n.title} ${n.folder || ''} ${text}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return null;
    const i = text.toLowerCase().indexOf(terms[0]);
    const snip = i < 0 ? text.slice(0, 140) : (i > 50 ? '…' : '') + text.slice(Math.max(0, i - 50), i + 130);
    return { id: n.id, title: n.title, snippet: snip, score: terms.filter((t) => n.title.toLowerCase().includes(t)).length };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 40);
}
