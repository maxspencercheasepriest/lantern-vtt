// Drawing on the map: pen, line, arrow, rectangle, circle, text and eraser.
// Drawings belong to the scene. The GM's can be private (GM only); players can draw when the scene allows it.
import { $, $$, store, call, toast } from './util.js';

const KEY = 'lantern.draw';
export const opts = { shape: 'free', color: '#e8a33d', width: 4, fill: false, gmOnly: false };
try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
const saveOpts = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch { /* ignore */ } };

let socket;
let pending = null; // the shape being drawn: { kind, pts, ... }
let textBox = null;
let api = null;     // { toScreen, requestDraw, zoom() }

export function initDraw(s, mapApi) {
  socket = s;
  api = mapApi;
  const bar = $('#draw-opts');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shape]');
    if (b) { opts.shape = b.dataset.shape; saveOpts(); syncBar(); }
    const c = e.target.closest('[data-color]');
    if (c) { opts.color = c.dataset.color; $('#draw-color').value = opts.color; saveOpts(); syncBar(); }
  });
  $('#draw-color').oninput = (e) => { opts.color = e.target.value; saveOpts(); syncBar(); };
  $('#draw-width').oninput = (e) => { opts.width = +e.target.value; saveOpts(); };
  $('#draw-fill').onchange = (e) => { opts.fill = e.target.checked; saveOpts(); };
  $('#draw-gm').onchange = (e) => { opts.gmOnly = e.target.checked; saveOpts(); };
  $('#draw-clear-mine').onclick = () => call(socket, 'draw:clear', { mine: true }).catch(fail);
  $('#draw-clear-all').onclick = () => confirm('Clear every drawing on this scene, including the players\'?') && call(socket, 'draw:clear', {}).catch(fail);
  $('#draw-players').onchange = (e) => call(socket, 'scene:update', { id: store.scene.id, playerDraw: e.target.checked }).catch(fail);
  store.on('scene', () => { $('#draw-players').checked = store.scene?.playerDraw !== false; });
  syncBar();
}
const fail = (e) => toast(e.message, true);

function syncBar() {
  $$('#draw-opts [data-shape]').forEach((b) => b.classList.toggle('active', b.dataset.shape === opts.shape));
  $$('#draw-opts [data-color]').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === opts.color.toLowerCase()));
  $('#draw-color').value = opts.color;
  $('#draw-width').value = opts.width;
  $('#draw-fill').checked = opts.fill;
  $('#draw-gm').checked = opts.gmOnly;
}

/** Can I draw here right now? */
export const canDraw = () => store.isGM || store.scene?.playerDraw !== false;

// ---------- pointer handling (world coordinates) ----------
export function drawDown(w, e) {
  if (!canDraw()) { toast('The GM has turned off drawing on this scene', true); return false; }
  const z = api.zoom();
  if (opts.shape === 'erase') { pending = { kind: 'erase', hits: new Set() }; eraseAt(w, z); return true; }
  if (opts.shape === 'text') { openTextBox(w, e); return false; }
  pending = { kind: opts.shape, pts: [w.x, w.y, w.x, w.y], color: opts.color, width: opts.width, fill: opts.fill };
  return true;
}
export function drawMove(w) {
  if (!pending) return;
  const z = api.zoom();
  if (pending.kind === 'erase') return void eraseAt(w, z);
  if (pending.kind === 'free') {
    const n = pending.pts.length;
    if (Math.hypot(w.x - pending.pts[n - 2], w.y - pending.pts[n - 1]) * z >= 2) pending.pts.push(w.x, w.y);
  } else {
    pending.pts[2] = w.x; pending.pts[3] = w.y;
  }
}
export function drawUp() {
  const p = pending;
  pending = null;
  if (!p) return;
  if (p.kind === 'erase') {
    if (p.hits.size) call(socket, 'draw:remove', { ids: [...p.hits] }).catch(fail);
    return;
  }
  let pts = p.pts;
  if (p.kind === 'free') pts = simplify(pts, 0.8 / api.zoom());
  const [x1, y1] = pts, x2 = pts[pts.length - 2], y2 = pts[pts.length - 1];
  if (p.kind !== 'free' && Math.hypot(x2 - x1, y2 - y1) * api.zoom() < 4) return; // a click, not a shape
  if (p.kind === 'free' && pts.length < 4) return;
  if (pts.length > 4000) pts = pts.slice(0, 4000);
  call(socket, 'draw:add', { kind: p.kind, pts: pts.map((v) => Math.round(v * 10) / 10), color: p.color, width: p.width, fill: p.fill, gmOnly: store.isGM && opts.gmOnly }).catch(fail);
}
export const drawing = () => !!pending;
/** A second finger landed: this was a pinch, not a stroke. */
export function cancelDraw() { pending = null; }

function eraseAt(w, z) {
  const d = hitDrawing(w.x, w.y, 10 / z);
  if (d && (store.isGM || d.author === store.me)) { pending.hits.add(d.id); api.requestDraw(); }
}

