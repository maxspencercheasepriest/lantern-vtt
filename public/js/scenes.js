// The GM's scene bar: every map in the campaign as a card along the top of the table.
// Click a card to look at that scene privately; "Move players here" takes everyone there.
// Drop map images anywhere on the table to make a new scene from each one.
import { $, esc, store, call, toast, uploadImage, imageSize } from './util.js';
import { serverUrl } from './net.js';

let socket;
let scenes = { list: [], active: null, view: null };
const COLLAPSE_KEY = 'lantern.scenebar.collapsed';
const err = (e) => toast(e.message, true);

export function initScenes(s) {
  socket = s;
  socket.on('scenes', (sc) => {
    const wasActive = scenes.active;
    scenes = sc;
    render();
    // players: say where they've been taken
    if (!store.isGM && wasActive && wasActive !== sc.active && store.scene?.name) toast(`The GM moved you to ${store.scene.name}`);
  });
  store.on('scene', () => { render(); if (!store.isGM && store.scene) $('#scene-name').textContent = store.scene.name || ''; });

  const bar = $('#scene-bar');
  try { bar.classList.toggle('collapsed', localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* ignore */ }
  $('#scene-collapse').onclick = () => {
    bar.classList.toggle('collapsed');
    try { localStorage.setItem(COLLAPSE_KEY, bar.classList.contains('collapsed') ? '1' : '0'); } catch { /* ignore */ }
    syncStage();
  };
  $('#scene-files').onchange = (e) => { addScenesFromFiles([...e.target.files]); e.target.value = ''; };
  $('#scene-move-here').onclick = () => call(socket, 'scene:activate', { id: scenes.view }).then(() => toast('Everyone is on this scene now')).catch(err);
  $('#scene-back').onclick = () => call(socket, 'scene:view', { id: null }).catch(err);

  // drop map images anywhere on the table → new scenes
  const stage = $('.stage');
  const isFiles = (e) => store.isGM && e.dataTransfer?.types?.includes('Files');
  stage.addEventListener('dragover', (e) => { if (isFiles(e)) { e.preventDefault(); stage.classList.add('dropping'); } });
  stage.addEventListener('dragleave', (e) => { if (e.target === stage || !stage.contains(e.relatedTarget)) stage.classList.remove('dropping'); });
  stage.addEventListener('drop', (e) => {
    stage.classList.remove('dropping');
    if (!isFiles(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
    if (!files.length) return toast('Drop map images (PNG, JPG, WebP or GIF)', true);
    addScenesFromFiles(files);
  });
}

const prettyName = (file) => file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New scene';

/** Upload each image and make a scene from it; the last one is shown to the GM. */
export async function addScenesFromFiles(files) {
  if (!files.length) return;
  const status = $('#scene-status');
  let made = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    status.textContent = `Uploading ${i + 1} of ${files.length}: ${f.name}…`;
    try {
      const url = await uploadImage(f);
      const { width, height } = await imageSize(url);
      await call(socket, 'scene:create', { name: prettyName(f), map: { image: url, width, height }, view: i === files.length - 1 });
      made++;
    } catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  status.textContent = '';
  if (made) toast(made === 1 ? 'New scene ready. Line the grid up in the Scene tab.' : `${made} new scenes ready`);
}

function syncStage() {
  const stage = $('.stage');
  const show = store.isGM && scenes.list.length > 0;
  stage.classList.toggle('has-scenebar', show && !$('#scene-bar').classList.contains('collapsed'));
  stage.classList.toggle('has-scenebar-collapsed', show && $('#scene-bar').classList.contains('collapsed'));
}

function render() {
  const bar = $('#scene-bar');
  if (!store.isGM) { bar.hidden = true; $('#scene-preview').hidden = true; syncStage(); return; }
  bar.hidden = false;
  const list = $('#scene-list');
  const editing = list.contains(document.activeElement) && document.activeElement.matches('input');
  if (!editing) {
    list.innerHTML = scenes.list.map((sc) => `
      <li class="scene-card ${sc.id === scenes.view ? 'viewing' : ''} ${sc.id === scenes.active ? 'live' : ''}" data-id="${esc(sc.id)}" draggable="true" title="${esc(sc.name)}${sc.id === scenes.active ? ' — the players are here' : ''}">
        <div class="thumb" style="${sc.image ? `background-image:url('${esc(serverUrl(sc.image))}')` : ''}">${sc.image ? '' : '<span>No map</span>'}</div>
        <div class="meta">
          <span class="nm">${sc.id === scenes.active ? '<span class="live-dot" title="Players are here"></span>' : ''}${esc(sc.name)}</span>
          <span class="acts">
            <button data-act="rename" title="Rename">✎</button>
            <button data-act="duplicate" title="Duplicate">⧉</button>
            <button data-act="delete" title="Delete">✕</button>
          </span>
        </div>
      </li>`).join('') + `
      <li class="scene-card add">
        <label title="Add maps as new scenes (or drop images onto the table)"><input type="file" id="scene-files-2" accept="image/*" multiple hidden><span>＋</span><small>Add maps</small></label>
        <button data-act="blank" class="blank" title="A scene with no map yet">Blank scene</button>
      </li>`;
    $('#scene-files-2').onchange = (e) => { addScenesFromFiles([...e.target.files]); e.target.value = ''; };
    wireCards(list);
  }
  // previewing banner
  const preview = scenes.view && scenes.active && scenes.view !== scenes.active;
  const banner = $('#scene-preview');
  banner.hidden = !preview;
  if (preview) {
    const active = scenes.list.find((x) => x.id === scenes.active);
    $('#scene-preview-text').innerHTML = `Only you can see this scene. The players are on <b>${esc(active?.name || 'another scene')}</b>.`;
  }
  syncStage();
}

let dragId = null;
function wireCards(list) {
  for (const li of list.querySelectorAll('.scene-card[data-id]')) {
    const id = li.dataset.id;
    li.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const sc = scenes.list.find((x) => x.id === id);
      if (act === 'rename') return void startRename(li, sc);
      if (act === 'duplicate') return void call(socket, 'scene:duplicate', { id }).catch(err);
      if (act === 'delete') {
        if (confirm(`Delete the scene "${sc.name}"? Its tokens, drawings and walls go with it.`)) call(socket, 'scene:delete', { id }).catch(err);
        return;
      }
      if (e.target.closest('input')) return;
      if (id !== scenes.view) call(socket, 'scene:view', { id: id === scenes.active ? null : id }).catch(err);
    };
    li.ondblclick = (e) => { if (!e.target.closest('[data-act]')) call(socket, 'scene:activate', { id }).then(() => toast('Everyone is on this scene now')).catch(err); };
    // reorder by dragging cards
    li.ondragstart = (e) => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); li.classList.add('dragging'); };
    li.ondragend = () => { dragId = null; li.classList.remove('dragging'); list.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before')); };
    li.ondragover = (e) => { if (dragId && dragId !== id) { e.preventDefault(); li.classList.add('drop-before'); } };
    li.ondragleave = () => li.classList.remove('drop-before');
    li.ondrop = (e) => {
      if (!dragId) return;
      e.preventDefault(); e.stopPropagation();
      const ids = scenes.list.map((x) => x.id).filter((x) => x !== dragId);
      ids.splice(ids.indexOf(id), 0, dragId);
      call(socket, 'scene:order', { ids }).catch(err);
    };
  }
  list.querySelector('[data-act="blank"]').onclick = () => call(socket, 'scene:create', { name: `Scene ${scenes.list.length + 1}` }).catch(err);
}

function startRename(li, sc) {
  const nm = li.querySelector('.nm');
  nm.innerHTML = `<input class="rename" value="${esc(sc.name)}" maxlength="60">`;
  const input = nm.querySelector('input');
  input.focus(); input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (save && name && name !== sc.name) call(socket, 'scene:update', { id: sc.id, name }).catch(err);
    else render();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); };
  input.onblur = () => finish(true);
}
