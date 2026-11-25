// Battlemap generator: a seeded layout for an interior (office, bar, café, server room, jail) or an exterior
// (street, badlands, hot zone). Pure: the same kind, size and seed always give the same map, here and in the
// browser. Everything is measured in grid squares; the browser draws it (mapgen-draw.js) and the server turns
// the walls and devices into a scene.
//
// Layout: { kind, seed, cols, rows, title, interior,
//           floors:  [{ x, y, w, h, mat }]                 painted first to last
//           rooms:   [{ id, name, x, y, w, h }]
//           walls:   [{ a: [x, y], b: [x, y], kind: 'wall' | 'door', locked, name }]
//           objects: [{ type, x, y, w, h, rot, block }]     block: walls go round it (rocks, wrecks)
//           devices: [{ type, name, x, y, dir, room, door, base }] }   door: index into walls

export const MAP_KINDS = {
  office: { label: 'Office', interior: true },
  bar: { label: 'Bar', interior: true },
  cafe: { label: 'Café', interior: true },
  server: { label: 'Server room', interior: true },
  jail: { label: 'Jail', interior: true },
  street: { label: 'Street', interior: false },
  badlands: { label: 'Badlands', interior: false },
  hotzone: { label: 'Hot zone', interior: false },
};
export const MAP_SIZES = { small: [20, 15], medium: [28, 20], large: [36, 26] };

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1)); // a..b inclusive
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

// ---------- room recipes: names in order of importance, the floor, and how to furnish each ----------
const RECIPES = {
  office: {
    mat: 'carpet', title: ['Arasaka Satellite Office', 'Biotechnica Regional Desk', 'Petrochem Admin Floor', 'Kendachi Sales Suite', 'Militech Procurement'],
    rooms: [['Open-plan office', 'desks'], ['Reception', 'reception'], ['Meeting room', 'meeting'], ["Manager's office", 'manager'],
      ['Break room', 'breakroom'], ['Office', 'manager'], ['Server closet', 'racks'], ['Records', 'storage'], ['Toilets', 'toilets']],
  },
  bar: {
    mat: 'wood', title: ['The Afterlife Annex', 'Neon Dog', 'The Rusty Chrome', 'Lizzie’s Cousin', 'Totentanz Two', 'The Last Bulb'],
    rooms: [['Bar floor', 'barfloor'], ['Back room', 'backroom'], ['VIP lounge', 'booths'], ['Kitchen', 'kitchen'],
      ["Owner's office", 'manager'], ['Stockroom', 'storage'], ['Toilets', 'toilets'], ['Cellar stairs', 'storage']],
  },
  cafe: {
    mat: 'checker', title: ['Café Sinapsi', 'The Daily Grind', 'Nicola Corner', 'Kibble & Kaffee', 'Synthbean'],
    rooms: [['Café', 'cafe'], ['Kitchen', 'kitchen'], ['Back office', 'manager'], ['Stockroom', 'storage'], ['Toilets', 'toilets'], ['Staff room', 'breakroom']],
  },
  server: {
    mat: 'metal', title: ['Data Fortress 7', 'NetWatch Relay Node', 'Zetatech Cold Store', 'Ziggurat Colo Hall', 'Old Net Archive'],
    rooms: [['Server hall', 'serverhall'], ['Loading bay', 'loading'], ['Control room', 'control'], ['Cooling plant', 'cooling'],
      ['Security office', 'security'], ['Power room', 'power'], ['Storage', 'storage'], ['Toilets', 'toilets']],
  },
  jail: {
    mat: 'concrete', title: ['NCPD Precinct Holding', 'Lazarus Detention Block', 'Militech Brig', 'District 9 Lock-up'],
    rooms: [['Guard station', 'security'], ['Processing', 'reception'], ['Interrogation', 'interrogation'], ['Armoury', 'armoury'],
      ['Evidence', 'storage'], ['Showers', 'toilets'], ['Office', 'manager']],
  },
};
const ROOM_MATS = { toilets: 'tile', kitchen: 'tile', breakroom: 'tile', racks: 'metal', serverhall: 'metal', cooling: 'metal', power: 'metal',
  loading: 'concrete', storage: 'concrete', armoury: 'metal', interrogation: 'concrete', control: 'carpet', security: 'carpet', manager: 'carpet' };

// ---------- main ----------
export function generateMap({ kind = 'office', size = 'medium', seed = 1 } = {}) {
  if (!MAP_KINDS[kind]) throw new Error(`No map kind ${kind}`);
  const [cols, rows] = MAP_SIZES[size] || MAP_SIZES.medium;
  const r = rng(seed);
  const L = { kind, seed, cols, rows, interior: MAP_KINDS[kind].interior, title: '', floors: [], rooms: [], walls: [], objects: [], devices: [] };
  if (L.interior) interior(L, r);
  else if (kind === 'street') street(L, r);
  else if (kind === 'badlands') badlands(L, r);
  else hotzone(L, r);
  for (const o of L.objects) { o.rot = o.rot || 0; o.block = !!o.block; }
  return L;
}

// =====================================================================================================
// Interiors: split the building into rooms, join them with doors, furnish, then wire up security.
// =====================================================================================================
function interior(L, r) {
  buildInterior(L, r, {
    rec: RECIPES[L.kind], roomMats: ROOM_MATS, furnish,
    cells: L.kind === 'jail' ? { corridor: ['Day room', 'Cell block'], cell: 'Cell' } : null,
    frontRoles: ['reception', 'barfloor', 'cafe', 'loading'], backRoles: ['storage', 'kitchen', 'loading', 'security'],
    lockRoles: ['racks', 'serverhall', 'armoury', 'security', 'cell', 'control', 'power'], maybeLock: ['manager'],
    wire: security,
  });
}

