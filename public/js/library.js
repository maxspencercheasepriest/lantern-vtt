// PDF library: list, upload, sharing, search, the PDF viewer, and page handouts.
import { $, esc, store, call, toast, debounce, uploadImage, openWindow, getWindow } from './util.js';

let socket;
let docs = [];
let lastQuery = '';

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const shareLabel = (s) => (s === 'all' ? 'Everyone' : Array.isArray(s) ? s.join(', ') : 'GM only');
const lastPageKey = (id) => `lantern.pdf.page.${id}`;

export function initLibrary(s, { setMapFromImage }) {
  socket = s;
  mapSetter = setMapFromImage;
  window.__lanternRerunSearch = () => { if (lastQuery) search(lastQuery); };
  socket.on('library', (list) => {
    docs = list;
    renderList();
    for (const d of docs) getWindow(`pdfset:${d.id}`)?.refresh?.();
  });

  const q = $('#lib-q');
  const run = debounce(() => search(q.value), 250);
  q.addEventListener('input', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run.flush(); if (e.key === 'Escape') { q.value = ''; run.flush(); } });

  $('#lib-file').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const panel = $('[data-panel=library]');
  panel.addEventListener('dragover', (e) => { if (store.isGM && [...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); panel.classList.add('drop'); } });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('drop'); });
  panel.addEventListener('drop', (e) => {
    panel.classList.remove('drop');
    if (!store.isGM) return;
    e.preventDefault();
    uploadFiles([...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'));
  });

  // handout pop-ups for everyone except the GM who sent them
  socket.on('chat', (m) => { if (m.kind === 'handout' && m.from !== store.me) openHandout(m); });
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-handout]');
    if (h) { const m = store.chat.find((x) => x.id === h.dataset.handout); if (m) openHandout(m); }
  });
}

// ---------- list ----------
function renderList() {
  const ul = $('#lib-list');
  if (!docs.length) {
    ul.innerHTML = `<li class="empty muted">${store.isGM ? 'No PDFs yet. Add rulebooks, adventures or handouts — you choose who sees each one.' : 'The GM hasn\'t shared any PDFs with you yet.'}</li>`;
    return;
  }
  const sorted = [...docs].sort((a, b) => a.title.localeCompare(b.title));
  ul.innerHTML = sorted.map((d) => {
    const status = d.status === 'ready'
      ? (d.textPages === 0 ? '<span class="warn">No searchable text — probably a scan</span>' : '')
      : d.status === 'error' ? `<span class="bad">${esc(d.error || 'Failed')}</span>`
      : `<span class="prog"><span style="width:${Math.round((d.progress || 0) * 100)}%"></span></span><span class="muted">${d.status === 'queued' ? 'Waiting to index…' : `Indexing… ${Math.round((d.progress || 0) * 100)}%`}</span>`;
    return `<li data-id="${d.id}" class="${d.status === 'ready' ? '' : 'pending'}">
      <button class="open" ${d.status === 'ready' || store.isGM ? '' : 'disabled'} title="Open">
        <span class="t">${esc(d.title)}</span>
        <span class="m">${d.pages ? `${d.pages} pages · ` : ''}${fmtSize(d.size)}${store.isGM ? ` · <span class="share ${d.share === 'none' ? '' : 'on'}">${esc(shareLabel(d.share))}</span>` : ''}</span>
        ${status ? `<span class="s">${status}</span>` : ''}
      </button>
      ${store.isGM ? '<button class="gear" title="Sharing & settings">⚙</button>' : ''}
    </li>`;
  }).join('');
  for (const li of ul.querySelectorAll('li[data-id]')) {
    const d = docs.find((x) => x.id === li.dataset.id);
    li.querySelector('.open').onclick = () => (d.status === 'ready' || d.status === 'error' ? openViewer(d.id) : toast('Still indexing — you can open it once it\'s done'));
    const gear = li.querySelector('.gear');
    if (gear) gear.onclick = () => openSettings(d.id);
  }
}

