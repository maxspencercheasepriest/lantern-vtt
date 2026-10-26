// Walls, doors and line-of-sight fog.
//  - The GM traces walls and doors with the Walls tool (snaps to wall ends and grid points; Shift for freehand).
//  - With the scene's fog set to "Line of sight", players see only what their tokens can see. Places the
//    party has seen stay dimly visible; everything else is dark. Enemy tokens out of sight aren't drawn.
//  - Anyone can click a door to open or close it, unless the GM has locked it.
import { $, $$, store, call, toast } from './util.js';
import * as V from '/shared/vision.js';

let socket, api;
const fail = (e) => toast(e.message, true);
export const wallOpts = { mode: 'wall' };
let gmPreview = false;   // GM: show the players' view
let chain = null;        // [x, y] — the start of the next wall when clicking point to point
let dragging = null;     // { a, b, moved }
let hover = null;        // where the next wall would end, while chaining

export function initSight(s, mapApi) {
  socket = s;
  api = mapApi;
  $('#wall-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wmode]');
    if (b) { wallOpts.mode = b.dataset.wmode; endChain(); syncBar(); }
  });
  $('#wall-clear').onclick = () => confirm('Remove every wall and door on this scene?') && call(socket, 'wall:clear', {}).catch(fail);
  $('#wall-undo').onclick = () => {
    const last = store.scene?.walls.at(-1);
    if (last) call(socket, 'wall:remove', { id: last.id }).catch(fail);
  };
  $('#sight-preview').onclick = () => { gmPreview = !gmPreview; $('#sight-preview').classList.toggle('active', gmPreview); api.requestDraw(); };
  syncBar();
}
function syncBar() {
  $$('#wall-opts [data-wmode]').forEach((b) => b.classList.toggle('active', b.dataset.wmode === wallOpts.mode));
}

const sceneNow = () => store.scene;
export const sightOn = () => sceneNow()?.fog?.mode === 'sight';
/** Am I seeing the world through tokens' eyes right now? */
export const seeingAsPlayer = () => sightOn() && (!store.isGM || gmPreview);

// ---------- views (what's visible), cached ----------
let segCache = { scene: null, walls: null, segs: [], key: '' };
function segments(sc) {
  if (segCache.walls !== sc.walls || segCache.w !== sc.map.width || segCache.h !== sc.map.height) {
    segCache = { walls: sc.walls, w: sc.map.width, h: sc.map.height, segs: V.blockingSegments(sc), key: Math.random().toString(36).slice(2) };
  }
  return segCache;
}
const polyCache = new Map(); // `${segKey}:${x}:${y}` -> polygon

/** The viewpoints players see through, with their visibility polygons. `drag` overrides one token's position. */
export function computeViews(drag) {
  const sc = sceneNow();
  if (!sc || !sightOn()) return [];
  const { segs, key } = segments(sc);
  const g = sc.map.gridSize;
  const mine = (t) => (t.owners || []).some((o) => o === store.me || o === '*');
  const shared = sc.fog.shared !== false;
  const views = [];
  for (const t of sc.tokens) {
    if (t.hidden || !V.isPlayerToken(t)) continue;
    if (!store.isGM && !shared && !mine(t)) continue;
    const pos = drag && drag.id === t.id ? drag : t;
    const origin = V.tokenCenter({ ...t, x: pos.x, y: pos.y }, g);
    const k = `${key}:${Math.round(origin[0])}:${Math.round(origin[1])}`;
    let poly = polyCache.get(k);
    if (!poly) {
      poly = V.visibilityPolygon(origin, segs);
      if (polyCache.size > 400) polyCache.clear();
      polyCache.set(k, poly);
    }
    views.push({ origin, poly, id: t.id });
  }
  return views;
}
export const radiusWorld = () => (sceneNow()?.fog.radius || 0) * (sceneNow()?.map.gridSize || 70);

/** Should this token be drawn for me? (Players don't see enemies their party can't see.) */
export function tokenShown(t, views, g) {
  if (!seeingAsPlayer()) return true;
  if (V.isPlayerToken(t)) return true; // the party can always see each other
  const [x, y] = V.tokenCenter(t, g);
  return V.pointVisible(x, y, views, radiusWorld());
}

