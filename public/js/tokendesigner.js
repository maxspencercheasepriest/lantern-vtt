// The token designer: a photo in a round frame, with a rim of any finish or dice material you've unlocked (painted
// by dicepaint.js), trim, an inner glow and a name plate. Drag the photo to move it, scroll or use the slider to
// zoom. Makes a 512 px PNG that's uploaded and used as a framed token. Your tokens are kept by the server's add-on
// (Lantern Plus: with your login) or in this browser. At the table it's a window (openTokenDesigner); Lantern Plus
// mounts it on its account pages (mountTokenDesigner).
import { openWindow, call, toast, $, $$, esc, uploadImage, store } from './util.js';
import { serverUrl } from './net.js';
import { FINISHES, groupOf } from '/shared/dicestyle.js';
import { TRIMS, DEFAULT_TOKEN, MAX_TOKENS, cleanTokenDesign, cleanTokenLib, tokenMaterials } from '/shared/tokenstyle.js';
import { paintSwatch } from './dicepaint.js';

const SIZE = 512, R = 254;
const KEY = 'lantern.tokens';
const localLib = () => { try { return cleanTokenLib(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } };
const keepLocal = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* private mode */ } };
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const GROUPS = [['finish', 'Finishes'], ['material', 'Materials'], ['gm', 'Game master materials'], ['season', 'Seasonal materials'], ['creator', 'Creator materials']];

const images = new Map();
function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (!images.has(url)) {
    images.set(url, new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => { images.delete(url); resolve(null); };
      im.src = serverUrl(url);
    }));
  }
  return images.get(url);
}

const swatches = new Map();
function swatch(rim, c1, c2) {
  const k = `${rim}|${c1}|${c2}`;
  if (!swatches.has(k)) {
    if (swatches.size > 30) swatches.clear();
    swatches.set(k, paintSwatch(SIZE, SIZE, rim, c1, c2, 11));
  }
  return swatches.get(k);
}