/**
 * Lay out a building: rooms (the main one carved first), names, doors on a spanning tree plus a few loops,
 * the ways in and out, walls, furniture. `cfg` says what kind of building it is:
 *   rec          { mat, title: [...], rooms: [[name, role], ...] }   most important room first
 *   roomMats     role -> floor
 *   furnish      (L, room, r, blocked) puts the furniture in
 *   cells        { corridor: [big name, small name], cell: 'Cell' } for a block of cells on a corridor
 *   frontRoles / backRoles   where the front and back doors go
 *   lockRoles    rooms whose doors are locked; maybeLock: locked half the time
 *   secretRoles  rooms reached through a secret door (joined last, so nothing else depends on them)
 *   hidden       [name, role]: make sure there is one such room (the smallest spare one)
 *   secretName   (room on the other side) -> what the secret door looks like
 *   wire         (L, r) adds security devices
 */
export function buildInterior(L, r, cfg) {
  const { rec } = cfg;
  L.title = r.pick(rec.title);
  const bx = 1, by = 1, bw = L.cols - 2, bh = L.rows - 2;
  L.floors.push({ x: 0, y: 0, w: L.cols, h: L.rows, mat: cfg.ground || 'pavement' });
  // rooms
  let leaves;
  if (cfg.cells) leaves = jailLeaves(L, r, bx, by, bw, bh, cfg.cells);
  else {
    // the main room takes the biggest share; the rest is split into smaller rooms
    const n = targetRooms(bw * bh, rec.rooms.length);
    const vert = bw >= bh, frac = 0.5 + r() * 0.14, first = r() < 0.5;
    const len = vert ? bw : bh, cut = Math.round(len * (first ? frac : 1 - frac));
    const a = vert ? { x: bx, y: by, w: cut, h: bh } : { x: bx, y: by, w: bw, h: cut };
    const b = vert ? { x: bx + cut, y: by, w: bw - cut, h: bh } : { x: bx, y: by + cut, w: bw, h: bh - cut };
    const [main, rest] = first ? [a, b] : [b, a];
    Object.assign(main, { name: rec.rooms[0][0], role: rec.rooms[0][1] });
    leaves = [main, ...split(rest, n - 1, r)];
  }
  // biggest rooms get the most important names
  const order = leaves.filter((l) => !l.role).sort((a, b) => b.w * b.h - a.w * a.h);
  const rest = cfg.cells ? rec.rooms : rec.rooms.slice(1);
  order.forEach((l, i) => { const [name, role] = rest[Math.min(i, rest.length - 1)]; l.name = name; l.role = role; });
  if (cfg.hidden && !leaves.some((l) => l.role === cfg.hidden[1])) {
    // the smallest room that isn't the main one becomes the hidden one
    const spare = leaves.filter((l) => l.role !== rec.rooms[0][1] && !(cfg.secretRoles || []).includes(l.role) && l.role !== 'cell')
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (spare) { spare.name = cfg.hidden[0]; spare.role = cfg.hidden[1]; }
  }
  const used = {};
  leaves.forEach((l, i) => {
    used[l.name] = (used[l.name] || 0) + 1;
    if (used[l.name] > 1 && l.role !== 'cell') l.name = `${l.name} ${used[l.name]}`;
    l.id = `r${i + 1}`;
    L.rooms.push({ id: l.id, name: l.name, x: l.x, y: l.y, w: l.w, h: l.h, role: l.role });
    L.floors.push({ x: l.x, y: l.y, w: l.w, h: l.h, mat: cfg.roomMats[l.role] || rec.mat });
  });

  // cell map: which room each square belongs to (-1 outside)
  const grid = Array.from({ length: L.rows }, () => new Array(L.cols).fill(-1));
  L.rooms.forEach((rm, i) => { for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) grid[y][x] = i; });

  // doors: a random spanning tree over neighbouring rooms, plus a few loops, plus the way in and out
  const edges = sharedEdges(grid, L);
  const doors = [];
  const secret = (i) => !!cfg.secretRoles?.includes(L.rooms[i].role);
  const main = L.rooms.findIndex((x) => x.role === rec.rooms[0][1]) >= 0 ? L.rooms.findIndex((x) => x.role === rec.rooms[0][1]) : 0;
  const linked = new Set([main]);
  const pairs = [...edges.keys()].sort(() => r() - 0.5);
  let guard = 0;
  const link = (allowed) => {
    while (linked.size < L.rooms.length && guard++ < 500) {
      const k = pairs.find((p) => { const [a, b] = p.split('-').map(Number); return linked.has(a) !== linked.has(b) && allowed(a, b); });
      if (!k) break;
      const [a, b] = k.split('-').map(Number);
      doors.push(placeDoor(edges.get(k), r)); linked.add(a); linked.add(b);
    }
  };
  // rooms behind a secret door are joined last, so the rest of the building doesn't depend on finding it
  if (cfg.secretRoles) link((a, b) => !secret(a) && !secret(b));
  link(() => true);
  for (const k of pairs) {
    if (r() < 0.25 && !doors.some((d) => d.pair === k)) {
      const [a, b] = k.split('-').map(Number);
      // cells reach the rest only through the corridor; a secret room has one way in
      if (L.rooms[a].role === 'cell' || L.rooms[b].role === 'cell' || secret(a) || secret(b)) continue;
      doors.push(placeDoor(edges.get(k), r));
    }
  }
  // outside doors: the front from the entrance room, the back from storage and the like
  const front = L.rooms.findIndex((x) => cfg.frontRoles.includes(x.role)) >= 0 ? L.rooms.findIndex((x) => cfg.frontRoles.includes(x.role)) : main;
  const outer = outerEdges(grid, L);
  const fr = outer.filter((e) => e.room === front && e.side === 'S');
  doors.push(placeDoor(fr.length ? fr : outer.filter((e) => e.room === front).length ? outer.filter((e) => e.room === front) : outer, r, { outside: true, name: 'Front door' }));
  const backRoom = L.rooms.findIndex((x, i) => i !== front && cfg.backRoles.includes(x.role) && outer.some((e) => e.room === i));
  if (backRoom >= 0) doors.push(placeDoor(outer.filter((e) => e.room === backRoom), r, { outside: true, name: 'Back door' }));

  // walls between different rooms (and round the outside), with the door squares left out
  const doorSet = new Set(doors.map((d) => d.key));
  buildWalls(L, grid, doorSet);
  for (const d of doors) {
    const a = [d.x, d.y], b = d.vertical ? [d.x, d.y + 1] : [d.x + 1, d.y];
    const rooms = [d.room, d.other].filter((i) => i >= 0).map((i) => L.rooms[i]);
    const hidden = !d.outside && [d.room, d.other].some((i) => i >= 0 && secret(i));
    if (hidden) {
      // looks like wall until someone finds it; named after the side it's hidden in
      const host = rooms.find((rm) => !cfg.secretRoles.includes(rm.role)) || rooms[0];
      L.walls.push({ a, b, kind: 'door', locked: false, secret: true, name: cfg.secretName ? cfg.secretName(host) : 'Secret door', rooms: rooms.map((rm) => rm.id) });
      continue;
    }
    const locked = d.outside || rooms.some((rm) => cfg.lockRoles.includes(rm.role)) || (rooms.some((rm) => (cfg.maybeLock || []).includes(rm.role)) && r() < 0.5);
    const name = d.name || (rooms.length === 2 ? `${rooms[0].name} / ${rooms[1].name}` : rooms[0]?.name || 'Door');
    L.walls.push({ a, b, kind: 'door', locked, name, rooms: rooms.map((rm) => rm.id) });
  }
  // keep furniture out of doorways
  const blocked = new Set();
  for (const d of doors) {
    if (d.vertical) { blocked.add(`${d.x - 1},${d.y}`); blocked.add(`${d.x},${d.y}`); }
    else { blocked.add(`${d.x},${d.y - 1}`); blocked.add(`${d.x},${d.y}`); }
  }
  for (const rm of L.rooms) cfg.furnish(L, rm, r, blocked);
  cfg.wire?.(L, r);
}

