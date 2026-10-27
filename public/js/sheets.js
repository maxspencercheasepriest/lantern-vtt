import { $, esc, store, call, toast, debounce, uploadImage, openWindow, getWindow, allWindows } from './util.js';
import { SYSTEMS, systemFor } from './systems.js';
import { roll } from './rolls.js';
import { generate } from './chargen.js';

let socket;
const drafts = new Map();  // sheetId -> working copy of data while editing
const savers = new Map();  // sheetId -> debounced save
const stale = new Set();   // sheet windows that need a re-render once the user stops typing

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  const target = keys.reduce((a, k) => a[k], o);
  target[last] = v;
}
const canEdit = (s) => store.isGM || s.owner === store.me;
const sheetById = (id) => store.sheets.find((s) => s.id === id);

export function initSheets(s) {
  socket = s;
  const sysSel = $('#new-sheet-system');
  sysSel.innerHTML = Object.values(SYSTEMS).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  sysSel.value = localStorage.getItem('lantern.lastSystem') || 'generic';
  store.on('settings', (st) => { if (st.ruleset && SYSTEMS[st.ruleset]) sysSel.value = st.ruleset; });
  sysSel.onchange = () => localStorage.setItem('lantern.lastSystem', sysSel.value);
  $('#new-sheet').onclick = async () => {
    const sys = systemFor(sysSel.value);
    try {
      const { id } = await call(socket, 'sheet:create', { system: sys.id, data: sys.defaults() });
      pendingOpen = id;
    } catch (e) { toast(e.message, true); }
  };
  $('#quick-char').onclick = () => openGenerator(sysSel.value);
  store.on('sheets', onSheets);
}

// ---------- quick character generator ----------
function openGenerator(systemId) {
  const w = openWindow('chargen', { title: 'Quick character', width: 460, height: 560 });
  if (w.existed) return;
  let current = null;
  w.body.innerHTML = `
    <div class="chargen">
      <div class="row">
        <select class="cg-sys" aria-label="Game system">${Object.values(SYSTEMS).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
        <button class="btn cg-roll" title="Roll a new character">🎲 Reroll</button>
      </div>
      <label class="f">Name<input class="cg-name" maxlength="60"></label>
      <ul class="cg-log"></ul>
      <label class="check"><input type="checkbox" class="cg-chat" checked> Show the rolls in chat</label>
      <div class="row"><button class="btn primary cg-create">Create sheet</button></div>
      <p class="muted small">Rolled with each game's usual method where it's quick; occupations, careers and hooks are picked at random so you can tweak them on the sheet.</p>
    </div>`;
  const q = (c) => w.body.querySelector(c);
  q('.cg-sys').value = SYSTEMS[systemId] ? systemId : 'generic';
  const reroll = () => {
    const sys = systemFor(q('.cg-sys').value);
    current = { sys, ...generate(sys.id, sys.defaults()) };
    q('.cg-name').value = current.data.name;
    q('.cg-log').innerHTML = current.log.map((l) => `<li>${esc(l)}</li>`).join('');
  };
  q('.cg-sys').onchange = reroll;
  q('.cg-roll').onclick = reroll;
  q('.cg-create').onclick = async () => {
    const b = q('.cg-create');
    b.disabled = true;
    try {
      const data = { ...current.data, name: q('.cg-name').value.trim() || current.data.name };
      const { id } = await call(socket, 'sheet:create', { system: current.sys.id, data });
      pendingOpen = id;
      if (q('.cg-chat').checked) {
        await call(socket, 'chat:send', { text: `Rolled up ${data.name} (${current.sys.name}):\n${current.log.join('\n')}` }).catch(() => {});
      }
      w.close();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  };
  reroll();
}

let pendingOpen = null;
function onSheets() {
  renderList();
  if (pendingOpen && sheetById(pendingOpen)) { openSheet(pendingOpen); pendingOpen = null; }
  for (const [key, w] of allWindows()) {
    if (!key.startsWith('sheet:')) continue;
    const id = key.slice(6);
    const sheet = sheetById(id);
    if (!sheet) { w.close(); continue; }
    if (savers.get(id)?.pending) continue; // our own edits are in flight
    if (w.el.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) { stale.add(id); continue; }
    drafts.delete(id);
    renderSheet(id);
  }
}

function renderList() {
  const ul = $('#sheet-list');
  if (!store.sheets.length) {
    ul.innerHTML = '<li class="muted" style="cursor:default">No sheets yet.</li>';
    return;
  }
  ul.innerHTML = store.sheets.map((s) => `
    <li data-id="${s.id}" ${canEdit(s) ? 'draggable="true" title="Drag onto the map to place a token"' : ''}>
      <span><b>${esc(s.data?.name || 'Unnamed')}</b><br><span class="sys">${esc(systemFor(s.system).name)} · ${esc(s.owner || 'GM')}${s.shared ? ' · shared' : ''}</span></span>
      ${canEdit(s) ? '<button class="place" title="Place a token for this character on the map">📍</button>' : ''}
      <span class="muted">›</span>
    </li>`).join('');
  for (const li of ul.querySelectorAll('li[data-id]')) {
    const id = li.dataset.id;
    li.onclick = (e) => { if (!e.target.closest('.place')) openSheet(id); };
    li.querySelector('.place')?.addEventListener('click', () => import('./map.js').then((m) => m.placeSheet(id)));
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-lantern-sheet', id);
      e.dataTransfer.effectAllowed = 'copy';
      document.body.classList.add('dragging-sheet');
    });
    li.addEventListener('dragend', () => document.body.classList.remove('dragging-sheet'));
  }
}

