// 3D dice shapes, shared by the server (physics) and the browser (drawing).
// Each die is a convex polyhedron: vertices, faces (vertex indices, anticlockwise seen from outside)
// and the number on each face. A d4 is read from its top corner, so its "face value" is the number
// you read when that face is lying on the table.

const PHI = (1 + Math.sqrt(5)) / 2;
const SIZE = { 4: 0.95, 6: 0.87, 8: 0.9, 10: 0.88, 12: 0.88, 20: 0.92 }; // circumradius; a d6 has edges of 1

export const SUPPORTED = [4, 6, 8, 10, 12, 20];
/** Tokens knocked about by dice are top-heavy like miniatures: their weight sits this far up. */
export const TOP_HEAVY = 0.72;

function rawVertices(sides) {
  switch (sides) {
    case 4: return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    case 6: { const v = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]); return v; }
    case 8: return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    case 10: {
      // pentagonal trapezohedron: the ring height makes each kite flat
      const h = 1.05, c = Math.cos(Math.PI / 5), z0 = (h * (1 - c)) / (1 + c);
      const v = [[0, 0, h], [0, 0, -h]];
      for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5; v.push([Math.cos(a), Math.sin(a), k % 2 ? -z0 : z0]); }
      return v;
    }
    case 12: {
      const v = [], p = PHI, q = 1 / PHI;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
      for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a * q, b * p], [a * q, b * p, 0], [a * p, 0, b * q]);
      return v;
    }
    case 20: {
      const v = [], p = PHI;
      for (const a of [-1, 1]) for (const b of [-1, 1]) v.push([0, a, b * p], [a, b * p, 0], [a * p, 0, b]);
      return v;
    }
    default: throw new Error(`No 3D d${sides}`);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The faces of a convex shape: every plane through three corners with all the others behind it. */
function hull(verts) {
  const faces = [], seen = new Set(), eps = 1e-6;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) for (let k = j + 1; k < verts.length; k++) {
    let n = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (len(n) < 1e-9) continue;
    n = norm(n);
    let d = dot(n, verts[i]);
    let above = 0, below = 0;
    for (const v of verts) { const s = dot(n, v) - d; if (s > eps) above++; else if (s < -eps) below++; }
    if (above && below) continue;
    if (above) { n = [-n[0], -n[1], -n[2]]; d = -d; }
    const key = n.map((x) => Math.round(x * 1e4)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const on = verts.map((v, idx) => idx).filter((idx) => Math.abs(dot(n, verts[idx]) - d) < 1e-5);
    // order the corners anticlockwise around the outward normal
    const c = on.reduce((a, idx) => [a[0] + verts[idx][0] / on.length, a[1] + verts[idx][1] / on.length, a[2] + verts[idx][2] / on.length], [0, 0, 0]);
    const u = norm(sub(verts[on[0]], c)), w = cross(n, u);
    on.sort((a, b) => {
      const pa = sub(verts[a], c), pb = sub(verts[b], c);
      return Math.atan2(dot(pa, w), dot(pa, u)) - Math.atan2(dot(pb, w), dot(pb, u));
    });
    faces.push({ verts: on, normal: n });
  }
  return faces;
}

const cache = new Map();
/** { sides, vertices, faces: [[i..]], normals, values, readDown } — values are for a normal die of that size. */
export function dieShape(sides) {
  if (cache.has(sides)) return cache.get(sides);
  const raw = rawVertices(sides);
  const r = Math.max(...raw.map(len));
  const vertices = raw.map((v) => v.map((x) => (x / r) * SIZE[sides]));
  const hf = hull(vertices);
  if (hf.length !== sides) throw new Error(`d${sides} came out with ${hf.length} faces`);
  // numbers: opposite faces add up to sides + 1 (a d4 has no opposite faces)
  const values = new Array(sides).fill(0);
  if (sides === 4) values.forEach((_, k) => (values[k] = k + 1));
  else {
    const used = new Set();
    let lo = 1, hi = sides;
    hf.forEach((f, a) => {
      if (used.has(a)) return;
      const b = hf.findIndex((g, idx) => !used.has(idx) && idx !== a && dot(g.normal, f.normal) < -0.999);
      used.add(a); used.add(b);
      values[a] = lo++; values[b] = hi--;
    });
  }
  const shape = { sides, vertices, faces: hf.map((f) => f.verts), normals: hf.map((f) => f.normal), values, readDown: sides === 4 };
  cache.set(sides, shape);
  return shape;
}

/** Which face is being read for a die at this orientation (quaternion x, y, z, w; z is up). */
export function readFace(shape, q) {
  const [x, y, z, w] = q;
  let best = -1, bestDot = -Infinity;
  shape.normals.forEach((n, k) => {
    // z component of the normal rotated by q
    const ix = w * n[0] + y * n[2] - z * n[1];
    const iy = w * n[1] + z * n[0] - x * n[2];
    const iz = w * n[2] + x * n[1] - y * n[0];
    const iw = -x * n[0] - y * n[1] - z * n[2];
    const rz = iz * w + iw * -z + ix * -y - iy * -x;
    const d = shape.readDown ? -rz : rz;
    if (d > bestDot) { bestDot = d; best = k; }
  });
  return best;
}

/**
 * Numbers to paint on a die so that the face it actually landed on shows `want`.
 * Swaps two labels, so a die always carries each number exactly once.
 */
export function labelsFor(shape, landed, want, values = shape.values) {
  const labels = values.slice();
  const j = labels.indexOf(want);
  if (j < 0 || j === landed) return labels;
  [labels[j], labels[landed]] = [labels[landed], labels[j]];
  return labels;
}

/** The numbers on each kind of die: a plain d10 shows 1..10 (10 printed as 0), percentile dice 00..90 and 0..9. */
export function valuesFor(kind, sides) {
  const base = dieShape(sides).values;
  if (kind === 'tens') return base.map((v) => (v % 10) * 10);
  if (kind === 'units') return base.map((v) => v % 10);
  return base;
}

/** What's printed for a number. */
export function faceText(kind, sides, v) {
  if (kind === 'tens') return v === 0 ? '00' : String(v);
  if (sides === 10) return String(v % 10);
  return String(v);
}

/**
 * The dice to throw for a roll result: [{ sides, kind, value, kept }].
 * Shows each die's first roll (exploding dice show the roll that exploded). Odd dice (d3, d30…) aren't shown.
 */
export function diceForResult(result, max = 14) {
  const out = [];
  for (const p of result?.parts || []) {
    for (const d of p.dice || []) {
      if (out.length >= max) return out;
      const first = Array.isArray(d.chain) && d.chain.length ? d.chain[0] : d.value;
      const kept = d.kept !== false;
      if (p.type === 'pct') {
        out.push({ sides: 10, kind: d.label === 'tens' ? 'tens' : 'units', value: first, kept });
      } else if (d.sides === 100) {
        const v = first === 100 ? 0 : first;
        out.push({ sides: 10, kind: 'tens', value: Math.floor(v / 10) * 10, kept });
        if (out.length < max) out.push({ sides: 10, kind: 'units', value: v % 10, kept });
      } else if (SUPPORTED.includes(d.sides)) {
        out.push({ sides: d.sides, kind: 'd', value: first, kept });
      }
    }
  }
  return out;
}