export const targetRooms = (area, max) => Math.max(3, Math.min(max, Math.round(area / 70)));

/** Binary space partition into `n` rooms, splitting the biggest each time along its long side. */
export function split(rect, n, r, min = 3) {
  const leaves = [rect];
  for (let tries = 0; leaves.length < n && tries < 200; tries++) {
    leaves.sort((a, b) => b.w * b.h - a.w * a.h);
    const i = leaves.findIndex((l) => l.w >= min * 2 || l.h >= min * 2);
    if (i < 0) break;
    const l = leaves[i];
    const vert = l.w > l.h ? true : l.h > l.w ? false : r() < 0.5;
    const len = vert ? l.w : l.h;
    if (len < min * 2) continue;
    const at = r.int(min, len - min);
    leaves.splice(i, 1, ...(vert
      ? [{ x: l.x, y: l.y, w: at, h: l.h }, { x: l.x + at, y: l.y, w: l.w - at, h: l.h }]
      : [{ x: l.x, y: l.y, w: l.w, h: at }, { x: l.x, y: l.y + at, w: l.w, h: l.h - at }]));
  }
  return leaves;
}

/** A jail: a cell block (two rows of cells on a corridor) and offices beside it. */
export function jailLeaves(L, r, bx, by, bw, bh, names = { corridor: ['Day room', 'Cell block'], cell: 'Cell' }) {
  const blockW = Math.max(9, Math.round(bw * 0.58));
  const leaves = [];
  const cellH = Math.max(3, Math.min(4, Math.floor((bh - 2) / 2)));
  const cy = by + cellH;
  leaves.push({ x: bx, y: cy, w: blockW, h: bh - cellH * 2, name: bh - cellH * 2 > 3 ? names.corridor[0] : names.corridor[1], role: 'corridor' });
  const cellW = 3, n = Math.floor(blockW / cellW);
  for (let i = 0; i < n; i++) {
    const w = i === n - 1 ? blockW - cellW * i : cellW;
    leaves.push({ x: bx + i * cellW, y: by, w, h: cellH, name: `${names.cell} ${i * 2 + 1}`, role: 'cell' });
    leaves.push({ x: bx + i * cellW, y: by + bh - cellH, w, h: cellH, name: `${names.cell} ${i * 2 + 2}`, role: 'cell' });
  }
  const rest = split({ x: bx + blockW, y: by, w: bw - blockW, h: bh }, 4, r);
  return [...leaves, ...rest];
}