// ---------- upload ----------
function uploadFiles(files) {
  if (!files.length) return toast('Choose PDF files', true);
  const box = $('#lib-uploads');
  const row = document.createElement('div');
  row.className = 'upload-row';
  const names = files.map((f) => f.name).join(', ');
  row.innerHTML = `<span class="name"></span><span class="prog"><span></span></span>`;
  row.querySelector('.name').textContent = `Uploading ${names}`;
  box.append(row);
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/library');
  xhr.setRequestHeader('x-upload-token', store.uploadToken);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) row.querySelector('.prog span').style.width = `${(e.loaded / e.total) * 100}%`; };
  xhr.onload = () => {
    row.remove();
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status !== 200) return toast(data.error || `Upload failed (${xhr.status})`, true);
    if (data.rejected?.length) toast(`Skipped (not a PDF): ${data.rejected.join(', ')}`, true);
    else toast(`Added ${data.ids.length} PDF${data.ids.length > 1 ? 's' : ''} — indexing for search…`);
  };
  xhr.onerror = () => { row.remove(); toast('Upload failed — connection lost', true); };
  xhr.send(fd);
}

// ---------- search ----------
const hlTerms = (text, terms) => {
  // escape, then wrap each term (case/accent-insensitive enough for English rulebooks)
  let out = esc(text);
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
    out = out.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return out.replace(/<mark>([^<]*)<mark>([^<]*)<\/mark>([^<]*)<\/mark>/g, '<mark>$1$2$3</mark>');
};

async function search(q) {
  lastQuery = q.trim();
  const box = $('#lib-results');
  const browse = $('#lib-browse');
  if (!lastQuery) { box.hidden = true; browse.hidden = false; return; }
  const [notesMod, rulesMod] = await Promise.all([import('./notes.js'), import('./rules.js')]);
  const rs = store.settings?.ruleset || 'generic';
  let r, ruleHits = [];
  try {
    [r, ruleHits] = await Promise.all([
      call(socket, 'library:search', { q: lastQuery }),
      rulesMod.searchRules(rs, lastQuery).catch(() => []),
    ]);
  } catch (e) { return toast(e.message, true); }
  if (q.trim() !== lastQuery) return; // a newer search is on its way
  const noteHits = notesMod.searchNotes(lastQuery);
  const terms = r.terms.length ? r.terms : lastQuery.toLowerCase().split(/\s+/);
  box.hidden = false; browse.hidden = true;
  const sections = [];
  if (noteHits.length) {
    sections.push(`<h3>Notes</h3>` + noteHits.map((x, i) => `<button class="hit" data-k="note" data-i="${i}"><span class="where"><b>${esc(x.title)}</b></span>${x.snippet ? `<span class="snip">${hlTerms(x.snippet, terms)}</span>` : ''}</button>`).join(''));
  }
  if (ruleHits.length) {
    sections.push(`<h3>Rules</h3>` + ruleHits.slice(0, 25).map((x, i) => `<button class="hit" data-k="rule" data-i="${i}"><span class="where"><b>${esc(x.name)}</b> · ${esc(x.catName)}${x.sub ? ` · ${esc(x.sub)}` : ''}</span>${x.snippet ? `<span class="snip">${hlTerms(x.snippet, terms)}</span>` : ''}</button>`).join(''));
  }
  if (r.results.length) {
    sections.push(`<h3>PDFs <span class="muted small">${r.total > r.results.length ? `top ${r.results.length} of ${r.total}` : r.total} page${r.total === 1 ? '' : 's'}</span></h3>` +
      r.results.map((x, i) => `<button class="hit" data-k="pdf" data-i="${i}"><span class="where">${esc(x.title)} <b>p. ${x.page}</b></span><span class="snip">${hlTerms(x.snippet, r.terms)}</span></button>`).join(''));
  }
  box.innerHTML = sections.join('') || `<p class="muted">Nothing matches <b>${esc(lastQuery)}</b>.${docs.some((d) => d.textPages === 0) ? ' Scanned PDFs without a text layer can\'t be searched.' : ''}</p>`;
  box.querySelectorAll('.hit').forEach((b) => {
    const i = +b.dataset.i;
    if (b.dataset.k === 'note') b.onclick = () => notesMod.openNote(noteHits[i].id);
    if (b.dataset.k === 'rule') b.onclick = () => rulesMod.openEntry(ruleHits[i].rs, ruleHits[i].cat, ruleHits[i].id);
    if (b.dataset.k === 'pdf') b.onclick = () => openViewer(r.results[i].docId, r.results[i].page, r.terms);
  });
}