/** Draw a design onto a 512×512 canvas (transparent outside the circle). */
export function renderToken(cv, d, photo) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, SIZE, SIZE);
  const c = SIZE / 2, inner = R * (1 - d.width);
  // the picture, inside the rim
  g.save();
  g.beginPath(); g.arc(c, c, inner + 1, 0, Math.PI * 2); g.clip();
  g.fillStyle = d.bg; g.fillRect(0, 0, SIZE, SIZE);
  if (photo) {
    const k = Math.max((inner * 2) / photo.naturalWidth, (inner * 2) / photo.naturalHeight) * d.zoom;
    const w = photo.naturalWidth * k, h = photo.naturalHeight * k;
    g.drawImage(photo, c - w / 2 + d.ox * inner, c - h / 2 + d.oy * inner, w, h);
  }
  // shade the inside edge so the picture sits under the rim
  const sh = g.createRadialGradient(c, c, inner * 0.82, c, c, inner);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = sh; g.fillRect(0, 0, SIZE, SIZE);
  if (d.glow) {
    // an inner glow (a boss, a ghost, something magic)
    const gl = g.createRadialGradient(c, c, inner * 0.55, c, c, inner);
    gl.addColorStop(0, 'rgba(0,0,0,0)'); gl.addColorStop(1, d.glow);
    g.globalCompositeOperation = 'screen'; g.fillStyle = gl; g.fillRect(0, 0, SIZE, SIZE); g.globalCompositeOperation = 'source-over';
  }
  g.restore();

  // the rim: the material painted in a ring, then light and shade so it looks raised
  const ring = (ctx) => { ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.arc(c, c, inner, 0, Math.PI * 2, true); };
  const sw = swatch(d.rim, d.c1, d.c2);
  g.save();
  ring(g); g.clip();
  g.drawImage(sw.canvas, 0, 0);
  if (sw.glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.8; g.drawImage(sw.glow, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  const lit = g.createLinearGradient(0, 0, SIZE, SIZE);
  const shine = sw.metal ? 0.55 : d.rim === 'matte' ? 0.12 : 0.3;
  lit.addColorStop(0, `rgba(255,255,255,${shine})`); lit.addColorStop(0.45, 'rgba(255,255,255,0)');
  lit.addColorStop(0.55, 'rgba(0,0,0,0)'); lit.addColorStop(1, `rgba(0,0,0,${sw.metal ? 0.5 : 0.35})`);
  g.fillStyle = lit; g.fillRect(0, 0, SIZE, SIZE);
  if (sw.metal) {
    // a bright band round metal rims
    const band = g.createRadialGradient(c, c, inner, c, c, R);
    band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, 'rgba(255,255,255,0.28)'); band.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = band; g.fillRect(0, 0, SIZE, SIZE);
  }
  if (d.rim === 'pearl') {
    const ir = g.createConicGradient(0, c, c);
    for (const [t, col] of [[0, '#ffd6f0'], [0.33, '#d6f0ff'], [0.66, '#fff3d0'], [1, '#ffd6f0']]) ir.addColorStop(t, col);
    g.globalAlpha = 0.3; g.fillStyle = ir; g.fillRect(0, 0, SIZE, SIZE); g.globalAlpha = 1;
  }
  g.restore();
  // trim
  const mid = (R + inner) / 2, band = R - inner;
  g.save();
  if (d.trim === 'double') {
    g.strokeStyle = d.c2; g.lineWidth = Math.max(2, band * 0.09);
    for (const rr of [inner + band * 0.18, R - band * 0.18]) { g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.stroke(); }
  } else if (d.trim === 'studs') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2, x = c + Math.cos(a) * mid, y = c + Math.sin(a) * mid, rr = band * 0.17;
      const st = g.createRadialGradient(x - rr * 0.35, y - rr * 0.35, rr * 0.1, x, y, rr);
      st.addColorStop(0, '#ffffff'); st.addColorStop(0.35, d.c2); st.addColorStop(1, '#000000');
      g.fillStyle = st; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    }
  } else if (d.trim === 'ticks') {
    g.strokeStyle = d.c2; g.lineCap = 'round';
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, big = i % 3 === 0, l = band * (big ? 0.5 : 0.28);
      g.lineWidth = big ? 3 : 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * (mid - l / 2), c + Math.sin(a) * (mid - l / 2)); g.lineTo(c + Math.cos(a) * (mid + l / 2), c + Math.sin(a) * (mid + l / 2)); g.stroke();
    }
  }
  // crisp edges
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3;
  g.beginPath(); g.arc(c, c, R - 1.5, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(c, c, inner, 0, Math.PI * 2); g.stroke();
  g.restore();
  // the name plate across the bottom of the rim
  if (d.plate) {
    const serif = !!FINISHES[d.rim]?.serif;
    let size = 46;
    const family = serif ? '"Fraunces", Georgia, serif' : '"IBM Plex Sans", Arial, sans-serif';
    g.font = `700 ${size}px ${family}`;
    while (g.measureText(d.plate).width > SIZE * 0.62 && size > 18) { size -= 2; g.font = `700 ${size}px ${family}`; }
    const w = Math.min(SIZE * 0.86, g.measureText(d.plate).width + size * 1.3), h = size * 1.5, y = c + R * 0.74;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
    g.fillStyle = d.plateColor;
    g.beginPath(); g.roundRect(c - w / 2, y - h / 2, w, h, h * 0.3); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = d.c1; g.lineWidth = 4; g.stroke();
    g.fillStyle = d.plateInk; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(d.plate, c, y + size * 0.04);
    g.restore();
  }
}

// ---------- the designer ----------
let ctx = null, root = null;
let design = { ...DEFAULT_TOKEN };
let editing = null;   // the id of the library token being changed, if any
let tokens = [], onServer = false;