/** For each pair of neighbouring rooms, the unit edges they share: key "a-b" -> [{ x, y, vertical }]. */
export function sharedEdges(grid, L) {
  const m = new Map();
  const add = (a, b, e) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!m.has(k)) m.set(k, []); m.get(k).push({ ...e, room: a, other: b, pair: k }); };
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
    const here = grid[y][x];
    if (here < 0) continue;
    if (x + 1 < L.cols && grid[y][x + 1] >= 0 && grid[y][x + 1] !== here) add(here, grid[y][x + 1], { x: x + 1, y, vertical: true });
    if (y + 1 < L.rows && grid[y + 1][x] >= 0 && grid[y + 1][x] !== here) add(here, grid[y + 1][x], { x, y: y + 1, vertical: false });
  }
  // jail cells only open onto the corridor
  for (const k of [...m.keys()]) {
    const [a, b] = k.split('-').map(Number);
    const ra = L.rooms[a], rb = L.rooms[b];
    if ((ra.role === 'cell' || rb.role === 'cell') && !(ra.role === 'corridor' || rb.role === 'corridor')) m.delete(k);
  }
  return m;
}
export function outerEdges(grid, L) {
  const out = [];
  for (let y = 0; y < L.rows; y++) for (let x = 0; x < L.cols; x++) {
    const i = grid[y][x];
    if (i < 0) continue;
    if (grid[y + 1]?.[x] === -1) out.push({ x, y: y + 1, vertical: false, room: i, other: -1, side: 'S' });
    if (grid[y - 1]?.[x] === -1) out.push({ x, y, vertical: false, room: i, other: -1, side: 'N' });
    if (grid[y][x + 1] === -1) out.push({ x: x + 1, y, vertical: true, room: i, other: -1, side: 'E' });
    if (grid[y][x - 1] === -1) out.push({ x, y, vertical: true, room: i, other: -1, side: 'W' });
  }
  return out;
}
/** Pick a door square on a shared edge, away from the corners where possible. */
export function placeDoor(edgeList, r, extra = {}) {
  const inner = edgeList.length > 2 ? edgeList.slice(1, -1) : edgeList;
  const e = r.pick(inner);
  return { ...e, ...extra, key: `${e.vertical ? 'v' : 'h'}${e.x},${e.y}` };
}

/** Unit edges between different rooms (or a room and outside), merged into long straight walls. */
export function buildWalls(L, grid, doorSet) {
  const at = (x, y) => (y >= 0 && y < L.rows && x >= 0 && x < L.cols ? grid[y][x] : -1);
  // horizontal edges along y, vertical edges along x
  for (let y = 0; y <= L.rows; y++) {
    let run = null;
    for (let x = 0; x <= L.cols; x++) {
      const wall = x < L.cols && at(x, y - 1) !== at(x, y) && !doorSet.has(`h${x},${y}`);
      if (wall && run === null) run = x;
      if (!wall && run !== null) { L.walls.push({ a: [run, y], b: [x, y], kind: 'wall' }); run = null; }
    }
  }
  for (let x = 0; x <= L.cols; x++) {
    let run = null;
    for (let y = 0; y <= L.rows; y++) {
      const wall = y < L.rows && at(x - 1, y) !== at(x, y) && !doorSet.has(`v${x},${y}`);
      if (wall && run === null) run = y;
      if (!wall && run !== null) { L.walls.push({ a: [x, run], b: [x, y], kind: 'wall' }); run = null; }
    }
  }
}

// ---------- furniture ----------
/** Helpers for putting furniture in one room without overlapping, or blocking a doorway. */
export function furnisher(L, rm, r, blocked) {
  const free = new Set();
  for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (!blocked.has(`${x},${y}`)) free.add(`${x},${y}`);
  const fits = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!free.has(`${x + i},${y + j}`)) return false; return true; };
  const take = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) free.delete(`${x + i},${y + j}`); };
  const put = (type, x, y, w = 1, h = 1, rot = 0, extra = {}) => {
    if (!fits(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h))) return false;
    take(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    L.objects.push({ type, x, y, w, h, rot, room: rm.id, ...extra });
    return true;
  };
  const along = (type, w, h, n, side) => { // n things against one wall
    for (let k = 0; k < n * 6 && n > 0; k++) {
      const s = side || r.pick(['N', 'S', 'E', 'W']);
      const horiz = s === 'N' || s === 'S';
      const ww = horiz ? w : h, hh = horiz ? h : w;
      const x = horiz ? r.int(rm.x, rm.x + rm.w - ww) : s === 'W' ? rm.x : rm.x + rm.w - ww;
      const y = horiz ? (s === 'N' ? rm.y : rm.y + rm.h - hh) : r.int(rm.y, rm.y + rm.h - hh);
      const rot = { N: 0, E: 90, S: 180, W: 270 }[s];
      if (put(type, x, y, ww, hh, rot)) n--;
    }
  };
  const scatter = (type, n, w = 1, h = 1) => {
    for (let k = 0; k < n * 8 && n > 0; k++) {
      const x = r.int(rm.x, rm.x + rm.w - w), y = r.int(rm.y, rm.y + rm.h - h);
      if (put(type, x, y, w, h, r.pick([0, 90, 180, 270]))) n--;
    }
  };
  return { put, along, scatter, fits, area: rm.w * rm.h };
}