/** A sheet's health bar, for a new token. */
export function sheetBar(id) {
  const sh = sheetById(id);
  const sys = sh && systemFor(sh.system);
  try { return sys?.bar ? sys.bar(sh.data) : null; } catch { return null; }
}

export function openSheet(id) {
  const sheet = sheetById(id);
  if (!sheet) return toast("You can't see that sheet", true);
  const w = openWindow(`sheet:${id}`, {
    title: sheet.data?.name || 'Sheet',
    width: 520, height: 680,
    onClose: () => { savers.get(id)?.flush?.(); drafts.delete(id); },
  });
  if (!w.existed) wire(w, id);
  renderSheet(id);
}

function draftFor(id) {
  if (!drafts.has(id)) drafts.set(id, structuredClone(sheetById(id).data));
  return drafts.get(id);
}

function saverFor(id) {
  if (!savers.has(id)) {
    const fn = debounce(async () => {
      saver.pending = false;
      const sheet = sheetById(id);
      const data = drafts.get(id);
      if (!sheet || !data) return;
      const sys = systemFor(sheet.system);
      try {
        await call(socket, 'sheet:update', { id, data, bar: sys.bar ? sys.bar(data) : undefined });
      } catch (e) { toast(e.message, true); }
    }, 450);
    const saver = (...a) => { saver.pending = true; fn(...a); };
    saver.flush = () => { if (saver.pending) fn.flush(); };
    savers.set(id, saver);
  }
  return savers.get(id);
}