/** At the table: the designer in a window, with "Put on the map" for the GM and "Use for my character". */
export function openTokenDesigner({ socket, unlocks, placeAt }) {
  const w = openWindow('token-designer', { title: 'Token designer', width: 940, height: 720 });
  if (w.existed) return;
  w.el.classList.add('td-window');
  mountTokenDesigner(w.body, {
    unlocks,
    upload: uploadImage,
    loadTokens: async () => { try { return (await call(socket, 'tokens:get', {})).tokens; } catch { return null; } },
    saveTokens: async (list) => (await call(socket, 'tokens:save', { tokens: list })).tokens,
    whereText: (server) => (server ? 'Your tokens go with your login, into any game on this server.' : 'Your tokens are kept in this browser, for any game you play here.'),
    actions: [
      { label: 'Put on the map', show: () => store.isGM, run: async (t) => {
        const at = placeAt?.() || {};
        await call(socket, 'token:add', { label: t.name, image: t.image, framed: true, color: '#202024', ...at });
        toast(`${t.name} is on the map`);
      } },
      { label: 'Use for my character', show: () => (store.sheets || []).some((s) => store.isGM || s.owner === store.me), run: async (t) => {
        const mine = (store.sheets || []).filter((s) => (store.isGM ? true : s.owner === store.me));
        const sheet = mine.length === 1 ? mine[0] : await pickSheet(mine);
        if (!sheet) return;
        await call(socket, 'sheet:token', { sheetId: sheet.id, image: t.image });
        toast(`${sheet.data?.name || 'Your character'} uses ${t.name} now`);
      } },
    ],
  });
}

function pickSheet(list) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'td-pick';
    box.innerHTML = `<p>Which character?</p>${list.map((s, i) => `<button type="button" class="btn small-btn" data-i="${i}">${esc(s.data?.name || 'Unnamed')}</button>`).join('')}<button type="button" class="btn ghost small-btn" data-i="-1">Cancel</button>`;
    root.append(box);
    box.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; box.remove(); resolve(+b.dataset.i >= 0 ? list[+b.dataset.i] : null); };
  });
}

/**
 * Put the designer in `el`. `c`: unlocks() → { locked } or null; upload(file) → '/uploads/…'; loadTokens() → list,
 * or null to keep tokens in this browser; saveTokens(list) → the saved list; whereText(onServer); actions: buttons
 * for a saved token [{ label, show(), run(token) }].
 */