function furnish(L, rm, r, blocked) {
  const { put, along, scatter, fits, area } = furnisher(L, rm, r, blocked);
  switch (rm.role) {
    case 'desks': {
      // pods of two desks facing each other, in rows with aisles
      for (let y = rm.y + 1; y + 2 <= rm.y + rm.h - 1; y += 3) {
        for (let x = rm.x + 1; x + 2 <= rm.x + rm.w - 1; x += 3) {
          if (r() < 0.85 && fits(x, y, 2, 2)) {
            put('desk', x, y, 1, 1, 0); put('desk', x + 1, y, 1, 1, 0); put('desk', x, y + 1, 1, 1, 180); put('desk', x + 1, y + 1, 1, 1, 180);
          }
        }
      }
      along('plant', 1, 1, 2); along('cabinet', 1, 1, 2);
      break;
    }
    case 'reception': along('reception', Math.min(3, rm.w - 1), 1, 1, 'N'); along('sofa', 2, 1, 1); along('plant', 1, 1, 2); break;
    case 'meeting': {
      const tw = Math.max(1, rm.w - 2), th = Math.max(1, Math.min(2, rm.h - 2));
      put('table', rm.x + 1, rm.y + Math.floor((rm.h - th) / 2), tw, th, 0, { seats: true });
      along('screen', 2, 1, 1, 'N');
      break;
    }
    case 'manager': along('bigdesk', 2, 1, 1); along('cabinet', 1, 1, 2); along('plant', 1, 1, 1); if (area > 12) along('sofa', 2, 1, 1); scatter('safe', area > 10 ? 1 : 0); break;
    case 'racks': along('rack', 1, 2, Math.max(1, Math.floor(area / 6))); break;
    case 'breakroom': along('counter', Math.min(3, rm.w - 1), 1, 1); scatter('roundtable', Math.max(1, Math.floor(area / 10))); along('vending', 1, 1, 1); break;
    case 'toilets': along('toilet', 1, 1, Math.max(1, Math.min(4, Math.floor(rm.w / 1.5)))); along('sink', 1, 1, 1); break;
    case 'storage': along('shelf', 1, 2, Math.max(1, Math.floor(area / 5))); scatter('crate', Math.max(1, Math.floor(area / 8))); break;
    case 'barfloor': {
      const s = r.pick(['N', 'W', 'E']);
      if (s === 'N') { put('barcounter', rm.x + 1, rm.y + 1, Math.max(2, rm.w - 3), 1, 0); for (let x = rm.x + 1; x < rm.x + rm.w - 2; x++) put('stool', x, rm.y + 2, 1, 1); }
      else { const x = s === 'W' ? rm.x + 1 : rm.x + rm.w - 2; put('barcounter', x, rm.y + 1, 1, Math.max(2, rm.h - 3), 90); for (let y = rm.y + 1; y < rm.y + rm.h - 2; y++) put('stool', s === 'W' ? x + 1 : x - 1, y, 1, 1); }
      along('booth', 2, 2, Math.max(1, Math.floor(area / 30)));
      scatter('roundtable', Math.max(2, Math.floor(area / 14)));
      if (area > 50) scatter('pooltable', 1, 2, 1);
      if (area > 70) along('stage', 3, 2, 1);
      along('jukebox', 1, 1, 1);
      break;
    }
    case 'booths': along('booth', 2, 2, Math.max(1, Math.floor(area / 8))); break;
    case 'backroom': put('table', rm.x + 1, rm.y + 1, Math.max(1, Math.min(3, rm.w - 2)), Math.max(1, Math.min(2, rm.h - 2)), 0, { seats: true }); along('crate', 1, 1, 2); break;
    case 'kitchen': along('counter', Math.min(4, rm.w - 1), 1, 1); along('stove', 1, 1, 1); along('fridge', 1, 1, 1); along('sink', 1, 1, 1); break;
    case 'cafe': along('counter', Math.min(4, rm.w - 2), 1, 1); scatter('cafetable', Math.max(2, Math.floor(area / 7))); along('plant', 1, 1, 2); break;
    case 'serverhall': {
      const vertical = rm.h >= rm.w;
      if (vertical) for (let x = rm.x + 1; x < rm.x + rm.w - 1; x += 2) for (let y = rm.y + 1; y + 1 < rm.y + rm.h - 1; y += 2) put('rack', x, y, 1, 2, 0);
      else for (let y = rm.y + 1; y < rm.y + rm.h - 1; y += 2) for (let x = rm.x + 1; x + 1 < rm.x + rm.w - 1; x += 2) put('rack', x, y, 2, 1, 90);
      break;
    }
    case 'control': along('console', Math.min(3, rm.w - 1), 1, 2); along('screen', 2, 1, 1); break;
    case 'cooling': along('cooler', 2, 2, Math.max(1, Math.floor(area / 10))); scatter('pipe', 1, 1, 2); break;
    case 'power': along('battery', 1, 2, Math.max(1, Math.floor(area / 5))); break;
    case 'security': along('console', Math.min(3, rm.w - 1), 1, 1); along('locker', 1, 1, 2); along('screen', 2, 1, 1); break;
    case 'loading': scatter('crate', Math.max(2, Math.floor(area / 6))); scatter('pallet', 1, 2, 2); break;
    case 'armoury': along('weaponrack', 1, 2, Math.max(1, Math.floor(area / 4))); along('locker', 1, 1, 2); break;
    case 'interrogation': put('table', rm.x + Math.floor(rm.w / 2) - 1, rm.y + Math.floor(rm.h / 2), 2, 1, 0, { seats: true }); along('mirror', 2, 1, 1); break;
    case 'cell': along('bunk', 1, 2, 1, 'N'); along('toilet', 1, 1, 1); break;
    case 'corridor': along('bench', 2, 1, rm.h > 3 ? 3 : 1); if (rm.h > 3) scatter('table', Math.max(1, Math.floor(area / 20)), 2, 1); break;
    default: scatter('crate', 1);
  }
}