// Ramer–Douglas–Peucker: fewer points, same line
function simplify(pts, eps) {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    let best = -1, bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The topmost drawing under a point, within `tol` world units. */
export function hitDrawing(x, y, tol) {
  const list = store.scene?.drawings || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    const p = d.pts, r = d.width / 2 + tol;
    if (d.kind === 'free' || d.kind === 'line' || d.kind === 'arrow') {
      for (let k = 0; k + 3 < p.length; k += 2) if (segDist(x, y, p[k], p[k + 1], p[k + 2], p[k + 3]) <= r) return d;
    } else if (d.kind === 'rect') {
      const x1 = Math.min(p[0], p[2]), x2 = Math.max(p[0], p[2]), y1 = Math.min(p[1], p[3]), y2 = Math.max(p[1], p[3]);
      const inside = x >= x1 && x <= x2 && y >= y1 && y <= y2;
      const edge = Math.min(segDist(x, y, x1, y1, x2, y1), segDist(x, y, x2, y1, x2, y2), segDist(x, y, x2, y2, x1, y2), segDist(x, y, x1, y2, x1, y1));
      if ((d.fill && inside) || edge <= r) return d;
    } else if (d.kind === 'ellipse') {
      const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2, rx = Math.abs(p[2] - p[0]) / 2 || 1, ry = Math.abs(p[3] - p[1]) / 2 || 1;
      const k = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
      if ((d.fill && k <= 1) || Math.abs(k - 1) * Math.min(rx, ry) <= r) return d;
    } else if (d.kind === 'text') {
      const w = (d.text.length * d.size * 0.55), h = d.size * 1.2;
      if (x >= p[0] - tol && x <= p[0] + w + tol && y >= p[1] - tol && y <= p[1] + h + tol) return d;
    }
  }
  return null;
}

// ---------- text ----------
function openTextBox(w, e) {
  closeTextBox();
  const stage = $('.stage');
  const r = stage.getBoundingClientRect();
  const s = api.toScreen(w.x, w.y);
  const size = textSize();
  const box = document.createElement('input');
  box.className = 'draw-textbox';
  box.placeholder = 'Type, then Enter';
  box.maxLength = 300;
  Object.assign(box.style, { left: `${s.x}px`, top: `${s.y}px`, color: opts.color, fontSize: `${Math.max(12, Math.min(48, size * api.zoom()))}px` });
  stage.append(box);
  textBox = box;
  setTimeout(() => box.focus(), 0);
  const submit = () => {
    const text = box.value.trim();
    closeTextBox();
    if (text) call(socket, 'draw:add', { kind: 'text', pts: [w.x, w.y], text, size, color: opts.color, width: opts.width, gmOnly: store.isGM && opts.gmOnly }).catch(fail);
  };
  box.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') submit(); if (ev.key === 'Escape') closeTextBox(); };
  box.onblur = submit;
  void e;
}
function closeTextBox() { if (textBox) { const b = textBox; textBox = null; b.onblur = null; b.remove(); } }
const textSize = () => Math.round(((store.scene?.map.gridSize || 70) * 0.35) * (0.5 + opts.width / 8));

// ---------- rendering ----------
export function renderDrawings(ctx, z) {
  const list = store.scene?.drawings || [];
  const erasing = pending?.kind === 'erase' ? pending.hits : null;
  for (const d of list) {
    ctx.save();
    if (erasing?.has(d.id)) ctx.globalAlpha = 0.25;
    else if (d.gmOnly) ctx.globalAlpha = 0.75;
    paint(ctx, d, z);
    if (d.gmOnly && store.isGM) {
      // a small "GM" tag so private drawings are recognisable
      const [x, y] = d.pts;
      ctx.globalAlpha = 0.9;
      ctx.font = `600 ${10 / z}px "IBM Plex Sans", sans-serif`;
      ctx.fillStyle = '#18181b';
      ctx.fillRect(x - 1 / z, y - 17 / z, 22 / z, 12 / z);
      ctx.fillStyle = '#f3c26b';
      ctx.fillText('GM', x + 2 / z, y - 8 / z);
    }
    ctx.restore();
  }
  if (pending && pending.kind !== 'erase') { ctx.save(); ctx.globalAlpha = 0.85; paint(ctx, pending, z); ctx.restore(); }
}

function paint(ctx, d, z) {
  const p = d.pts;
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = d.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (d.kind === 'free' || d.kind === 'line' || d.kind === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let k = 2; k + 1 < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
    ctx.stroke();
    if (d.kind === 'arrow') {
      const n = p.length;
      const x2 = p[n - 2], y2 = p[n - 1], x1 = p[n - 4], y1 = p[n - 3];
      const a = Math.atan2(y2 - y1, x2 - x1), h = Math.max(d.width * 3.5, 14 / z);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45));
      ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45));
      ctx.closePath();
      ctx.fill();
    }
  } else if (d.kind === 'rect') {
    const x = Math.min(p[0], p[2]), y = Math.min(p[1], p[3]), w = Math.abs(p[2] - p[0]), h = Math.abs(p[3] - p[1]);
    if (d.fill) { ctx.globalAlpha *= 0.35; ctx.fillRect(x, y, w, h); ctx.globalAlpha /= 0.35; }
    ctx.strokeRect(x, y, w, h);
  } else if (d.kind === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, Math.abs(p[2] - p[0]) / 2, Math.abs(p[3] - p[1]) / 2, 0, 0, Math.PI * 2);
    if (d.fill) { ctx.globalAlpha *= 0.35; ctx.fill(); ctx.globalAlpha /= 0.35; }
    ctx.stroke();
  } else if (d.kind === 'text') {
    ctx.font = `600 ${d.size}px "IBM Plex Sans", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = Math.max(2, d.size / 8);
    ctx.strokeStyle = '#000c';
    ctx.strokeText(d.text, p[0], p[1]);
    ctx.fillText(d.text, p[0], p[1]);
  }
}