export function mountTokenDesigner(el, c) {
  ctx = c; root = el;
  design = { ...DEFAULT_TOKEN }; editing = null;
  el.innerHTML = `
    <div class="td">
      <div class="td-stage">
        <canvas class="td-canvas" width="${SIZE}" height="${SIZE}" aria-label="Your token"></canvas>
        <p class="muted small">Drag the picture to move it, scroll to zoom.</p>
        <div class="td-minis" aria-hidden="true"><canvas width="96" height="96"></canvas><canvas width="56" height="56"></canvas><canvas width="34" height="34"></canvas></div>
      </div>
      <div class="td-controls">
        <div class="td-row"><b>Picture</b>
          <label class="btn ghost file small-btn">Choose…<input type="file" accept="image/*" hidden id="td-photo"></label>
          <button type="button" class="btn ghost small-btn" id="td-photo-clear" hidden>Remove</button>
        </div>
        <label>Zoom <input type="range" min="0.3" max="4" step="0.01" data-t="zoom"></label>
        <label>Behind the picture <input type="color" data-t="bg"></label>
        <label class="wide">Rim <select data-t="rim"></select></label>
        <label>Rim colour <input type="color" data-t="c1"></label>
        <label>Second colour <input type="color" data-t="c2"></label>
        <label>Thickness <input type="range" min="0.04" max="0.24" step="0.005" data-t="width"></label>
        <label>Trim <select data-t="trim">${Object.entries(TRIMS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Glow <span class="td-row"><input type="checkbox" id="td-glow-on"><input type="color" data-t="glow"></span></label>
        <label class="wide">Name plate <input data-t="plate" maxlength="24" placeholder="Leave empty for none"></label>
        <label>Plate <input type="color" data-t="plateColor"></label>
        <label>Letters <input type="color" data-t="plateInk"></label>
        <form class="td-save wide" autocomplete="off">
          <input id="td-name" maxlength="40" placeholder="Name this token">
          <button class="btn primary small-btn" type="submit" id="td-save">Save to my tokens</button>
          <button class="btn ghost small-btn" type="button" id="td-new" title="Start a new token">New</button>
          <button class="btn ghost small-btn" type="button" id="td-download" title="Save the picture to your computer">Download</button>
        </form>
      </div>
      <div class="td-lib">
        <h4>Your tokens</h4>
        <div class="td-grid" id="td-grid"></div>
        <p class="muted small" id="td-where"></p>
      </div>
    </div>`;
  fillRims();
  for (const x of $$('[data-t]', el)) {
    x.addEventListener(x.type === 'color' || x.type === 'range' || x.tagName === 'INPUT' ? 'input' : 'change', () => {
      const f = x.dataset.t;
      let v = x.type === 'range' ? Number(x.value) : x.value;
      if (f === 'glow' && !$('#td-glow-on', el).checked) return;
      const next = { ...design, [f]: v };
      if (f === 'rim' && FINISHES[v]?.colors) [next.c1, next.c2] = FINISHES[v].colors; // a material in its own colours
      set(next);
    });
  }
  $('#td-glow-on', el).onchange = (e) => set({ ...design, glow: e.target.checked ? $('[data-t="glow"]', el).value : null });
  $('#td-photo', el).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { set({ ...design, photo: await ctx.upload(file), zoom: 1, ox: 0, oy: 0 }); } catch (err) { toast(err.message || "That picture didn't upload", true); }
  };
  $('#td-photo-clear', el).onclick = () => set({ ...design, photo: null });
  $('#td-new', el).onclick = () => { editing = null; $('#td-name', el).value = ''; set({ ...DEFAULT_TOKEN }); };
  $('.td-save', el).onsubmit = (e) => { e.preventDefault(); save(); };
  $('#td-download', el).onclick = async () => {
    const blob = await pngOf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${($('#td-name', el).value || 'token').replace(/[^\w -]+/g, '').trim() || 'token'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // drag to move the picture, wheel to zoom
  const cv = $('.td-canvas', el);
  cv.addEventListener('pointerdown', (e) => {
    if (!design.photo) return;
    cv.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = design.ox, oy = design.oy, k = (SIZE / cv.clientWidth) / (R * (1 - design.width));
    const move = (ev) => set({ ...design, ox: ox + (ev.clientX - sx) * k, oy: oy + (ev.clientY - sy) * k }, true);
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', (e) => { if (!design.photo) return; e.preventDefault(); set({ ...design, zoom: Math.min(4, Math.max(0.3, design.zoom * (e.deltaY < 0 ? 1.06 : 0.94))) }); }, { passive: false });
  $('#td-grid', el).onclick = async (e) => {
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const t = tokens.find((x) => x.id === card.dataset.id);
    if (!t) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'delete') { tokens = tokens.filter((x) => x !== t); if (editing === t.id) editing = null; store_(`Deleted ${t.name}`); return; }
    if (act != null && act !== 'edit') {
      try { await ctx.actions[+act].run(t); } catch (err) { toast(err.message, true); }
      return;
    }
    editing = t.id;
    $('#td-name', el).value = t.name;
    set(cleanTokenDesign(t.design));
  };
  loadLib();
  set(design);
}

/** The materials you've unlocked changed: refresh the rim list. */
export function tokenDesignerUnlocks() { if (root?.isConnected && ctx) { fillRims(); show(); } }

function fillRims() {
  const lock = ctx.unlocks?.()?.locked || {};
  const all = Object.entries(FINISHES);
  $('[data-t="rim"]', root).innerHTML = GROUPS.map(([g, label]) => `<optgroup label="${label}">${all.filter(([k]) => groupOf(k) === g).map(([k, v]) => `<option value="${k}"${lock[k] ? ' disabled' : ''}>${lock[k] ? `🔒 ${esc(v.label)} — ${esc(lock[k])}` : esc(v.label)}</option>`).join('')}</optgroup>`).join('');
}

let drawTicket = 0;
function set(d, quick = false) {
  design = cleanTokenDesign(d);
  if (!quick) show();
  draw();
}

function show() {
  if (!root?.isConnected) return;
  for (const x of $$('[data-t]', root)) {
    const f = x.dataset.t;
    if (f === 'glow') x.value = design.glow || '#7fd4ff';
    else x.value = design[f] ?? '';
  }
  $('#td-glow-on', root).checked = !!design.glow;
  $('#td-photo-clear', root).hidden = !design.photo;
  $('#td-save', root).textContent = editing ? 'Save changes' : 'Save to my tokens';
}

async function draw() {
  if (!root?.isConnected) return;
  const t = ++drawTicket;
  const photo = await loadImage(design.photo);
  if (t !== drawTicket || !root?.isConnected) return;
  const cv = $('.td-canvas', root);
  renderToken(cv, design, photo);
  // how it'll look small, on a map
  for (const m of $$('.td-minis canvas', root)) { const g = m.getContext('2d'); g.clearRect(0, 0, m.width, m.height); g.drawImage(cv, 0, 0, m.width, m.height); }
}

function pngOf() {
  return new Promise((resolve, reject) => $('.td-canvas', root).toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture"))), 'image/png'));
}

async function save() {
  const name = $('#td-name', root).value.trim() || design.plate || 'Token';
  const lock = ctx.unlocks?.()?.locked || {};
  const m = tokenMaterials(design).find((k) => lock[k]);
  if (m) { toast(`${FINISHES[m].label} isn't unlocked yet: ${lock[m]}`, true); return; }
  if (!editing && tokens.length >= MAX_TOKENS) { toast(`You can keep ${MAX_TOKENS} tokens: delete one first`, true); return; }
  try {
    const blob = await pngOf();
    const image = await ctx.upload(new File([blob], 'token.png', { type: 'image/png' }));
    const t = { id: editing || newId(), name, image, design };
    const i = tokens.findIndex((x) => x.id === t.id);
    if (i >= 0) tokens[i] = t; else tokens.unshift(t);
    editing = t.id;
    await store_(`Saved ${name}`);
    show();
  } catch (err) { toast(err.message || "That didn't save", true); }
}

async function loadLib() {
  const got = await ctx.loadTokens().catch(() => null);
  onServer = Array.isArray(got);
  tokens = onServer ? cleanTokenLib(got) : localLib();
  if (onServer && !tokens.length && localLib().length) { tokens = localLib(); store_(); }
  renderLib();
}

async function store_(msg) {
  tokens = cleanTokenLib(tokens);
  if (onServer) {
    try { tokens = cleanTokenLib(await ctx.saveTokens(tokens)); } catch (e) { toast(e.message, true); return; }
  } else keepLocal(tokens);
  renderLib();
  if (msg) toast(msg);
}

function renderLib() {
  if (!root?.isConnected) return;
  const acts = (ctx.actions || []).map((a, i) => [a, i]).filter(([a]) => !a.show || a.show());
  $('#td-grid', root).innerHTML = tokens.length ? tokens.map((t) => `
    <div class="td-card${t.id === editing ? ' on' : ''}" data-id="${t.id}">
      <img src="${esc(serverUrl(t.image))}" alt="" data-act="edit" title="Change this token">
      <span class="td-card-name">${esc(t.name)}</span>
      <span class="td-card-acts">${acts.map(([a, i]) => `<button type="button" class="btn small-btn" data-act="${i}">${esc(a.label)}</button>`).join('')}<button type="button" class="btn ghost small-btn" data-act="delete" title="Delete">✕</button></span>
    </div>`).join('') : '<p class="muted small">No tokens yet. Choose a picture, pick a rim, and save it.</p>';
  $('#td-where', root).textContent = ctx.whereText?.(onServer) || '';
}