/** Open a PDF by (part of) its title — for [[pdf:Title#page]] links in notes. */
export function openPdfByTitle(title, page) {
  const t = title.toLowerCase();
  const d = docs.find((x) => x.title.toLowerCase() === t) || docs.find((x) => x.title.toLowerCase().includes(t));
  if (!d) return toast(`No PDF called "${title}"${store.isGM ? ' in the library' : ' has been shared with you'}`, true);
  openViewer(d.id, page);
}

// ---------- settings (GM) ----------
function openSettings(id) {
  const w = openWindow(`pdfset:${id}`, { title: 'PDF settings', width: 380, height: 470 });
  const render = () => {
    const d = docs.find((x) => x.id === id);
    if (!d) return w.close();
    const share = d.share;
    const known = [...new Set([
      ...store.users.filter((u) => !u.isGM).map((u) => u.name),
      ...store.sheets.map((s) => s.owner).filter(Boolean),
      ...(Array.isArray(share) ? share : []),
    ])].sort();
    const mode = share === 'all' ? 'all' : Array.isArray(share) ? 'some' : 'none';
    w.body.innerHTML = `
      <div class="dialog pdfset">
        <label class="f">Title <input name="title" value="${esc(d.title)}" maxlength="120"></label>
        <h3>Who can read it in this campaign</h3>
        <label class="check"><input type="radio" name="mode" value="none" ${mode === 'none' ? 'checked' : ''}> Only me (GM)</label>
        <label class="check"><input type="radio" name="mode" value="all" ${mode === 'all' ? 'checked' : ''}> Everyone</label>
        <label class="check"><input type="radio" name="mode" value="some" ${mode === 'some' ? 'checked' : ''}> These players:</label>
        <div class="players">
          ${known.map((n) => `<label class="check"><input type="checkbox" name="p" value="${esc(n)}" ${Array.isArray(share) && share.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('') || '<span class="muted small">No players have joined yet — add a name:</span>'}
          <div class="row"><input name="addname" placeholder="Add a player's name" maxlength="32"><button class="btn" data-act="add">Add</button></div>
        </div>
        <p class="muted small">Players can open, read and search what you share. Other campaigns have their own sharing.</p>
        <div class="row"><button class="btn primary" data-act="save">Save</button><span style="flex:1"></span>
          <button class="btn ghost" data-act="reindex" title="Read the text again">Re-index</button>
          <button class="btn ghost danger" data-act="delete">Delete</button></div>
        <p class="muted small">${d.pages ? `${d.pages} pages, ${d.textPages ?? '?'} with text` : ''} · ${fmtSize(d.size)} · added ${new Date(d.uploadedAt).toLocaleDateString()}</p>
      </div>`;
    const q = (sel) => w.body.querySelector(sel);
    w.body.querySelectorAll('[name=p]').forEach((c) => (c.onchange = () => { if (c.checked) q('[name=mode][value=some]').checked = true; }));
    q('[data-act=add]').onclick = () => {
      const n = q('[name=addname]').value.trim();
      if (!n) return;
      const lab = document.createElement('label');
      lab.className = 'check';
      lab.innerHTML = `<input type="checkbox" name="p" checked> `;
      lab.firstChild.value = n;
      lab.append(n);
      q('.players').insertBefore(lab, q('.players .row'));
      q('[name=mode][value=some]').checked = true;
      q('[name=addname]').value = '';
    };
    q('[data-act=save]').onclick = async () => {
      const m = q('[name=mode]:checked').value;
      const picked = [...w.body.querySelectorAll('[name=p]:checked')].map((c) => c.value);
      const shareVal = m === 'all' ? 'all' : m === 'some' && picked.length ? picked : null;
      try {
        await call(socket, 'library:update', { id, title: q('[name=title]').value, share: shareVal });
        toast('Saved'); w.close();
      } catch (e) { toast(e.message, true); }
    };
    q('[data-act=reindex]').onclick = () => call(socket, 'library:reindex', { id }).then(() => toast('Re-indexing…'), (e) => toast(e.message, true));
    q('[data-act=delete]').onclick = async () => {
      if (!confirm(`Delete "${d.title}" from the library? Players lose access to it in every campaign.`)) return;
      try { await call(socket, 'library:delete', { id }); w.close(); } catch (e) { toast(e.message, true); }
    };
  };
  if (!w.existed) render();
  w.refresh = () => {}; // keep what the GM is editing; the list shows live status
}

// ---------- viewer ----------
let pdfjsLib = null;
async function loadPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('/pdfjs/build/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.min.mjs';
  }
  return pdfjsLib;
}

const viewers = new Map(); // docId -> viewer

export async function openViewer(id, page, terms) {
  const d = docs.find((x) => x.id === id);
  if (!d) return toast("That PDF isn't available to you", true);
  const existing = viewers.get(id);
  if (existing && getWindow(`pdf:${id}`)) {
    getWindow(`pdf:${id}`).el.dispatchEvent(new Event('pointerdown'));
    if (terms) existing.setTerms(terms);
    if (page) existing.go(page);
    return;
  }
  const w = openWindow(`pdf:${id}`, {
    title: d.title, width: Math.min(820, innerWidth - 40), height: innerHeight - 70,
    onClose: () => { viewers.get(id)?.destroy(); viewers.delete(id); },
  });
  w.el.classList.add('pdfwin');
  const v = new Viewer(w, d, page || Number(localStorage.getItem(lastPageKey(id))) || 1, terms || []);
  viewers.set(id, v);
  v.start();
}

class Viewer {
  constructor(w, doc, page, terms) {
    Object.assign(this, { w, doc, page, terms, zoom: null, pdf: null, task: null, renderSeq: 0, hits: [] });
    const gm = store.isGM;
    w.body.classList.add('pdfbody');
    w.body.innerHTML = `
      <div class="pdfbar">
        <select class="toc" title="Contents" hidden><option value="">Contents</option></select>
        <button class="b prev" title="Previous page (←)">‹</button>
        <span class="pg"><input class="pno" type="number" min="1"> / <span class="pcount">…</span></span>
        <button class="b next" title="Next page (→)">›</button>
        <span class="sep"></span>
        <button class="b zout" title="Zoom out">−</button><button class="b zfit" title="Fit width">Fit</button><button class="b zin" title="Zoom in">+</button>
        <span class="grow"></span>
        <input class="find" type="search" placeholder="Search this PDF" value="">
        ${gm ? '<span class="sep"></span><button class="b show" title="Show this page to everyone">Show page</button><button class="b area" title="Drag a box on the page to show part of it, or use it as the map">Select area</button>' : ''}
      </div>
      <div class="pdfmain">
        <div class="hits" hidden></div>
        <div class="scroller"><div class="page"><canvas></canvas><div class="textLayer"></div><div class="sel" hidden></div></div></div>
      </div>
      <div class="selpop" hidden><button class="btn primary" data-a="show">Show to players</button><button class="btn" data-a="map">Use as map</button><button class="btn ghost" data-a="cancel">Cancel</button></div>`;
    const $w = (s) => w.body.querySelector(s);
    this.el = {
      toc: $w('.toc'), pno: $w('.pno'), pcount: $w('.pcount'), find: $w('.find'), hits: $w('.hits'),
      scroller: $w('.scroller'), pageDiv: $w('.page'), canvas: $w('canvas'), text: $w('.textLayer'), sel: $w('.sel'), selpop: $w('.selpop'),
    };
    $w('.prev').onclick = () => this.go(this.page - 1);
    $w('.next').onclick = () => this.go(this.page + 1);
    $w('.zin').onclick = () => this.setZoom((this.zoom ?? this.fitScale) * 1.2);
    $w('.zout').onclick = () => this.setZoom((this.zoom ?? this.fitScale) / 1.2);
    $w('.zfit').onclick = () => this.setZoom(null);
    this.el.pno.onchange = () => this.go(Number(this.el.pno.value));
    this.el.find.value = terms.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' ');
    this.lastFind = this.el.find.value.trim();
    const runFind = debounce(() => this.find(this.el.find.value), 300);
    this.el.find.addEventListener('input', runFind);
    // Enter: run the search if it changed (jumping to the first hit), otherwise go to the next page with a hit
    this.el.find.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (this.el.find.value.trim() !== this.lastFind) { runFind.cancel?.(); this.find(this.el.find.value, true); }
      else this.nextHit(e.shiftKey ? -1 : 1);
    });
    this.el.toc.onchange = () => this.goToc(this.el.toc.value);
    if (gm) {
      $w('.show').onclick = () => this.showRegion(null);
      $w('.area').onclick = () => this.startSelect();
      this.el.selpop.addEventListener('click', (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        const r = this.selection;
        this.endSelect();
        if (a === 'show') this.showRegion(r);
        if (a === 'map') this.useAsMap(r);
      });
    }
    // keyboard paging while the window is focused and you're not typing
    this.onKey = (e) => {
      if (!w.el.classList.contains('focused') || e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { this.go(this.page + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { this.go(this.page - 1); e.preventDefault(); }
      if (e.key === 'Escape' && this.selecting) this.endSelect();
    };
    addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(debounce(() => { if (this.zoom == null) this.render(); }, 120));
    this.ro.observe(this.el.scroller);
  }

  get fitScale() { return this._fit || 1; }

  async start() {
    try {
      const lib = await loadPdfJs();
      this.task = lib.getDocument({
        url: `/api/library/${this.doc.id}.pdf`,
        httpHeaders: { 'x-upload-token': store.uploadToken },
        cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/',
        disableAutoFetch: true, // big rulebooks: only fetch the pages we look at
        isEvalSupported: false,
      });
      this.pdf = await this.task.promise;
    } catch (e) {
      this.w.body.querySelector('.scroller').innerHTML = `<p class="bad" style="padding:20px">Couldn't open this PDF: ${esc(e.message)}</p>`;
      return;
    }
    this.el.pcount.textContent = this.pdf.numPages;
    this.el.pno.max = this.pdf.numPages;
    this.page = Math.min(Math.max(1, this.page), this.pdf.numPages);
    this.loadToc();
    await this.render();
    if (this.terms.length) this.find(this.el.find.value, true);
  }

  destroy() {
    removeEventListener('keydown', this.onKey);
    this.ro.disconnect();
    this.task?.destroy();
  }

  setTerms(terms) {
    this.terms = terms;
    this.el.find.value = terms.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' ');
    this.find(this.el.find.value, true);
  }

  go(n) {
    if (!this.pdf) { this.page = n; return; }
    n = Math.min(Math.max(1, Math.round(n) || 1), this.pdf.numPages);
    if (n === this.page && this.rendered) return this.highlight(true);
    this.page = n;
    localStorage.setItem(lastPageKey(this.doc.id), n);
    this.render().then(() => { this.el.scroller.scrollTop = 0; this.highlight(true); });
    this.markHit();
  }

  setZoom(z) { this.zoom = z == null ? null : Math.min(5, Math.max(0.25, z)); this.render(); }

  async render() {
    if (!this.pdf) return;
    const seq = ++this.renderSeq;
    const page = await this.pdf.getPage(this.page);
    if (seq !== this.renderSeq) return;
    const base = page.getViewport({ scale: 1 });
    this._fit = Math.max(0.2, (this.el.scroller.clientWidth - 24) / base.width);
    const scale = this.zoom ?? this._fit;
    const vp = page.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;
    // draw into a fresh canvas, then swap — no flash of a blank page while flipping
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * ratio);
    canvas.height = Math.floor(vp.height * ratio);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    this.renderTask?.cancel();
    this.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    try { await this.renderTask.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    if (seq !== this.renderSeq) return;
    this.el.canvas.replaceWith(canvas);
    this.el.canvas = canvas;
    const pd = this.el.pageDiv;
    pd.style.width = canvas.style.width;
    pd.style.height = canvas.style.height;
    pd.style.setProperty('--scale-factor', scale);
    pd.style.setProperty('--total-scale-factor', scale);
    pd.style.setProperty('--user-unit', 1);
    const text = document.createElement('div');
    text.className = 'textLayer';
    this.el.text.replaceWith(text);
    this.el.text = text;
    try {
      const tl = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: vp });
      await tl.render();
    } catch { /* no text layer is fine */ }
    if (seq !== this.renderSeq) return;
    this.el.pno.value = this.page;
    this.rendered = true;
    this.highlight(false);
  }

  // highlight search terms on the current page
  highlight(scrollTo) {
    const terms = this.terms.map((t) => t.toLowerCase()).filter(Boolean);
    if (!terms.length) return;
    const spans = [...this.el.text.querySelectorAll('span')].filter((s) => !s.children.length && s.textContent.trim());
    const words = terms.flatMap((t) => (t.includes(' ') ? [t, ...t.split(' ').filter((x) => x.length > 2)] : [t]));
    let first = null;
    for (const span of spans) {
      const txt = span.textContent;
      const low = txt.toLowerCase();
      const ranges = [];
      for (const t of words) {
        let i = low.indexOf(t);
        while (i !== -1) { ranges.push([i, i + t.length]); i = low.indexOf(t, i + t.length); }
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
      let html = '', pos = 0;
      for (const [a, b] of merged) { html += esc(txt.slice(pos, a)) + `<mark class="hl">${esc(txt.slice(a, b))}</mark>`; pos = b; }
      span.innerHTML = html + esc(txt.slice(pos));
    }
    first = this.el.text.querySelector('mark.hl');
    if (scrollTo && first) {
      const sc = this.el.scroller;
      const top = first.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight / 3;
      sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  async find(q, jump) {
    q = q.trim();
    this.lastFind = q;
    if (!q) { this.terms = []; this.hits = []; this.el.hits.hidden = true; this.render(); return; }
    let r;
    try { r = await call(socket, 'library:search', { q, docId: this.doc.id }); } catch (e) { return toast(e.message, true); }
    if (q !== this.el.find.value.trim()) return;
    this.terms = r.terms;
    this.hits = [...r.results].sort((a, b) => a.page - b.page);
    const box = this.el.hits;
    box.hidden = false;
    box.innerHTML = `<div class="hh">${this.hits.length ? `${r.total} page${r.total === 1 ? '' : 's'}` : 'No matches'}<button class="x" title="Close">✕</button></div>` +
      this.hits.map((h, i) => `<button class="hit" data-i="${i}"><b>p. ${h.page}</b><span>${hlTerms(h.snippet, r.terms)}</span></button>`).join('');
    box.querySelector('.x').onclick = () => { this.el.find.value = ''; this.find(''); };
    box.querySelectorAll('.hit').forEach((b) => (b.onclick = () => this.go(this.hits[+b.dataset.i].page)));
    if (jump && this.hits.length && !this.hits.some((h) => h.page === this.page)) this.go(this.hits[0].page);
    else this.render().then(() => this.highlight(jump));
    this.markHit();
  }

  nextHit(dir) {
    if (!this.hits.length) return;
    const pages = this.hits.map((h) => h.page);
    const next = dir > 0 ? pages.find((p) => p > this.page) ?? pages[0] : [...pages].reverse().find((p) => p < this.page) ?? pages[pages.length - 1];
    this.go(next);
  }

  markHit() {
    this.el.hits.querySelectorAll('.hit').forEach((b) => b.classList.toggle('cur', this.hits[+b.dataset.i]?.page === this.page));
    this.el.hits.querySelector('.hit.cur')?.scrollIntoView({ block: 'nearest' });
  }

  async loadToc() {
    let outline;
    try { outline = await this.pdf.getOutline(); } catch { return; }
    if (!outline?.length) return;
    this.toc = [];
    const walk = (items, depth) => {
      for (const it of items) {
        if (this.toc.length > 600) return;
        this.toc.push({ title: it.title, dest: it.dest, depth });
        if (it.items?.length && depth < 3) walk(it.items, depth + 1);
      }
    };
    walk(outline, 0);
    this.el.toc.innerHTML = '<option value="">Contents</option>' + this.toc.map((t, i) => `<option value="${i}">${'  '.repeat(t.depth)}${esc(t.title)}</option>`).join('');
    this.el.toc.hidden = false;
  }

  async goToc(i) {
    this.el.toc.value = '';
    const t = this.toc?.[+i];
    if (!t) return;
    try {
      let dest = t.dest;
      if (typeof dest === 'string') dest = await this.pdf.getDestination(dest);
      if (!Array.isArray(dest)) return;
      const ref = dest[0];
      const idx = typeof ref === 'number' ? ref : await this.pdf.getPageIndex(ref);
      this.go(idx + 1);
    } catch { toast("Couldn't follow that bookmark", true); }
  }

  // ---- GM: select an area of the page ----
  startSelect() {
    if (this.selecting) return this.endSelect();
    this.selecting = true;
    this.w.body.classList.add('selecting');
    toast('Drag a box around what you want to show. Esc to cancel.');
    const pd = this.el.pageDiv, sel = this.el.sel;
    this.onSelDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = pd.getBoundingClientRect();
      const x0 = e.clientX - r.left, y0 = e.clientY - r.top;
      sel.hidden = false;
      const move = (ev) => {
        const x1 = Math.min(Math.max(0, ev.clientX - r.left), r.width), y1 = Math.min(Math.max(0, ev.clientY - r.top), r.height);
        Object.assign(sel.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
      };
      const up = (ev) => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        move(ev);
        const b = { x: parseFloat(sel.style.left), y: parseFloat(sel.style.top), w: parseFloat(sel.style.width), h: parseFloat(sel.style.height) };
        if (b.w < 8 || b.h < 8) { sel.hidden = true; return; }
        // store as fractions of the page so it survives zooming
        this.selection = { x: b.x / r.width, y: b.y / r.height, w: b.w / r.width, h: b.h / r.height };
        this.el.selpop.hidden = false;
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    pd.addEventListener('pointerdown', this.onSelDown);
  }

  endSelect() {
    this.selecting = false;
    this.w.body.classList.remove('selecting');
    this.el.sel.hidden = true;
    this.el.selpop.hidden = true;
    this.el.pageDiv.removeEventListener('pointerdown', this.onSelDown);
  }

  /** Render the page (or a fraction-rect of it) at high resolution to a JPEG blob. */
  async snapshot(rect, longEdge) {
    const page = await this.pdf.getPage(this.page);
    const base = page.getViewport({ scale: 1 });
    const r = rect || { x: 0, y: 0, w: 1, h: 1 };
    const regionLong = Math.max(base.width * r.w, base.height * r.h);
    const scale = Math.min(6, longEdge / regionLong);
    const vp = page.getViewport({ scale });
    const full = document.createElement('canvas');
    full.width = Math.floor(vp.width); full.height = Math.floor(vp.height);
    const fctx = full.getContext('2d');
    fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, full.width, full.height);
    await page.render({ canvasContext: fctx, viewport: vp }).promise;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(full.width * r.w));
    out.height = Math.max(1, Math.round(full.height * r.h));
    out.getContext('2d').drawImage(full, Math.round(full.width * r.x), Math.round(full.height * r.y), out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.9));
    return { file: new File([blob], `page-${this.page}.jpg`, { type: 'image/jpeg' }), width: out.width, height: out.height };
  }

  async showRegion(rect) {
    try {
      toast('Sending to the table…');
      const snap = await this.snapshot(rect, 2000);
      const image = await uploadImage(snap.file);
      await call(socket, 'handout:show', { image, caption: `${this.doc.title} — p. ${this.page}`, width: snap.width, height: snap.height });
      toast('Shown to players');
    } catch (e) { toast(e.message, true); }
  }

  async useAsMap(rect) {
    if (!confirm('Replace the current map with this?')) return;
    try {
      toast('Making the map…');
      const snap = await this.snapshot(rect, 3000);
      const image = await uploadImage(snap.file);
      await mapSetter(image, snap.width, snap.height);
      toast('Map set — line the grid up in the Scene tab');
    } catch (e) { toast(e.message, true); }
  }
}

let mapSetter = null;

// ---------- handouts ----------
export function renderHandoutCard(m) {
  return `<button class="handout" data-handout="${esc(m.id)}" title="Open">
    <img src="${esc(m.image)}" alt="" loading="lazy">
    <span>${esc(m.caption || 'Handout')}</span>
  </button>`;
}

function openHandout(m) {
  const ratio = m.width && m.height ? m.height / m.width : 1.3;
  const wdt = Math.min(760, innerWidth - 40);
  const w = openWindow(`handout:${m.id}`, { title: m.caption || 'Handout', width: wdt, height: Math.min(innerHeight - 60, wdt * ratio + 50) });
  if (w.existed) return;
  w.body.classList.add('handoutbody');
  w.body.innerHTML = `<img src="${esc(m.image)}" alt="${esc(m.caption || 'Handout')}" title="Click to zoom">`;
  const img = w.body.querySelector('img');
  img.onclick = () => img.classList.toggle('zoomed');
}