// ---------- security: cameras in the big rooms, locks on outside and sensitive doors, an alarm panel ----------
function security(L, r) {
  const center = (rm) => [rm.x + rm.w / 2, rm.y + rm.h / 2];
  const watched = L.rooms.filter((rm) => rm.role !== 'cell' && rm.role !== 'toilets' && rm.w * rm.h >= 12)
    .sort((a, b) => b.w * b.h - a.w * a.h).slice(0, L.rooms.length > 8 ? 5 : 4);
  for (const rm of watched) {
    // in a corner, looking at the middle
    const cx = r() < 0.5 ? rm.x + 0.25 : rm.x + rm.w - 0.25, cy = r() < 0.5 ? rm.y + 0.25 : rm.y + rm.h - 0.25;
    const [mx, my] = center(rm);
    L.devices.push({ type: 'camera', name: rm.name, x: cx, y: cy, dir: Math.atan2(my - cy, mx - cx), room: rm.id, base: 'live' });
  }
  L.walls.forEach((w, i) => {
    if (w.kind === 'door' && w.locked) {
      L.devices.push({ type: 'lock', name: w.name, x: (w.a[0] + w.b[0]) / 2, y: (w.a[1] + w.b[1]) / 2, door: i, room: w.rooms?.[0], base: 'locked' });
    }
  });
  const hub = L.rooms.find((rm) => ['security', 'reception', 'barfloor', 'cafe', 'control'].includes(rm.role)) || L.rooms[0];
  L.devices.push({ type: 'alarm', name: 'Alarm panel', x: hub.x + 0.5, y: hub.y + 0.5, room: hub.id, base: 'armed' });
  const guarded = L.rooms.find((rm) => ['serverhall', 'armoury', 'corridor', 'control'].includes(rm.role));
  if (guarded && (L.kind === 'server' || L.kind === 'jail' || r() < 0.3)) {
    L.devices.push({ type: 'turret', name: `${guarded.name} turret`, x: guarded.x + guarded.w - 1, y: guarded.y, room: guarded.id, base: 'active' });
  }
}

// =====================================================================================================
// Exteriors
// =====================================================================================================
export function building(L, r, x, y, w, h, doorSide, opts = {}) {
  const walls = [];
  const door = doorSide === 'N' || doorSide === 'S'
    ? { x: x + r.int(1, Math.max(1, w - 2)), y: doorSide === 'N' ? y : y + h, vertical: false }
    : { x: doorSide === 'W' ? x : x + w, y: y + r.int(1, Math.max(1, h - 2)), vertical: true };
  const gaps = opts.broken ? Math.max(1, Math.floor((w + h) / 5)) : 0;
  const edges = [];
  for (let i = 0; i < w; i++) { edges.push([x + i, y, x + i + 1, y]); edges.push([x + i, y + h, x + i + 1, y + h]); }
  for (let j = 0; j < h; j++) { edges.push([x, y + j, x, y + j + 1]); edges.push([x + w, y + j, x + w, y + j + 1]); }
  const holes = new Set();
  for (let k = 0; k < gaps; k++) holes.add(r.int(0, edges.length - 1));
  edges.forEach((e, i) => {
    const isDoor = !opts.broken && (door.vertical ? e[0] === door.x && e[2] === door.x && e[1] === door.y : e[1] === door.y && e[3] === door.y && e[0] === door.x);
    if (isDoor || holes.has(i)) return;
    walls.push(e);
  });
  mergeInto(L, walls);
  if (!opts.broken) {
    const a = [door.x, door.y], b = door.vertical ? [door.x, door.y + 1] : [door.x + 1, door.y];
    L.walls.push({ a, b, kind: 'door', locked: !!opts.locked, name: opts.name || 'Door' });
  }
  L.floors.push({ x, y, w, h, mat: opts.mat || 'roof' });
  return door;
}
/** Merge unit edges into long walls. */
export function mergeInto(L, edges) {
  const key = (e) => `${e[0]},${e[1]},${e[2]},${e[3]}`;
  const set = new Map(edges.map((e) => [key(e), e]));
  const done = new Set();
  for (const e of edges) {
    if (done.has(key(e))) continue;
    const horiz = e[1] === e[3];
    let [x1, y1, x2, y2] = e;
    done.add(key(e));
    // grow forwards
    for (;;) { const n = horiz ? [x2, y2, x2 + 1, y2] : [x2, y2, x2, y2 + 1]; if (!set.has(key(n)) || done.has(key(n))) break; done.add(key(n)); x2 = n[2]; y2 = n[3]; }
    for (;;) { const p = horiz ? [x1 - 1, y1, x1, y1] : [x1, y1 - 1, x1, y1]; if (!set.has(key(p)) || done.has(key(p))) break; done.add(key(p)); x1 = p[0]; y1 = p[1]; }
    L.walls.push({ a: [x1, y1], b: [x2, y2], kind: 'wall' });
  }
}
/** An irregular blob (rock, rubble heap) with walls round its edge so it blocks sight. */
export function blob(L, r, type, cx, cy, rad, block = true) {
  const n = r.int(6, 9), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.4;
    const d = rad * (0.7 + r() * 0.45);
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    pts.push([+clamp(cx + Math.cos(a) * d, L.cols).toFixed(2), +clamp(cy + Math.sin(a) * d, L.rows).toFixed(2)]);
  }
  L.objects.push({ type, x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2, pts, block });
  if (block) for (let i = 0; i < n; i++) L.walls.push({ a: pts[i], b: pts[(i + 1) % n], kind: 'wall' });
}
export const overlaps = (list, x, y, w, h, pad = 1) => list.some((o) => x < o.x + o.w + pad && x + w + pad > o.x && y < o.y + o.h + pad && y + h + pad > o.y);

