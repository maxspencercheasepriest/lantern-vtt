import { $, esc, store, call, toast, debounce, uploadImage, openWindow, getWindow, allWindows } from './util.js';
import { SYSTEMS, systemFor } from './systems.js';
import { roll } from './rolls.js';

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
  sysSel.value = localStorage.getItem('lantern.lastSystem') || 'traveller';
  sysSel.onchange = () => localStorage.setItem('lantern.lastSystem', sysSel.value);
  $('#new-sheet').onclick = async () => {
    const sys = systemFor(sysSel.value);
    try {
      const { id } = await call(socket, 'sheet:create', { system: sys.id, data: sys.defaults() });
      pendingOpen = id;
    } catch (e) { toast(e.message, true); }
  };
  store.on('sheets', onSheets);
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
    <li data-id="${s.id}">
      <span><b>${esc(s.data?.name || 'Unnamed')}</b><br><span class="sys">${esc(systemFor(s.system).name)} · ${esc(s.owner || 'GM')}${s.shared ? ' · shared' : ''}</span></span>
      <span class="muted">›</span>
    </li>`).join('');
  for (const li of ul.querySelectorAll('li[data-id]')) li.onclick = () => openSheet(li.dataset.id);
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
    const t = e.target.closest('[data-roll], [data-add], [data-del], [data-set], [data-portrait], [data-meta=delete]');
    if (!t) return;
    const editable = canEdit(sheet);

    if (t.dataset.roll) {
      const [kind, arg] = t.dataset.roll.split(':');
      const r = sys.roll(kind, /^\d+$/.test(arg) ? +arg : arg, data, () => { save(); renderSheet(id); });
      if (!r) return;
      return roll(r.expr, { label: `${data.name ? data.name + ': ' : ''}${r.label}`, meta: { ...r.meta, sheetName: data.name } });
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
