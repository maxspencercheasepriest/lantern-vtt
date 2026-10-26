import { serverUrl } from './net.js';
import { store, $, $$, call, toast } from './util.js';
import * as V from '/shared/vision.js';
import { initDraw, drawDown, drawMove, drawUp, renderDrawings, cancelDraw } from './draw.js';
import { initSight, computeViews, renderSightFog, renderWalls, tokenShown, seeingAsPlayer, sightOn, doorAt, toggleDoor, wallDown, wallMove, wallUp, wallHover, endChain, chaining } from './sight.js';

const images = new Map();
function img(url) {
  if (!url) return null;
  let i = images.get(url);
  if (!i) {
    i = new Image();
    i.onload = () => requestDraw();
    i.src = serverUrl(url);
    images.set(url, i);
  }
  return i.complete && i.naturalWidth ? i : null;
}

let canvas, ctx, socket, onTokenOpen;
let dpr = 1;
const view = { x: 40, y: 60, zoom: 0.6 }; // screen = world * zoom + (x, y)
let tool = 'select';
let selectedId = null;
let action = null; // current pointer action
let measure = null; // { a: {x,y}, b: {x,y}, until }
const pings = [];
let fogCanvas = null, fogKey = '';
let spaceHeld = false;
let fitted = false;

const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom });
const map = () => store.scene?.map;
const tokens = () => store.scene?.tokens || [];
const canMove = (t) => store.isGM || (!t.locked && (t.owners || []).some((o) => o === '*' || o === store.me));

export function initMap(s, opts) {
  socket = s;
  onTokenOpen = opts.onTokenOpen;
  canvas = $('#map');
  ctx = canvas.getContext('2d');
  new ResizeObserver(resize).observe(canvas);
  resize();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', dbl);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', wheel, { passive: false });

  $$('#toolbar [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  const mapApi = { zoom: () => view.zoom, requestDraw, toScreen: (x, y) => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y }) };
  window.__lantern_view = () => ({ ...view }); // read-only, for automated tests
  initDraw(s, mapApi);
  initSight(s, mapApi);
  $('#fog-undo').onclick = () => call(socket, 'fog:set', { undo: true }).catch((e) => toast(e.message, true));
  $('#zoom-in').onclick = () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25);
  $('#zoom-out').onclick = () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8);
  $('#zoom-fit').onclick = fit;

  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space') { spaceHeld = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
    if (e.key === 'Escape') { endChain(); return; }
    const keys = { v: 'select', m: 'measure', p: 'ping', d: 'draw', w: 'walls', r: 'reveal', h: 'hide' };
    const k = e.key.toLowerCase();
    if (keys[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if ((k === 'r' || k === 'h' || k === 'w') && !store.isGM) return;
      setTool(keys[k]);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && store.isGM && selectedId) {
      const t = tokens().find((x) => x.id === selectedId);
      if (t && confirm(`Delete token "${t.label || 'unnamed'}"?`)) call(socket, 'token:remove', { id: t.id }).catch((er) => toast(er.message, true));
    }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceHeld = false; canvas.style.cursor = ''; } });

  let lastMapKey = '';
  store.on('scene', () => {
    const m = store.scene?.map;
    const key = m ? `${m.image}|${m.width}x${m.height}` : '';
    if (m && (!fitted || key !== lastMapKey)) { fitted = true; fit(); } // new map: frame it
    lastMapKey = key;
    requestDraw();
  });
  store.on('ping', (p) => { pings.push({ ...p, t0: performance.now() }); requestDraw(); });
}

export const getSelectedTokenId = () => selectedId;