function street(L, r) {
  L.title = r.pick(['Watson, Kabuki Row', 'Heywood Back Street', 'Little China Strip', 'Santo Domingo Arterial', 'Japantown Market Street']);
  const { cols, rows } = L;
  const roadH = rows >= 20 ? 6 : 5, walk = 2;
  const roadY = Math.floor((rows - roadH) / 2);
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'asphalt' });
  L.floors.push({ x: 0, y: roadY - walk, w: cols, h: walk, mat: 'pavement' });
  L.floors.push({ x: 0, y: roadY + roadH, w: cols, h: walk, mat: 'pavement' });
  L.floors.push({ x: 0, y: roadY, w: cols, h: roadH, mat: 'road' });
  L.objects.push({ type: 'lanes', x: 0, y: roadY, w: cols, h: roadH });
  // buildings both sides, with alleys between some
  const rowsSpec = [{ y: 0, h: roadY - walk, side: 'S' }, { y: roadY + roadH + walk, h: rows - (roadY + roadH + walk), side: 'N' }];
  const shops = ['Noodle bar', 'Clinic', 'Pawn shop', 'Arcade', 'Laundry', 'Gun shop', 'Braindance parlour', 'Bodega', 'Tattoo studio', 'Hotel lobby'];
  for (const spec of rowsSpec) {
    if (spec.h < 3) continue;
    let x = 0;
    while (x < cols - 2) {
      const w = Math.min(cols - x, r.int(4, 8));
      if (w < 3) break;
      const depth = Math.min(spec.h, r.int(3, spec.h));
      const by = spec.side === 'S' ? spec.y + spec.h - depth : spec.y;
      const name = r.pick(shops);
      building(L, r, x, by, w, depth, spec.side, { locked: r() < 0.5, name: `${name} door`, mat: 'roof' });
      L.objects.push({ type: 'sign', x: x + w / 2 - 1, y: spec.side === 'S' ? by + depth - 0.4 : by - 0.1, w: 2, h: 0.5, label: name, hue: r.pick([300, 190, 50, 140, 0]) });
      x += w;
      if (r() < 0.35 && x < cols - 4) { L.objects.push({ type: 'dumpster', x: x + 0.1, y: spec.side === 'S' ? spec.y + spec.h - 2 : spec.y + 1, w: 1, h: 1.6 }); x += r.int(1, 2); }
    }
  }
  // cars: parked along the kerbs, some in the lanes
  const placed = [];
  const car = (x, y, dir) => { if (overlaps(placed, x, y, 2.2, 1.1, 0.4)) return; placed.push({ x, y, w: 2.2, h: 1.1 }); L.objects.push({ type: 'car', x, y, w: 2.2, h: 1.1, rot: dir, hue: r.pick([0, 210, 45, 280, 120, 30]), wreck: r() < 0.15 }); };
  for (let i = 0; i < Math.floor(cols / 5); i++) car(r.int(0, cols - 3) + r() * 0.5, roadY + 0.2, 0);
  for (let i = 0; i < Math.floor(cols / 5); i++) car(r.int(0, cols - 3) + r() * 0.5, roadY + roadH - 1.3, 180);
  for (let i = 0; i < 2; i++) car(r.int(0, cols - 3) + r() * 0.5, roadY + roadH / 2 - (r() < 0.5 ? 1.2 : 0), r() < 0.5 ? 0 : 180);
  // street furniture on the pavements
  for (let x = 1; x < cols; x += r.int(5, 7)) {
    L.objects.push({ type: 'streetlight', x, y: roadY - 0.6, w: 0.5, h: 0.5 });
    L.objects.push({ type: 'streetlight', x: x + 2, y: roadY + roadH + 0.1, w: 0.5, h: 0.5 });
  }
  for (let i = 0; i < Math.floor(cols / 6); i++) L.objects.push({ type: r.pick(['bin', 'vending', 'barrier']), x: r.int(0, cols - 1), y: r() < 0.5 ? roadY - walk + 0.1 : roadY + roadH + 1, w: 0.8, h: 0.8 });
  // a couple of street cameras on the buildings, watching the road
  for (let i = 0; i < 2; i++) {
    const x = r.int(2, cols - 3), top = i === 0;
    L.devices.push({ type: 'camera', name: top ? 'North street cam' : 'South street cam', x, y: top ? roadY - walk : roadY + roadH + walk, dir: top ? Math.PI / 2 : -Math.PI / 2, base: 'live' });
  }
  L.walls.forEach((w, i) => { if (w.kind === 'door' && w.locked) L.devices.push({ type: 'lock', name: w.name, x: (w.a[0] + w.b[0]) / 2, y: (w.a[1] + w.b[1]) / 2, door: i, base: 'locked' }); });
}