function renderSheet(id) {
  const w = getWindow(`sheet:${id}`);
  const sheet = sheetById(id);
  if (!w || !sheet) return;
  const sys = systemFor(sheet.system);
  const data = draftFor(id);
  const editable = canEdit(sheet);
  const owners = [...new Set([...store.users.filter((u) => !u.isGM).map((u) => u.name), ...store.sheets.map((s) => s.owner), sheet.owner].filter(Boolean))];
  const scroll = w.body.scrollTop;
  w.setTitle(`${data.name || 'Unnamed'} — ${sys.name}`);
  w.body.innerHTML = `
    <div class="sheet ${editable ? '' : 'readonly'}">
      ${sys.render(data)}
      <div class="sheet-bar">
        ${store.isGM ? `<label class="f">Owner <select data-meta="owner"><option value="">GM only</option>${owners.map((o) => `<option ${o === sheet.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>` : `<span>Owner: <b>${esc(sheet.owner || 'GM')}</b></span>`}
        ${editable ? `<label class="check"><input type="checkbox" data-meta="shared" ${sheet.shared ? 'checked' : ''}> Visible to everyone</label>` : ''}
        <span class="grow"></span>
        ${editable ? '<button class="btn ghost danger" data-meta="delete">Delete sheet</button>' : ''}
      </div>
    </div>`;
  w.body.scrollTop = scroll;
  // spell names to pick from (D&D)
  const dl = w.body.querySelector('#dnd-spells');
  if (dl) import('./rules.js').then((m) => m.entryNames('dnd5e', 'spells')).then((names) => { dl.innerHTML = names.map((n) => `<option value="${esc(n)}">`).join(''); }).catch(() => {});
  if (!editable) w.body.querySelectorAll('input, select, textarea').forEach((el) => { if (!el.dataset.meta) el.disabled = true; });
}

function wire(w, id) {
  const body = w.body;
  const save = () => saverFor(id)();

  const readInput = (el) => {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? '' : Number(el.value);
    return el.value;
  };

  body.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.bind || !canEdit(sheetById(id))) return;
    setPath(draftFor(id), el.dataset.bind, readInput(el));
    if (el.dataset.bind === 'name') w.setTitle(`${el.value || 'Unnamed'} — ${systemFor(sheetById(id).system).name}`);
    save();
  });
  // re-render on commit so derived numbers (DMs, bases, parry…) refresh without fighting the cursor
  body.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.meta === 'owner') return call(socket, 'sheet:update', { id, owner: el.value }).catch((er) => toast(er.message, true));
    if (el.dataset.meta === 'shared') return call(socket, 'sheet:update', { id, shared: el.checked }).catch((er) => toast(er.message, true));
    if (el.dataset.bind && (el.type === 'number' || el.tagName === 'SELECT' || el.type === 'checkbox')) renderSheet(id);
  });
  body.addEventListener('focusout', () => {
    setTimeout(() => {
      if (stale.has(id) && !body.contains(document.activeElement)) {
        stale.delete(id);
        if (!savers.get(id)?.pending) { drafts.delete(id); renderSheet(id); }
      }
    }, 50);
  });

  body.addEventListener('click', async (e) => {
    const sheet = sheetById(id);
    if (!sheet) return;
    const sys = systemFor(sheet.system);
    const data = draftFor(id);
    const ref = e.target.closest('[data-ref]');
    if (ref) {
      const [cat, ...rest] = ref.dataset.ref.split(':');
      const name = (ref.dataset.refPath ? String(getPath(draftFor(id), ref.dataset.refPath) || '') : rest.join(':')).trim();
      if (!name) return toast('Type a name first', true);
      return import('./rules.js').then((m) => m.openEntryByName(sheetById(id).system, cat, name));
    }
    const t = e.target.closest('[data-roll], [data-add], [data-del], [data-set], [data-portrait], [data-meta=delete]');
    if (!t) return;
    const editable = canEdit(sheet);

    if (t.dataset.roll) {
      const at = t.dataset.roll.indexOf(':');
      const kind = at < 0 ? t.dataset.roll : t.dataset.roll.slice(0, at);
      const arg = at < 0 ? '' : t.dataset.roll.slice(at + 1);
      const r = sys.roll(kind, /^\d+$/.test(arg) ? +arg : arg, data, () => { save(); renderSheet(id); });
      if (!r) return;
      if (r.error) return toast(r.error, true);
      const res = await roll(r.expr, { label: `${data.name ? data.name + ': ' : ''}${r.label}`, meta: { ...r.meta, sheetName: data.name } });
      // initiative rolled from a sheet goes straight into the combat tracker
      if (res && r.meta?.initiative) store.emit('initiative-rolled', { sheetId: id, total: res.total });
      return;
    }
    if (!editable) return;
    if (t.dataset.add) {
      getPath(data, t.dataset.add).push(sys.rows[t.dataset.add]());
      save(); renderSheet(id);
      const rows = body.querySelectorAll(`[data-bind^="${t.dataset.add}."]`);
      rows[rows.length - 1]?.closest('.li')?.querySelector('input')?.focus();
    } else if (t.dataset.del) {
      const [path, i] = t.dataset.del.split(':');
      getPath(data, path).splice(+i, 1);
      save(); renderSheet(id);
    } else if (t.dataset.set) {
      const [path, v] = t.dataset.set.split(':');
      setPath(data, path, Number(v));
      save(); renderSheet(id);
    } else if ('portrait' in t.dataset) {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
      input.onchange = async () => {
        try {
          data.portrait = await uploadImage(input.files[0]);
          save(); renderSheet(id);
        } catch (er) { toast(er.message, true); }
      };
      input.click();
    } else if (t.dataset.meta === 'delete') {
      if (!confirm(`Delete "${data.name || 'this sheet'}"? This can't be undone.`)) return;
      call(socket, 'sheet:delete', { id }).catch((er) => toast(er.message, true));
    }
  });
}
