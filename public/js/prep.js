// Scenario prep (GM): turn a scenario PDF into notes, and pull out its handouts and maps.
// The server works out the structure (scenario.js); this window lets the GM check it and choose what to make.
import { $, esc, store, call, toast, openWindow, uploadImage } from './util.js';
import { serverUrl } from './net.js';
import { renderMarkdown } from './markdown.js';
import { libraryDocs, librarySocket, loadDoc, renderRegion, openViewer } from './library.js';

const wins = new Map(); // docId -> state

export function openPrep(id) {
  const doc = libraryDocs().find((d) => d.id === id);
  if (!doc) return toast('That PDF is no longer in the library', true);
  const w = openWindow(`prep:${id}`, {
    title: `Prep: ${doc.title}`, width: Math.min(900, innerWidth - 40), height: innerHeight - 70,
    onClose: () => { const st = wins.get(id); st?.pdfTask?.destroy?.(); wins.delete(id); },
  });
  if (w.existed) return;
  w.el.classList.add('prepwin');
  const st = { id, doc, w, result: null, tab: 'notes', depth: 2, checked: new Set(), preview: null, pdf: null, pdfTask: null };
  wins.set(id, st);
  w.body.innerHTML = `<div class="prep-wait"><p>Reading the scenario…</p><div class="prog"><span style="width:0%"></span></div><p class="muted small">Big campaign books take a minute. You can keep playing meanwhile.</p></div>`;
  ensureListeners();
  analyse(st, false);
}

let listening = false;
function ensureListeners() {
  if (listening) return;
  listening = true;
  const socket = librarySocket();
  socket.on('scenario:progress', ({ id, done, total }) => {
    const st = wins.get(id);
    const bar = st?.w.body.querySelector('.prep-wait .prog span');
    if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    const p = st?.w.body.querySelector('.prep-wait p');
    if (p) p.textContent = `Reading the scenario… page ${done} of ${total}`;
  });
  socket.on('scenario:ready', ({ id }) => { const st = wins.get(id); if (st) fetchResult(st); });
  socket.on('scenario:error', ({ id, error }) => {
    const st = wins.get(id);
    if (st) st.w.body.innerHTML = `<p class="bad" style="padding:20px">Couldn't read this PDF: ${esc(error)}</p>`;
  });
}

async function analyse(st, force) {
  try {
    const r = await call(librarySocket(), 'library:analyse', { id: st.id, force });
    if (r.state === 'ready') fetchResult(st);
  } catch (e) {
    st.w.body.innerHTML = `<p class="bad" style="padding:20px">${esc(e.message)}</p>`;
  }
}

