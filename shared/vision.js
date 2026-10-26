// Line of sight, shared by the server (checking moves, remembering explored areas) and the browser (drawing fog).
//
// A scene's walls: { id, a: [x, y], b: [x, y], kind: 'wall' | 'door', open: bool, locked: bool }.
// Closed doors block sight and movement like walls; open doors block nothing.

const EPS = 1e-9;

/** The segments that block sight: closed walls and doors, plus the edge of the map. */
export function blockingSegments(scene) {
  const segs = [];
  for (const w of scene.walls || []) {
    if (w.kind === 'door' && w.open) continue;
    segs.push([w.a[0], w.a[1], w.b[0], w.b[1]]);
  }
  const m = scene.map || { width: 0, height: 0 };
  const W = m.width, H = m.height;
  segs.push([0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]);
  return segs;
}

/** Where a ray from (ox, oy) in direction (dx, dy) first meets segment s, as a distance along the ray, or Infinity. */
function rayHit(ox, oy, dx, dy, s) {
  const [x1, y1, x2, y2] = s;
  const sx = x2 - x1, sy = y2 - y1;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < EPS) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / den; // along the ray
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den; // along the segment
  if (t < 0 || u < -1e-7 || u > 1 + 1e-7) return Infinity;
  return t;
}

/**
 * Everything visible from `origin`, as a polygon [[x, y], ...] in angle order.
 * Classic angular sweep: cast rays at every wall end (and just either side), keep the nearest hit.
 */
export function visibilityPolygon(origin, segs) {
  const [ox, oy] = origin;
  const angles = [];
  for (const s of segs) {
    for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 0.00001, a, a + 0.00001);
    }
  }
  angles.sort((p, q) => p - q);
  const poly = [];
  let last = null;
  for (const a of angles) {
    if (last !== null && a - last < 1e-12) continue;
    last = a;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) {
      const t = rayHit(ox, oy, dx, dy, s);
      if (t < best) best = t;
    }
    if (best === Infinity) continue;
    poly.push([ox + dx * best, oy + dy * best]);
  }
  return poly;
}

function segmentsCross(ax, ay, bx, by, s) {
  const [cx, cy, dx, dy] = s;
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does moving from a to b go through a closed wall or door? (The map edge doesn't count here.) */
export function crossesWall(a, b, scene) {
  for (const w of scene.walls || []) {
    if (w.kind === 'door' && w.open) continue;
    if (segmentsCross(a[0], a[1], b[0], b[1], [w.a[0], w.a[1], w.b[0], w.b[1]])) return true;
  }
  return false;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + EPS) + xi) inside = !inside;
  }
  return inside;
}

/** Centre of a token in world units. */
export const tokenCenter = (t, gridSize) => [t.x + (t.size * gridSize) / 2, t.y + (t.size * gridSize) / 2];

/** The tokens whose eyes players see through: any token a player owns. */
export const isPlayerToken = (t) => (t.owners || []).length > 0;

/** Can a point be seen from any of these viewpoints? `views` = [{ origin, poly }] */
export function pointVisible(x, y, views, radius = 0) {
  for (const v of views) {
    if (radius > 0 && (x - v.origin[0]) ** 2 + (y - v.origin[1]) ** 2 > radius * radius) continue;
    if (pointInPolygon(x, y, v.poly)) return true;
  }
  return false;
}

// ---------- explored areas ----------
// A coarse grid of cells (a quarter of a grid square) packed into bits, saved with the scene as base64.

export function exploredGrid(scene) {
  const m = scene.map;
  const cell = Math.max(8, Math.round((m.gridSize || 70) / 4));
  const cols = Math.ceil(m.width / cell), rows = Math.ceil(m.height / cell);
  const ex = scene.fog?.explored;
  const bits = new Uint8Array(Math.ceil((cols * rows) / 8));
  if (ex && ex.cell === cell && ex.cols === cols && ex.rows === rows && typeof ex.bits === 'string') {
    const raw = fromBase64(ex.bits);
    bits.set(raw.subarray(0, bits.length));
  }
  return { cell, cols, rows, bits };
}

export function packExplored(g) {
  return { cell: g.cell, cols: g.cols, rows: g.rows, bits: toBase64(g.bits) };
}

export const isExplored = (g, c, r) => (g.bits[(r * g.cols + c) >> 3] >> ((r * g.cols + c) & 7)) & 1;

/** Mark every cell whose centre falls inside a visibility polygon (and within `radius`, if set). Returns true if anything changed. */
export function markExplored(g, view, radius = 0) {
  const { poly, origin } = view;
  if (poly.length < 3) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  if (radius > 0) {
    minX = Math.max(minX, origin[0] - radius); maxX = Math.min(maxX, origin[0] + radius);
    minY = Math.max(minY, origin[1] - radius); maxY = Math.min(maxY, origin[1] + radius);
  }
  const c0 = Math.max(0, Math.floor(minX / g.cell)), c1 = Math.min(g.cols - 1, Math.floor(maxX / g.cell));
  const r0 = Math.max(0, Math.floor(minY / g.cell)), r1 = Math.min(g.rows - 1, Math.floor(maxY / g.cell));
  let changed = false;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * g.cols + c;
      if ((g.bits[i >> 3] >> (i & 7)) & 1) continue;
      const x = (c + 0.5) * g.cell, y = (r + 0.5) * g.cell;
      if (pointVisible(x, y, [view], radius)) { g.bits[i >> 3] |= 1 << (i & 7); changed = true; }
    }
  }
  return changed;
}

// base64 that works in both Node and the browser
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}
export function fromBase64(s) {
  const clean = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255;
  }
  return out;
}