function badlands(L, r) {
  L.title = r.pick(['The Badlands, Route 66 Spur', 'Dry Lake Bed', 'Nomad Camp Outskirts', 'Old Solar Farm', 'Biotechnica Flats']);
  const { cols, rows } = L;
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'sand' });
  // a dirt track that wanders across
  const track = []; let y = r.int(3, rows - 4);
  for (let x = 0; x <= cols; x += 1) { y = Math.max(2, Math.min(rows - 3, y + (r() < 0.3 ? r.pick([-1, 1]) : 0))); track.push([x, y + 0.5]); }
  L.objects.push({ type: 'track', x: 0, y: 0, w: cols, h: rows, pts: track });
  const taken = track.map(([x, ty]) => ({ x: x - 0.5, y: ty - 1.5, w: 1, h: 3 }));
  // rocks
  const nRocks = Math.round((cols * rows) / 45);
  for (let i = 0; i < nRocks * 4 && L.objects.filter((o) => o.type === 'rock').length < nRocks; i++) {
    const rad = 0.6 + r() * 1.3, cx = 1 + r() * (cols - 2), cy = 1 + r() * (rows - 2);
    if (overlaps(taken, cx - rad, cy - rad, rad * 2, rad * 2, 0.6)) continue;
    taken.push({ x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 });
    blob(L, r, 'rock', cx, cy, rad);
  }
  // wrecks, scrub, a ruined shack
  for (let i = 0; i < 3; i++) {
    const x = r.int(1, cols - 4), yy = r.int(1, rows - 3);
    if (overlaps(taken, x, yy, 2.2, 1.1, 0.5)) continue;
    taken.push({ x, y: yy, w: 2.2, h: 1.1 });
    L.objects.push({ type: 'car', x, y: yy, w: 2.2, h: 1.1, rot: r.int(0, 359), hue: 30, wreck: true });
  }
  for (let i = 0; i < Math.round(cols * rows / 25); i++) L.objects.push({ type: 'scrub', x: r() * cols, y: r() * rows, w: 0.6, h: 0.6 });
  for (let i = 0; i < Math.round(cols * rows / 120); i++) L.objects.push({ type: 'deadtree', x: r() * (cols - 1), y: r() * (rows - 1), w: 1, h: 1 });
  for (let i = 0; i < 3; i++) L.objects.push({ type: 'barrel', x: r.int(1, cols - 2), y: r.int(1, rows - 2), w: 0.7, h: 0.7 });
  for (let tries = 0; tries < 30; tries++) {
    const w = r.int(4, 6), h = r.int(3, 4), x = r.int(1, cols - w - 1), yy = r.int(1, rows - h - 1);
    if (overlaps(taken, x, yy, w, h, 1)) continue;
    building(L, r, x, yy, w, h, r.pick(['N', 'S', 'E', 'W']), { broken: true, mat: 'planks' });
    L.objects.push({ type: 'crate', x: x + 1, y: yy + 1, w: 1, h: 1 });
    break;
  }
}

function hotzone(L, r) {
  L.title = r.pick(['Pacifica Combat Zone', 'Old Downtown Ruins', 'Bay Bridge Approach', 'The Crater Edge', 'Dogtown Checkpoint']);
  const { cols, rows } = L;
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'ruin' });
  const taken = [];
  // gutted buildings with holes blown in the walls
  for (let tries = 0, n = 0; tries < 60 && n < Math.round(cols * rows / 110); tries++) {
    const w = r.int(4, 8), h = r.int(3, 6), x = r.int(1, cols - w - 1), y = r.int(1, rows - h - 1);
    if (overlaps(taken, x, y, w, h, 2)) continue;
    taken.push({ x, y, w, h }); n++;
    building(L, r, x, y, w, h, 'S', { broken: true, mat: 'rubblefloor' });
  }
  // craters, rubble heaps (block), burnt cars, barricades, fires
  for (let i = 0; i < Math.round(cols * rows / 60); i++) {
    const rad = 1 + r() * 1.2, cx = 1 + r() * (cols - 2), cy = 1 + r() * (rows - 2);
    if (overlaps(taken, cx - rad, cy - rad, rad * 2, rad * 2, 0.5)) continue;
    taken.push({ x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 });
    L.objects.push({ type: 'crater', x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 });
  }
  for (let i = 0; i < Math.round(cols * rows / 60); i++) {
    const rad = 0.6 + r() * 0.8, cx = 1 + r() * (cols - 2), cy = 1 + r() * (rows - 2);
    if (overlaps(taken, cx - rad, cy - rad, rad * 2, rad * 2, 0.4)) continue;
    taken.push({ x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 });
    blob(L, r, 'rubble', cx, cy, rad);
  }
  for (let i = 0; i < 3; i++) {
    const x = r.int(1, cols - 4), y = r.int(1, rows - 3);
    if (overlaps(taken, x, y, 2.2, 1.1, 0.4)) continue;
    taken.push({ x, y, w: 2.2, h: 1.1 });
    L.objects.push({ type: 'car', x, y, w: 2.2, h: 1.1, rot: r.int(0, 359), hue: 20, wreck: true, burning: r() < 0.6 });
  }
  for (let i = 0; i < 3; i++) {
    const x = r.int(1, cols - 4), y = r.int(1, rows - 2), vertical = r() < 0.5;
    const w = vertical ? 0.7 : r.int(3, 4), h = vertical ? r.int(3, 4) : 0.7;
    if (overlaps(taken, x, y, w, h, 0.4)) continue;
    taken.push({ x, y, w, h });
    L.objects.push({ type: 'sandbags', x, y, w, h });
  }
  for (let i = 0; i < Math.round(cols * rows / 60); i++) { const rad = 1 + r() * 1.5; L.objects.push({ type: 'scorch', x: r() * cols - rad, y: r() * rows - rad, w: rad * 2, h: rad * 2 }); }
  for (let i = 0; i < 4; i++) L.objects.push({ type: 'fire', x: r() * (cols - 1), y: r() * (rows - 1), w: 0.7, h: 0.7 });
  for (let i = 0; i < Math.round(cols * rows / 70); i++) { const x = r.int(1, cols - 2), y = r.int(1, rows - 2); if (!overlaps(taken, x, y, 1, 1, 0.2)) { taken.push({ x, y, w: 1, h: 1 }); L.objects.push({ type: r.pick(['crate', 'barrel', 'barrel']), x, y, w: 1, h: 1 }); } }
  for (let i = 0; i < Math.round(cols * rows / 12); i++) L.objects.push({ type: 'debris', x: r() * cols, y: r() * rows, w: 0.3 + r() * 0.5, h: 0.3 + r() * 0.5, rot: r.int(0, 359) });
  // somebody left an autoturret on a barricade
  const bag = L.objects.find((o) => o.type === 'sandbags');
  if (bag) L.devices.push({ type: 'turret', name: 'Autoturret', x: bag.x, y: bag.y, base: 'active' });
}