async function fetchResult(st) {
  try {
    const res = await fetch(serverUrl(`/api/library/${st.id}/scenario`), { headers: { 'x-upload-token': store.uploadToken } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Couldn't load the results (${res.status})`);
    st.result = await res.json();
  } catch (e) {
    st.w.body.innerHTML = `<p class="bad" style="padding:20px">${esc(e.message)}</p>`;
    return;
  }
  const r = st.result;
  const maxLevel = Math.max(1, ...r.sections.map((s) => s.level));
  st.depth = Math.min(2, maxLevel);
  st.folder = st.doc.title;
  defaultChecks(st);
  render(st);
}

/** Tick sections that will become notes: at or above the split depth, and not near-empty (unless they lead a group). */
function defaultChecks(st) {
  const s = st.result.sections;
  st.checked = new Set();
  s.forEach((sec, i) => {
    if (sec.level > st.depth) return;
    const hasKids = !!s[i + 1] && s[i + 1].level > sec.level;
    if (sec.words >= 15 || hasKids) st.checked.add(sec.id);
  });
}

// ---------- building the notes ----------
function buildNotes(st) {
  const { result: r, doc } = st;
  const existing = new Set((store.notes || []).map((n) => n.title.toLowerCase()));
  const used = new Set();
  const unique = (t, page) => {
    let title = t.slice(0, 110);
    if (existing.has(title.toLowerCase()) || used.has(title.toLowerCase())) title = `${title.slice(0, 100)} (p. ${page})`;
    let n = 2;
    while (existing.has(title.toLowerCase()) || used.has(title.toLowerCase())) title = `${t.slice(0, 100)} (${n++})`;
    used.add(title.toLowerCase());
    return title;
  };
  const notes = [];
  let current = null;   // the note that deeper sections fold into
  let skipping = false; // inside an unticked section
  for (const sec of r.sections) {
    if (sec.level <= st.depth) {
      skipping = !st.checked.has(sec.id);
      if (skipping) { current = null; continue; }
      current = {
        title: unique(sec.title, sec.page), level: sec.level, page: sec.page,
        body: `*From [[pdf:${doc.title}#${sec.page}|${doc.title}, p. ${sec.page}]]*\n\n${sec.text}`,
      };
      notes.push(current);
    } else if (current && !skipping) {
      const hashes = '#'.repeat(Math.min(3, Math.max(2, sec.level - st.depth + 1)));
      current.body += `\n\n${hashes} ${sec.title}\n\n${sec.text}`;
    }
  }
  const out = notes.map((n) => ({ title: n.title, body: n.body.trim(), folder: st.folder, share: 'none' }));
  if (st.contents !== false) {
    const lines = [`# ${doc.title}`, '', `Made from [[pdf:${doc.title}#1|the PDF]]. These notes are only visible to you until you share them.`, ''];
    if (notes.length) {
      lines.push('## Contents', '');
      for (const n of notes) lines.push(`${'  '.repeat(Math.max(0, n.level - 1))}- [[${n.title}]] *(p. ${n.page})*`);
      lines.push('');
    }
    if (r.handouts.length) {
      lines.push('## Handouts', '');
      for (const h of r.handouts) lines.push(`- [[pdf:${doc.title}#${h.page}|${h.label}]]`);
      lines.push('');
    }
    if (r.maps.length) {
      lines.push('## Maps', '');
      for (const m of r.maps) lines.push(`- [[pdf:${doc.title}#${m.page}|${m.label}]]`);
      lines.push('');
    }
    if (r.readAloud.length) {
      lines.push('## Read-aloud text', '');
      for (const ra of r.readAloud) lines.push(`> ${ra.text.slice(0, 600)} *([[pdf:${doc.title}#${ra.page}|p. ${ra.page}]])*`, '');
    }
    out.unshift({ title: unique(`${doc.title}: contents`, 1), body: lines.join('\n'), folder: st.folder, share: 'none' });
  }
  return out;
}

// ---------- rendering ----------
const METHOD = {
  bookmarks: "from the PDF's bookmarks",
  headings: 'from its headings',
  pages: "— it has no bookmarks or headings I could find, so it's one note",
};

function render(st) {
  const r = st.result;
  const { w } = st;
  const counts = { notes: r.sections.length, read: r.readAloud.length, handouts: r.handouts.length, maps: r.maps.length };
  w.body.innerHTML = `
    <div class="prep">
      <div class="prep-head">
        <p>Found <b>${counts.notes} section${counts.notes === 1 ? '' : 's'}</b> ${METHOD[r.method] || ''}, <b>${counts.read}</b> read-aloud passage${counts.read === 1 ? '' : 's'}, <b>${counts.handouts}</b> handout${counts.handouts === 1 ? '' : 's'} and <b>${counts.maps}</b> map${counts.maps === 1 ? '' : 's'} or picture${counts.maps === 1 ? '' : 's'}.
        <button class="linkish" data-a="again" title="Read the PDF again">Analyse again</button></p>
        <div class="segmented prep-tabs">
          <button data-tab="notes">Notes</button><button data-tab="read">Read-aloud (${counts.read})</button><button data-tab="handouts">Handouts (${counts.handouts})</button><button data-tab="maps">Maps (${counts.maps})</button>
        </div>
      </div>
      <div class="prep-body"></div>
    </div>`;
  w.body.querySelector('[data-a=again]').onclick = () => {
    w.body.innerHTML = '<div class="prep-wait"><p>Reading the scenario…</p><div class="prog"><span style="width:0%"></span></div></div>';
    analyse(st, true);
  };
  w.body.querySelectorAll('.prep-tabs [data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === st.tab);
    b.onclick = () => { st.tab = b.dataset.tab; render(st); };
  });
  const body = w.body.querySelector('.prep-body');
  if (st.tab === 'notes') renderNotesTab(st, body);
  if (st.tab === 'read') renderReadTab(st, body);
  if (st.tab === 'handouts') renderPictures(st, body, 'handouts');
  if (st.tab === 'maps') renderPictures(st, body, 'maps');
}

function renderNotesTab(st, body) {
  const r = st.result;
  const maxLevel = Math.max(1, ...r.sections.map((s) => s.level));
  const notesWillMake = () => buildNotes(st).length;
  body.innerHTML = `
    <div class="prep-opts">
      <label>Folder <input class="p-folder" value="${esc(st.folder)}" maxlength="60"></label>
      <label>One note per <select class="p-depth">
        ${Array.from({ length: Math.min(4, maxLevel) }, (_, i) => `<option value="${i + 1}" ${st.depth === i + 1 ? 'selected' : ''}>${['part (top level)', 'chapter (2 levels)', 'section (3 levels)', 'heading (4 levels)'][i]}</option>`).join('')}
      </select></label>
      <label class="check"><input type="checkbox" class="p-contents" ${st.contents !== false ? 'checked' : ''}> Contents note</label>
      <span class="grow"></span>
      <button class="linkish p-all">All</button><button class="linkish p-none">None</button>
    </div>
    <div class="prep-split">
      <ul class="prep-secs">${r.sections.map((s) => {
        const inside = s.level > st.depth;
        return `<li class="lv${Math.min(4, s.level)} ${inside ? 'inside' : ''} ${st.preview === s.id ? 'sel' : ''}" data-id="${s.id}">
          ${inside ? '<span class="fold" title="Goes into the note above">↳</span>' : `<input type="checkbox" ${st.checked.has(s.id) ? 'checked' : ''} aria-label="Make a note">`}
          <button class="t">${esc(s.title)}</button>
          <span class="muted small">p. ${s.page}${s.words ? ` · ${s.words} words` : ''}</span>
        </li>`;
      }).join('')}</ul>
      <div class="prep-preview md">${st.preview ? previewHtml(st) : '<p class="muted">Click a section to preview what its note will say. Indented ↳ sections go into the note above them.</p>'}</div>
    </div>
    <div class="prep-foot">
      <span class="muted small">Notes are made for you only (GM). Share any of them later from the note itself.</span>
      <button class="btn primary p-create">Create ${notesWillMake()} note${notesWillMake() === 1 ? '' : 's'}</button>
    </div>`;
  const q = (s) => body.querySelector(s);
  const refreshCount = () => { const n = notesWillMake(); q('.p-create').textContent = `Create ${n} note${n === 1 ? '' : 's'}`; };
  q('.p-folder').oninput = (e) => { st.folder = e.target.value.trim() || st.doc.title; };
  q('.p-depth').onchange = (e) => { st.depth = +e.target.value; defaultChecks(st); render(st); };
  q('.p-contents').onchange = (e) => { st.contents = e.target.checked; refreshCount(); };
  q('.p-all').onclick = () => { r.sections.forEach((s) => s.level <= st.depth && st.checked.add(s.id)); render(st); };
  q('.p-none').onclick = () => { st.checked.clear(); render(st); };
  body.querySelectorAll('.prep-secs li').forEach((li) => {
    const cb = li.querySelector('input');
    if (cb) cb.onchange = () => { if (cb.checked) st.checked.add(li.dataset.id); else st.checked.delete(li.dataset.id); refreshCount(); };
    li.querySelector('.t').onclick = () => {
      st.preview = li.dataset.id;
      body.querySelectorAll('.prep-secs li').forEach((x) => x.classList.toggle('sel', x === li));
      q('.prep-preview').innerHTML = previewHtml(st);
      q('.prep-preview').scrollTop = 0;
    };
  });
  q('.p-create').onclick = async () => {
    const list = buildNotes(st);
    if (!list.length) return toast('Tick at least one section', true);
    const b = q('.p-create');
    b.disabled = true; b.textContent = 'Creating…';
    try {
      const { ids } = await call(librarySocket(), 'notes:create-many', { notes: list });
      toast(`Made ${ids.length} note${ids.length === 1 ? '' : 's'} in the "${st.folder}" folder`);
      const notesMod = await import('./notes.js');
      setTimeout(() => notesMod.openNote(ids[0]), 300);
    } catch (e) { toast(e.message, true); }
    b.disabled = false; refreshCount();
  };
}

function previewHtml(st) {
  const r = st.result;
  const i = r.sections.findIndex((s) => s.id === st.preview);
  const sec = r.sections[i];
  if (!sec) return '';
  // show what the note will hold: this section plus any deeper ones that fold into it
  let md = `# ${sec.title}\n\n${sec.text}`;
  if (sec.level <= st.depth) {
    for (const s of r.sections.slice(i + 1)) {
      if (s.level <= st.depth) break;
      md += `\n\n${'#'.repeat(Math.min(3, Math.max(2, s.level - st.depth + 1)))} ${s.title}\n\n${s.text}`;
    }
  }
  return renderMarkdown(md.length > 60000 ? `${md.slice(0, 60000)}\n\n*(Preview cut short.)*` : md);
}

function renderReadTab(st, body) {
  const r = st.result;
  if (!r.readAloud.length) {
    body.innerHTML = '<p class="muted pad">No read-aloud text found. This looks for italic passages and paragraphs that start "Read aloud". Boxed text in a plain font isn\'t spotted yet.</p>';
    return;
  }
  body.innerHTML = `<p class="muted small pad">These are already in the notes as quotes. You can also post one straight to chat for everyone.</p>
    <ul class="prep-read">${r.readAloud.map((x) => `
      <li data-id="${x.id}">
        <blockquote>${esc(x.text)}</blockquote>
        <div class="row"><span class="muted small">p. ${x.page}</span><span class="grow"></span>
          <button class="btn small-btn" data-a="page">Open page</button>
          <button class="btn small-btn" data-a="chat">Post to chat</button></div>
      </li>`).join('')}</ul>`;
  body.querySelectorAll('.prep-read li').forEach((li) => {
    const x = r.readAloud.find((y) => y.id === li.dataset.id);
    li.querySelector('[data-a=page]').onclick = () => openViewer(st.id, x.page);
    li.querySelector('[data-a=chat]').onclick = () => call(librarySocket(), 'chat:send', { text: x.text.slice(0, 1990) }).then(() => toast('Posted to chat'), (e) => toast(e.message, true));
  });
}

async function pdfFor(st) {
  if (!st.pdf) {
    const { task, pdf } = await loadDoc(st.id);
    st.pdfTask = task; st.pdf = pdf;
  }
  return st.pdf;
}

function renderPictures(st, body, kind) {
  const list = st.result[kind];
  if (!list.length) {
    body.innerHTML = `<p class="muted pad">${kind === 'maps'
      ? 'No maps found. This looks for big pictures on pages that mention a map or plan. You can still open the PDF, use <b>Select area</b>, then <b>Use as map</b>.'
      : 'No handouts found. This looks for headings like "Handout 1" or "Player Handout", and pictures on "Papers & Clues" pages. You can still show any page from the PDF viewer.'}</p>`;
    return;
  }
  body.innerHTML = `
    <p class="muted small pad">${kind === 'maps'
      ? '<b>Make scene</b> turns a map into a new scene (it shows up in the scene bar, ready for its grid and walls).'
      : '<b>Show to players</b> pops the handout up on everyone\'s screen and keeps it in chat.'}</p>
    <ul class="prep-pics">${list.map((x) => `
      <li data-id="${x.id}">
        <div class="thumb"><span class="muted small">Loading…</span></div>
        <input class="lbl" value="${esc(x.label)}" maxlength="80" aria-label="Name">
        <div class="row"><span class="muted small">p. ${x.page}${x.confidence === 'low' ? ' · maybe' : ''}${x.kind === 'picture' ? ' · picture' : ''}${!x.rect ? ' · whole page' : ''}</span><span class="grow"></span>
          <button class="btn small-btn" data-a="page">Open page</button>
          <button class="btn small-btn primary" data-a="${kind === 'maps' ? 'scene' : 'show'}">${kind === 'maps' ? 'Make scene' : 'Show to players'}</button></div>
      </li>`).join('')}</ul>`;
  body.querySelectorAll('.prep-pics li').forEach((li) => {
    const x = list.find((y) => y.id === li.dataset.id);
    li.querySelector('.lbl').oninput = (e) => { x.label = e.target.value; };
    li.querySelector('[data-a=page]').onclick = () => openViewer(st.id, x.page);
    const btn = li.querySelector('.btn.primary');
    btn.onclick = async () => {
      btn.disabled = true;
      const label = x.label.trim() || (kind === 'maps' ? `Map, p. ${x.page}` : `Handout, p. ${x.page}`);
      try {
        const pdf = await pdfFor(st);
        const snap = await renderRegion(pdf, x.page, x.rect, kind === 'maps' ? 3500 : 2000, `${kind}-${x.page}.jpg`);
        const image = await uploadImage(snap.file);
        if (kind === 'maps') {
          await call(librarySocket(), 'scene:create', { name: label.slice(0, 60), map: { image, width: snap.width, height: snap.height } });
          toast(`"${label}" is a new scene. Line its grid up in the Scene tab.`);
        } else {
          await call(librarySocket(), 'handout:show', { image, caption: label, width: snap.width, height: snap.height });
          toast('Shown to players');
        }
      } catch (e) { toast(e.message, true); }
      btn.disabled = false;
    };
  });
  // thumbnails, one at a time so a big book doesn't stall the table
  (async () => {
    try {
      const pdf = await pdfFor(st);
      for (const li of body.querySelectorAll('.prep-pics li')) {
        if (!li.isConnected) return;
        const x = list.find((y) => y.id === li.dataset.id);
        const snap = await renderRegion(pdf, x.page, x.rect, 420);
        const url = URL.createObjectURL(snap.file);
        li.querySelector('.thumb').innerHTML = `<img src="${url}" alt="">`;
      }
    } catch (e) {
      body.querySelectorAll('.thumb').forEach((t) => { t.innerHTML = `<span class="muted small">No preview (${esc(e.message)})</span>`; });
    }
  })();
}