export function setTool(t) {
  if (tool === 'walls' && t !== 'walls') endChain();
  tool = t;
  $$('#toolbar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  $('#draw-opts').hidden = t !== 'draw';
  $('#wall-opts').hidden = t !== 'walls';
  canvas.style.cursor = t === 'select' ? '' : 'crosshair';
  requestDraw();
}

export function viewCenter() {
  return toWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
}

export function fit() {
  const m = map();
  if (!m) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  view.zoom = Math.min(w / m.width, h / m.height) * 0.92;
  view.x = (w - m.width * view.zoom) / 2;
  view.y = (h - m.height * view.zoom) / 2;
  requestDraw();
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  requestDraw();
}

function zoomAt(sx, sy, factor) {
  const z = Math.min(6, Math.max(0.08, view.zoom * factor));
  const w = toWorld(sx, sy);
  view.zoom = z;
  view.x = sx - w.x * z;
  view.y = sy - w.y * z;
  requestDraw();
}

function wheel(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  else { view.x -= e.deltaX; requestDraw(); }
}

function local(e) {
  const r = canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

function tokenAt(wx, wy) {
  const g = map().gridSize;
  const list = tokens();
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    const s = t.size * g;
    const cx = t.x + s / 2, cy = t.y + s / 2;
    if ((wx - cx) ** 2 + (wy - cy) ** 2 <= (s / 2) ** 2) return t;
  }
  return null;
}

function snapCenter(p) {
  const m = map();
  const g = m.gridSize;
  return {
    x: Math.floor((p.x - m.offsetX) / g) * g + m.offsetX + g / 2,
    y: Math.floor((p.y - m.offsetY) / g) * g + m.offsetY + g / 2,
  };
}

// Snap a token's top-left so it sits neatly on the grid.
// Odd-sized tokens centre on a cell, even-sized ones on a grid intersection; tiny tokens use a sub-grid.
export function snapToken(t, x, y) {
  const m = map(), g = m.gridSize;
  if (t.size < 1) {
    const step = g * t.size;
    return {
      x: Math.round((x - m.offsetX) / step) * step + m.offsetX,
      y: Math.round((y - m.offsetY) / step) * step + m.offsetY,
    };
  }
  const s = t.size * g;
  const align = Math.round(t.size) % 2 ? g / 2 : 0;
  const cx = Math.round((x + s / 2 - m.offsetX - align) / g) * g + m.offsetX + align;
  const cy = Math.round((y + s / 2 - m.offsetY - align) / g) * g + m.offsetY + align;
  return { x: cx - s / 2, y: cy - s / 2 };
}

// ---- touch (tablets): two fingers pinch-zoom and pan; a long press is the touch version of right-click ----
const touches = new Map(); // pointerId -> {sx, sy}
let pinch = null;
let longPress = null;
const pinchInfo = () => {
  const [a, b] = [...touches.values()];
  return { d: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
};
function touchDown(e) {
  if (e.pointerType !== 'touch') return false;
  const p = local(e);
  touches.set(e.pointerId, p);
  if (touches.size === 2) {
    clearTimeout(longPress?.timer); longPress = null;
    action = null; // a second finger turns whatever the first was doing into a pinch
    cancelDraw();
    const i = pinchInfo();
    pinch = { ...i, zoom: view.zoom, vx: view.x, vy: view.y };
    return true;
  }
  if (touches.size > 2) return true;
  clearTimeout(longPress?.timer);
  longPress = {
    sx: p.sx, sy: p.sy,
    timer: setTimeout(() => {
      const w = toWorld(p.sx, p.sy);
      const t = tokenAt(w.x, w.y);
      if (t && touches.size === 1) { action = null; navigator.vibrate?.(15); onTokenOpen(t); }
      longPress = null;
    }, 550),
  };
  return false;
}
function touchMove(e) {
  if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return false;
  const p = local(e);
  touches.set(e.pointerId, p);
  if (longPress && Math.hypot(p.sx - longPress.sx, p.sy - longPress.sy) > 8) { clearTimeout(longPress.timer); longPress = null; }
  if (pinch && touches.size === 2) {
    const i = pinchInfo();
    const z = Math.min(6, Math.max(0.08, pinch.zoom * (i.d / pinch.d)));
    // keep the point that was under the fingers' midpoint under it, then follow the midpoint
    const wx = (pinch.mx - pinch.vx) / pinch.zoom, wy = (pinch.my - pinch.vy) / pinch.zoom;
    view.zoom = z;
    view.x = i.mx - wx * z;
    view.y = i.my - wy * z;
    requestDraw();
    return true;
  }
  return !!pinch;
}
function touchUp(e) {
  if (e.pointerType !== 'touch') return false;
  touches.delete(e.pointerId);
  clearTimeout(longPress?.timer); longPress = null;
  if (pinch) { if (touches.size < 2) { pinch = null; action = null; } return true; }
  return false;
}

let lastMoveSent = 0;
function down(e) {
  if (!store.scene) return;
  canvas.setPointerCapture(e.pointerId);
  if (touchDown(e)) return;
  const { sx, sy } = local(e);
  const w = toWorld(sx, sy);
  if (e.button === 2 && tool === 'walls' && chaining()) { endChain(); return; }
  if (e.button === 1 || e.button === 2 || spaceHeld) {
    const t = e.button === 2 ? tokenAt(w.x, w.y) : null;
    action = { type: 'pan', sx, sy, vx: view.x, vy: view.y, moved: false, rightToken: t };
    return;
  }
  if (e.altKey || tool === 'ping') {
    socket.emit('ping', w);
    return;
  }
  if (tool === 'measure') {
    const a = snapCenter(w);
    measure = { a, b: a };
    action = { type: 'measure' };
    requestDraw();
    return;
  }
  if ((tool === 'reveal' || tool === 'hide') && store.isGM) {
    action = { type: 'fog', mode: tool, a: w, b: w };
    return;
  }
  if (tool === 'draw') {
    if (drawDown(w, e)) action = { type: 'draw' };
    requestDraw();
    return;
  }
  if (tool === 'walls' && store.isGM) {
    if (wallDown(w, view.zoom, e)) action = { type: 'walls' };
    requestDraw();
    return;
  }
  // doors open and close with a click
  const door = doorAt(w, view.zoom, lastViews);
  if (door) { toggleDoor(door); return; }
  const t = tokenAt(w.x, w.y);
  selectedId = t?.id || null;
  if (t && canMove(t)) {
    action = { type: 'drag', id: t.id, dx: w.x - t.x, dy: w.y - t.y, x: t.x, y: t.y, moved: false, size: t.size };
  } else {
    action = { type: 'pan', sx, sy, vx: view.x, vy: view.y };
  }
  requestDraw();
}

function move(e) {
  if (touchMove(e)) return;
  if (!action) {
    if (tool === 'walls' && chaining()) { const { sx, sy } = local(e); wallHover(toWorld(sx, sy), view.zoom, e); requestDraw(); }
    return;
  }
  const { sx, sy } = local(e);
  const w = toWorld(sx, sy);
  if (action.type === 'draw') { drawMove(w); requestDraw(); return; }
  if (action.type === 'walls') { wallMove(w, view.zoom, e); requestDraw(); return; }
  if (action.type === 'pan') {
    if (Math.abs(sx - action.sx) + Math.abs(sy - action.sy) > 3) action.moved = true;
    view.x = action.vx + (sx - action.sx);
    view.y = action.vy + (sy - action.sy);
  } else if (action.type === 'drag') {
    const nx = w.x - action.dx, ny = w.y - action.dy;
    // line of sight: players' tokens stop at walls and closed doors
    if (!store.isGM && sightOn()) {
      const half = (action.size * map().gridSize) / 2;
      if (V.crossesWall([action.x + half, action.y + half], [nx + half, ny + half], store.scene)) { requestDraw(); return; }
    }
    action.x = nx;
    action.y = ny;
    action.moved = true;
    const now = performance.now();
    if (now - lastMoveSent > 70) {
      lastMoveSent = now;
      socket.emit('token:move', { id: action.id, x: action.x, y: action.y });
    }
  } else if (action.type === 'measure') {
    measure.b = snapCenter(w);
  } else if (action.type === 'fog') {
    action.b = w;
  }
  requestDraw();
}

function up(e) {
  if (touchUp(e)) return;
  if (!action) return;
  const a = action;
  action = null;
  if (a.type === 'draw') { drawUp(); requestDraw(); return; }
  if (a.type === 'walls') { const { sx, sy } = local(e); wallUp(toWorld(sx, sy), view.zoom, e); requestDraw(); return; }
  if (a.type === 'pan' && !a.moved && a.rightToken && store.isGM) onTokenOpen(a.rightToken);
  if (a.type === 'drag' && a.moved) {
    const t = tokens().find((x) => x.id === a.id);
    let { x, y } = a;
    if (!e.shiftKey && t) {
      const snapped = snapToken(t, x, y);
      // don't let snapping nudge a token through a wall
      const half = (t.size * map().gridSize) / 2;
      if (store.isGM || !sightOn() || !V.crossesWall([a.x + half, a.y + half], [snapped.x + half, snapped.y + half], store.scene)) ({ x, y } = snapped);
    }
    if (t) { t.x = x; t.y = y; } // optimistic
    call(socket, 'token:move', { id: a.id, x, y, final: true }).catch((er) => toast(er.message, true));
  }
  if (a.type === 'measure') {
    measure.until = performance.now() + 1500;
    requestDraw();
  }
  if (a.type === 'fog') {
    const x = Math.min(a.a.x, a.b.x), y = Math.min(a.a.y, a.b.y);
    const w = Math.abs(a.b.x - a.a.x), h = Math.abs(a.b.y - a.a.y);
    if (w > 4 && h > 4) call(socket, 'fog:op', { type: a.mode, x, y, w, h }).catch((er) => toast(er.message, true));
  }
  requestDraw();
}

function dbl(e) {
  if (tool === 'walls') { endChain(); return; }
  const { sx, sy } = local(e);
  const w = toWorld(sx, sy);
  const t = tokenAt(w.x, w.y);
  if (t) onTokenOpen(t);
}

// ---------- drawing ----------
let drawQueued = false;
export function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}

let lastViews = [];
function buildFog(m, fog) {
  const key = `${m.width}x${m.height}:${fog.ops.length}:${JSON.stringify(fog.ops.slice(-3))}`;
  if (key === fogKey && fogCanvas) return fogCanvas;
  fogKey = key;
  const scale = Math.min(1, 2048 / Math.max(m.width, m.height)); // fog doesn't need full resolution
  fogCanvas = fogCanvas || document.createElement('canvas');
  fogCanvas.width = Math.ceil(m.width * scale);
  fogCanvas.height = Math.ceil(m.height * scale);
  fogCanvas.scale = scale;
  const f = fogCanvas.getContext('2d');
  f.globalCompositeOperation = 'source-over';
  f.fillStyle = '#050507';
  f.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
  for (const op of fog.ops) {
    f.globalCompositeOperation = op.type === 'reveal' ? 'destination-out' : 'source-over';
    if (op.poly) {
      f.beginPath();
      f.moveTo(op.poly[0] * scale, op.poly[1] * scale);
      for (let i = 2; i + 1 < op.poly.length; i += 2) f.lineTo(op.poly[i] * scale, op.poly[i + 1] * scale);
      f.closePath();
      f.fill();
    } else f.fillRect(op.x * scale, op.y * scale, op.w * scale, op.h * scale);
  }
  return fogCanvas;
}

function draw() {
  drawQueued = false;
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const m = map();
  if (!m) return;
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
  const z = view.zoom;

  // map
  const mi = img(m.image);
  if (mi) ctx.drawImage(mi, 0, 0, m.width, m.height);
  else {
    ctx.fillStyle = '#1b1b1f';
    ctx.fillRect(0, 0, m.width, m.height);
  }

  // grid
  if (m.showGrid && m.gridOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = mi ? m.gridOpacity : Math.max(m.gridOpacity, 0.25);
    ctx.strokeStyle = mi ? m.gridColor : '#55555f';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    const g = m.gridSize;
    const ox = ((m.offsetX % g) + g) % g, oy = ((m.offsetY % g) + g) % g;
    for (let x = ox; x <= m.width; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, m.height); }
    for (let y = oy; y <= m.height; y += g) { ctx.moveTo(0, y); ctx.lineTo(m.width, y); }
    ctx.stroke();
    ctx.restore();
  }

  // drawings sit on the map, under the tokens
  renderDrawings(ctx, z);

  // what the party can see (line of sight)
  const views = computeViews(action?.type === 'drag' ? action : null);
  lastViews = views;

  // tokens
  const g = m.gridSize;
  const c = store.combat;
  const turnToken = c?.active && c.turn >= 0 ? c.entries[c.turn]?.tokenId : null;
  for (const t of tokens()) {
    const pos = action?.type === 'drag' && action.id === t.id ? action : t;
    if (!tokenShown({ ...t, x: pos.x, y: pos.y }, views, g)) continue;
    const s = t.size * g;
    const cx = pos.x + s / 2, cy = pos.y + s / 2, r = s / 2;
    ctx.save();
    if (t.hidden) ctx.globalAlpha = 0.5;
    ctx.shadowColor = '#000a';
    ctx.shadowBlur = s * 0.08 * z * dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
    ctx.fillStyle = t.color || '#c0392b';
    ctx.fill();
    ctx.shadowBlur = 0;
    const ti = img(t.image);
    if (ti) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
      ctx.clip();
      const d = s * 0.86; // clip diameter; scale image to cover it
      const k = Math.max(d / ti.naturalWidth, d / ti.naturalHeight);
      const iw = ti.naturalWidth * k, ih = ti.naturalHeight * k;
      ctx.drawImage(ti, cx - iw / 2, cy - ih / 2, iw, ih);
      ctx.restore();
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${s * 0.36}px "IBM Plex Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(t.label), cx, cy + s * 0.02);
    }
    if (t.id === turnToken) {
      // whose turn it is in combat
      ctx.save();
      ctx.lineWidth = Math.max(3 / z, s * 0.07);
      ctx.strokeStyle = '#e8a33d';
      ctx.shadowColor = '#e8a33d';
      ctx.shadowBlur = s * 0.3 * z * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.08, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = Math.max(2 / z, s * 0.04);
    ctx.strokeStyle = t.id === selectedId ? '#f3c26b' : '#0009';
    if (t.hidden) ctx.setLineDash([s * 0.08, s * 0.06]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // health bar
    if (t.bar && t.bar.max > 0) {
      const frac = Math.max(0, Math.min(1, t.bar.cur / t.bar.max));
      const bw = s * 0.8, bh = Math.max(4 / z, s * 0.08), bx = cx - bw / 2, by = pos.y - bh * 0.5;
      ctx.fillStyle = '#000b';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = frac > 0.5 ? '#6fbf73' : frac > 0.25 ? '#e8a33d' : '#d9534f';
      ctx.fillRect(bx, by, bw * frac, bh);
    }
    // label
    if (t.label) {
      const fs = Math.max(12 / z, g * 0.2);
      ctx.font = `500 ${fs}px "IBM Plex Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(t.label).width;
      ctx.fillStyle = '#000b';
      ctx.fillRect(cx - tw / 2 - fs * 0.3, pos.y + s + fs * 0.1, tw + fs * 0.6, fs * 1.3);
      ctx.fillStyle = '#fff';
      ctx.fillText(t.label, cx, pos.y + s + fs * 0.25);
    }
    ctx.restore();
  }

  // fog
  const fog = store.scene.fog;
  if (fog.mode === 'sight') {
    if (seeingAsPlayer()) renderSightFog(ctx, views);
  } else if (fog.mode === 'manual') {
    const fc = buildFog(m, fog);
    ctx.save();
    ctx.globalAlpha = store.isGM ? 0.5 : 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fc, 0, 0, m.width, m.height);
    ctx.restore();
  }

  // walls (GM) and door markers (everyone who can see them)
  renderWalls(ctx, z, tool === 'walls', views);

  // fog rectangle in progress
  if (action?.type === 'fog') {
    const x = Math.min(action.a.x, action.b.x), y = Math.min(action.a.y, action.b.y);
    const w = Math.abs(action.b.x - action.a.x), h = Math.abs(action.b.y - action.a.y);
    ctx.save();
    ctx.fillStyle = action.mode === 'reveal' ? '#e8a33d33' : '#00000099';
    ctx.strokeStyle = '#e8a33d';
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([8 / z, 6 / z]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  const now = performance.now();
  let animating = false;

  // measure
  if (measure) {
    if (measure.until && now > measure.until) measure = null;
    else {
      animating = !!measure.until;
      const { a, b } = measure;
      ctx.save();
      ctx.strokeStyle = '#f3c26b';
      ctx.lineWidth = 3 / z;
      ctx.setLineDash([10 / z, 6 / z]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f3c26b';
      ctx.beginPath(); ctx.arc(a.x, a.y, 5 / z, 0, Math.PI * 2); ctx.fill();
      const sq = Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / g);
      const label = `${sq} sq · ${+(sq * m.unitsPerSquare).toFixed(2)} ${m.unitName}`;
      const fs = 14 / z;
      ctx.font = `600 ${fs}px "IBM Plex Mono", monospace`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = '#18181bee';
      ctx.fillRect(b.x + 10 / z, b.y - fs * 1.6, tw + fs, fs * 1.6);
      ctx.fillStyle = '#f3c26b';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, b.x + 10 / z + fs / 2, b.y - fs * 0.8);
      ctx.restore();
    }
  }

  // pings
  for (let i = pings.length - 1; i >= 0; i--) {
    const p = pings[i];
    const t = (now - p.t0) / 1600;
    if (t >= 1) { pings.splice(i, 1); continue; }
    animating = true;
    ctx.save();
    for (const k of [0, 0.3]) {
      const tt = (t + k) % 1;
      ctx.globalAlpha = 1 - tt;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 / z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (10 + tt * 60) / z, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.font = `600 ${13 / z}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - 22 / z);
    ctx.restore();
  }

  if (animating) requestDraw();
}

const initials = (s) => (s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