// ---------- fog drawing ----------
let fogCanvas = null, fogKey = '';
let exCanvas = null, exKey = '';
function exploredCanvas(sc) {
  const ex = sc.fog.explored;
  const k = ex ? `${ex.cols}x${ex.rows}:${ex.bits.length}:${hashStr(ex.bits)}` : 'none';
  if (k === exKey && exCanvas) return exCanvas;
  exKey = k;
  if (!ex) { exCanvas = null; return null; }
  const g = V.exploredGrid(sc);
  exCanvas = exCanvas || document.createElement('canvas');
  exCanvas.width = g.cols; exCanvas.height = g.rows;
  const c = exCanvas.getContext('2d');
  const img = c.createImageData(g.cols, g.rows);
  for (let r = 0; r < g.rows; r++) for (let col = 0; col < g.cols; col++) {
    if (V.isExplored(g, col, r)) img.data[(r * g.cols + col) * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  exCanvas.cell = g.cell;
  return exCanvas;
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 512))) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Darkness over everything players can't see; dimmer over places they've been. */
export function renderSightFog(ctx, views) {
  const sc = sceneNow();
  const m = sc.map;
  const scale = Math.min(1, 2048 / Math.max(m.width, m.height));
  const radius = radiusWorld();
  const key = `${m.width}x${m.height}:${radius}:${exKey}:${views.map((v) => `${Math.round(v.origin[0])},${Math.round(v.origin[1])},${v.poly.length}`).join('|')}:${segCache.key}`;
  const ex = exploredCanvas(sc);
  if (key !== fogKey || !fogCanvas) {
    fogKey = key;
    fogCanvas = fogCanvas || document.createElement('canvas');
    fogCanvas.width = Math.ceil(m.width * scale);
    fogCanvas.height = Math.ceil(m.height * scale);
    const f = fogCanvas.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.fillStyle = '#050507';
    f.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
    f.globalCompositeOperation = 'destination-out';
    if (ex) {
      f.globalAlpha = 0.45; // explored: the map shows through, dimmed
      f.imageSmoothingEnabled = true;
      f.drawImage(ex, 0, 0, ex.width * ex.cell * scale, ex.height * ex.cell * scale);
    }
    f.globalAlpha = 1;
    f.setTransform(scale, 0, 0, scale, 0, 0);
    for (const v of views) {
      if (v.poly.length < 3) continue;
      f.save();
      if (radius > 0) {
        f.beginPath();
        f.arc(v.origin[0], v.origin[1], radius, 0, Math.PI * 2);
        f.clip();
      }
      f.beginPath();
      f.moveTo(v.poly[0][0], v.poly[0][1]);
      for (let i = 1; i < v.poly.length; i++) f.lineTo(v.poly[i][0], v.poly[i][1]);
      f.closePath();
      f.fill();
      f.restore();
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if (store.isGM) ctx.globalAlpha = 0.85; // previewing: still just about see what's under it
  ctx.drawImage(fogCanvas, 0, 0, m.width, m.height);
  ctx.restore();
}

// ---------- walls and doors on the map ----------
const doorMid = (w) => [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];

/** Doors players can see (in sight, or somewhere they've explored). */
function doorVisible(w, views, sc) {
  if (store.isGM && !seeingAsPlayer()) return true;
  if (!sightOn()) return false; // without line of sight, doors don't matter to players
  const [x, y] = doorMid(w);
  // a door is in sight if either side of it is
  const nx = -(w.b[1] - w.a[1]), ny = w.b[0] - w.a[0];
  const len = Math.hypot(nx, ny) || 1, o = 6;
  const r = radiusWorld();
  if (V.pointVisible(x + (nx / len) * o, y + (ny / len) * o, views, r) || V.pointVisible(x - (nx / len) * o, y - (ny / len) * o, views, r)) return true;
  const g = V.exploredGrid(sc);
  return !!V.isExplored(g, Math.floor(x / g.cell), Math.floor(y / g.cell));
}

export function renderWalls(ctx, z, toolActive, views) {
  const sc = sceneNow();
  if (!sc) return;
  const walls = sc.walls || [];
  if (store.isGM && (toolActive || (sightOn() && !gmPreview))) {
    ctx.save();
    ctx.globalAlpha = toolActive ? 1 : 0.45;
    ctx.lineCap = 'round';
    for (const w of walls) {
      ctx.strokeStyle = w.kind === 'door' ? (w.open ? '#6fbf73' : '#e8a33d') : '#4fc3f7';
      ctx.lineWidth = (toolActive ? 4 : 3) / z;
      if (w.kind === 'door' && w.open) ctx.setLineDash([6 / z, 5 / z]);
      ctx.beginPath(); ctx.moveTo(w.a[0], w.a[1]); ctx.lineTo(w.b[0], w.b[1]); ctx.stroke();
      ctx.setLineDash([]);
      if (toolActive) {
        ctx.fillStyle = '#e0f7ff';
        for (const p of [w.a, w.b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 / z, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // the wall being drawn
    const a = dragging?.a || chain, b = dragging?.b || hover;
    if (toolActive && a && b && wallOpts.mode !== 'delete') {
      ctx.strokeStyle = wallOpts.mode === 'door' ? '#e8a33d' : '#4fc3f7';
      ctx.lineWidth = 4 / z;
      ctx.setLineDash([8 / z, 6 / z]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(a[0], a[1], 4 / z, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // door markers (clickable)
  for (const w of walls) {
    if (w.kind !== 'door' || !doorVisible(w, views, sc)) continue;
    const [x, y] = doorMid(w);
    const r = 11 / z;
    ctx.save();
    ctx.fillStyle = '#18181bee';
    ctx.strokeStyle = w.open ? '#6fbf73' : '#e8a33d';
    ctx.lineWidth = 2 / z;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `${13 / z}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(w.locked && !w.open ? '🔒' : w.open ? '◫' : '▮', x, y + 0.5 / z);
    ctx.restore();
  }
}

/** A door marker under the pointer, if any. */
export function doorAt(w, z, views) {
  const sc = sceneNow();
  for (const d of sc?.walls || []) {
    if (d.kind !== 'door' || !doorVisible(d, views, sc)) continue;
    const [x, y] = doorMid(d);
    if ((w.x - x) ** 2 + (w.y - y) ** 2 <= (13 / z) ** 2) return d;
  }
  return null;
}
export function toggleDoor(d) {
  if (!store.isGM && d.locked && !d.open) return toast('The door is locked', true);
  call(socket, 'door:toggle', { id: d.id }).catch(fail);
}

// ---------- the Walls tool (GM) ----------
function snap(w, z, e) {
  if (e?.shiftKey) return [w.x, w.y];
  const sc = sceneNow();
  // wall ends first, so walls join up
  let best = null, bestD = (12 / z) ** 2;
  for (const wall of sc.walls) for (const p of [wall.a, wall.b]) {
    const d = (p[0] - w.x) ** 2 + (p[1] - w.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) return [best[0], best[1]];
  // then grid corners and half-squares
  const m = sc.map, half = m.gridSize / 2;
  const gx = Math.round((w.x - m.offsetX) / half) * half + m.offsetX;
  const gy = Math.round((w.y - m.offsetY) / half) * half + m.offsetY;
  if ((gx - w.x) ** 2 + (gy - w.y) ** 2 <= (10 / z) ** 2) return [gx, gy];
  return [w.x, w.y];
}
function wallNear(w, z) {
  const sc = sceneNow();
  let best = null, bestD = 9 / z;
  for (const wall of sc.walls) {
    const d = distToSeg(w.x, w.y, wall.a, wall.b);
    if (d < bestD) { bestD = d; best = wall; }
  }
  return best;
}
function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
const addWall = (a, b) => {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return;
  call(socket, 'wall:add', { a, b, kind: wallOpts.mode === 'door' ? 'door' : 'wall' }).catch(fail);
};

export function wallDown(w, z, e) {
  if (wallOpts.mode === 'delete') {
    const wall = wallNear(w, z);
    if (wall) call(socket, 'wall:remove', { id: wall.id }).catch(fail);
    return false;
  }
  // clicking a door's marker with the Door tool locks or unlocks it
  if (wallOpts.mode === 'door' && !chain) {
    const d = doorAt(w, z, []);
    if (d) { call(socket, 'wall:update', { id: d.id, locked: !d.locked }).then(() => toast(d.locked ? 'Door unlocked' : 'Door locked: players can\'t open it')).catch(fail); return false; }
  }
  const p = snap(w, z, e);
  dragging = { a: chain || p, b: p, start: p, moved: false };
  return true;
}
export function wallMove(w, z, e) {
  if (!dragging) return;
  dragging.b = snap(w, z, e);
  if (Math.hypot(dragging.b[0] - dragging.start[0], dragging.b[1] - dragging.start[1]) * z > 5) dragging.moved = true;
}
export function wallUp(w, z, e) {
  const d = dragging;
  dragging = null;
  if (!d) return;
  if (d.moved) {
    // dragged: one wall from where the drag started (or the chain) to here, and keep chaining from the end
    addWall(chain || d.start, d.b);
    chain = d.b;
  } else if (chain) {
    // clicked: wall from the last point to here
    addWall(chain, d.b);
    chain = d.b;
  } else {
    chain = d.b; // first point of a run of walls
  }
  hover = null;
}
export function wallHover(w, z, e) { hover = chain ? snap(w, z, e) : null; }
export function endChain() { chain = null; hover = null; dragging = null; api?.requestDraw(); }
export const chaining = () => !!chain;
