// 1920s battlemaps for Call of Cthulhu: a manor, a speakeasy, an asylum, a library and museum, a church; a town
// street, a graveyard, the woods and the docks. Same layout format as mapgen.js (and the same seeded randomness),
// with `era: '1920s'` so the browser draws it in period style, and secret doors: { kind: 'door', secret: true }.
// All names and places are our own.
import {
  rng, MAP_SIZES, buildInterior, furnisher, building, blob, overlaps,
} from './mapgen.js';

export const MAP_KINDS_1920 = {
  manor: { label: 'Manor house', interior: true },
  speakeasy: { label: 'Speakeasy', interior: true },
  asylum: { label: 'Asylum', interior: true },
  archive: { label: 'Library & museum', interior: true },
  church: { label: 'Church', interior: true },
  town: { label: 'Town street', interior: false },
  graveyard: { label: 'Graveyard', interior: false },
  woods: { label: 'The woods', interior: false },
  docks: { label: 'Docks', interior: false },
};

const RECIPES = {
  manor: {
    mat: 'parquet', title: ['Whitlock House', 'Ashcombe Hall', 'The Pell Residence', 'Greyfriars Lodge', 'Harrowgate Manor', 'Corbin House'],
    rooms: [['Great hall', 'hall'], ['Drawing room', 'drawing'], ['Library', 'library'], ['Dining room', 'dining'], ['Study', 'study'],
      ['Kitchen', 'kitchen'], ['Parlour', 'parlour'], ["Servants' quarters", 'servants'], ['Pantry', 'pantry']],
    hidden: ['Hidden room', 'hidden'],
  },
  speakeasy: {
    mat: 'boards', title: ['The Blue Heron Club', "Mac's Back Room", 'The Lantern Room', 'Club Nocturne', 'The Velvet Door'],
    rooms: [['Club', 'club'], ["Barber's shop", 'front'], ['Card room', 'cards'], ['Storeroom', 'bootleg'], ['Kitchen', 'kitchen'],
      ["Owner's office", 'study'], ['Cellar', 'bootleg']],
  },
  asylum: {
    mat: 'hextile', title: ['Dunmore Sanatorium', 'St Agnes Hospital for the Insane', 'Esker Hollow Asylum', 'The Wexley Institute'],
    rooms: [["Nurses' station", 'station'], ['Treatment room', 'treatment'], ["Doctor's office", 'study'], ['Records', 'records'],
      ['Infirmary', 'infirmary'], ['Day room', 'dayroom'], ['Linen store', 'pantry']],
  },
  archive: {
    mat: 'boards', title: ['Halloway University Library', 'The Pell Collection', 'Blackmere Historical Society', 'Coldbrook Athenaeum'],
    rooms: [['Reading room', 'reading'], ['Museum hall', 'exhibit'], ['Stacks', 'stacks'], ['Restricted collection', 'restricted'],
      ["Librarian's office", 'study'], ['Workroom', 'workroom'], ['Basement stores', 'pantry']],
    hidden: ['Sealed room', 'hidden'],
  },
  church: {
    mat: 'stone', title: ['St Jude in the Marsh', 'Chapel of the Holy Rood', 'Esker Hollow Meeting House', 'St Ives of the Shore'],
    rooms: [['Nave', 'nave'], ['Chancel', 'chancel'], ['Vestry', 'vestry'], ['Bell tower', 'tower'], ['Sacristy', 'pantry'], ['Parish office', 'study']],
    hidden: ['Crypt stairs', 'hidden'],
  },
};
const ROOM_MATS = {
  hall: 'flagstone', kitchen: 'flagstone', pantry: 'flagstone', servants: 'boards', drawing: 'carpet', library: 'carpet', study: 'carpet',
  dining: 'parquet', parlour: 'carpet', hidden: 'flagstone', club: 'parquet', front: 'hextile', cards: 'carpet', bootleg: 'flagstone',
  station: 'hextile', treatment: 'hextile', records: 'boards', infirmary: 'hextile', dayroom: 'boards', corridor: 'hextile', cell: 'boards',
  reading: 'parquet', exhibit: 'stone', stacks: 'boards', restricted: 'carpet', workroom: 'boards', nave: 'stone', chancel: 'carpet',
  vestry: 'boards', tower: 'flagstone',
};
const SETUP = {
  manor: { front: ['hall'], back: ['kitchen', 'pantry', 'servants'], lock: ['hidden'], maybe: ['study'], secret: ['hidden'] },
  speakeasy: { front: ['front'], back: ['bootleg', 'kitchen'], lock: [], maybe: ['study'], secret: ['front'] },
  asylum: { front: ['station'], back: ['pantry', 'infirmary'], lock: ['cell', 'records', 'treatment'], maybe: ['study'], cells: true },
  archive: { front: ['reading', 'exhibit'], back: ['workroom', 'pantry'], lock: ['restricted'], maybe: ['study'], secret: ['hidden'] },
  church: { front: ['nave'], back: ['vestry'], lock: ['pantry'], maybe: ['study', 'tower'], secret: ['hidden'] },
};
// what a secret door looks like from the room it's hidden in
const SECRET_LOOK = { library: 'Bookcase', study: 'Panelling', restricted: 'Bookcase', stacks: 'Bookcase', hall: 'Panelling', drawing: 'Panelling',
  club: 'Mirror', kitchen: 'Larder shelves', pantry: 'Larder shelves', chancel: 'Flagstone', nave: 'Flagstone', vestry: 'Wardrobe', bootleg: 'Shelves' };

export function generateMap1920({ kind = 'manor', size = 'medium', seed = 1 } = {}) {
  if (!MAP_KINDS_1920[kind]) throw new Error(`No 1920s map kind ${kind}`);
  const [cols, rows] = MAP_SIZES[size] || MAP_SIZES.medium;
  const r = rng(seed ^ 0x1920);
  const L = { kind, seed, era: '1920s', cols, rows, interior: MAP_KINDS_1920[kind].interior, title: '', floors: [], rooms: [], walls: [], objects: [], devices: [] };
  if (L.interior) {
    const s = SETUP[kind];
    buildInterior(L, r, {
      rec: RECIPES[kind], roomMats: ROOM_MATS, furnish, ground: kind === 'church' ? 'grass' : 'brick',
      cells: s.cells ? { corridor: ['Ward', 'Ward'], cell: 'Room' } : null,
      frontRoles: s.front, backRoles: s.back, lockRoles: s.lock, maybeLock: s.maybe,
      secretRoles: s.secret, hidden: RECIPES[kind].hidden,
      secretName: (host) => (kind === 'speakeasy' ? 'Hidden door' : SECRET_LOOK[host?.role] || 'Hidden panel'),
    });
  } else ({ town, graveyard, woods, docks })[kind](L, r);
  for (const o of L.objects) { o.rot = o.rot || 0; o.block = !!o.block; }
  return L;
}

// ---------- furniture ----------
function furnish(L, rm, r, blocked) {
  const { put, along, scatter, fits, area } = furnisher(L, rm, r, blocked);
  const mid = (w, h, type, extra) => put(type, rm.x + Math.floor((rm.w - w) / 2), rm.y + Math.floor((rm.h - h) / 2), w, h, 0, extra);
  const rug = () => {
    if (rm.w < 4 || rm.h < 4) return;
    // a rug, not wall-to-wall carpet: at most 8×6, in the middle of the room
    const w = Math.min(rm.w - 2, 8), h = Math.min(rm.h - 2, 6);
    L.objects.push({ type: 'rug', x: rm.x + Math.floor((rm.w - w) / 2), y: rm.y + Math.floor((rm.h - h) / 2), w, h, hue: r.pick([352, 12, 28, 150]), room: rm.id, under: true });
  };
  switch (rm.role) {
    case 'hall':
      rug(); along('stairs', 3, 2, 1, 'N'); along('clock', 1, 1, 1); along('sidetable', 1, 1, 2); along('fern', 1, 1, 2);
      if (area > 40) { along('chesterfield', 2, 1, 2); along('fireplace', 2, 1, 1); scatter('armchair', 3); scatter('sidetable', 2); along('statue', 1, 1, 2); along('fern', 1, 1, 2); }
      break;
    case 'drawing': rug(); along('fireplace', 2, 1, 1); along('chesterfield', 2, 1, 1); scatter('armchair', 2); if (area > 20) scatter('grandpiano', 1, 2, 2); along('fern', 1, 1, 1); break;
    case 'library': rug(); along('bookcase', 2, 1, Math.max(2, Math.floor((rm.w + rm.h) / 3))); mid(2, 1, 'table', { seats: true }); scatter('armchair', 1); scatter('globe', 1); break;
    case 'dining': along('sideboard', 2, 1, 1); along('fireplace', 2, 1, 1); mid(Math.max(2, rm.w - 3), Math.min(2, Math.max(1, rm.h - 3)), 'table', { seats: true }); break;
    case 'study': rug(); along('writingdesk', 2, 1, 1); along('bookcase', 2, 1, 2); scatter('armchair', 1); if (area > 9) scatter('safe', 1); break;
    case 'kitchen': along('range', 2, 1, 1); along('dresser', 2, 1, 1); along('sink', 1, 1, 1); mid(2, 1, 'table'); along('barrel', 1, 1, 1); break;
    case 'parlour': rug(); scatter('armchair', 3); scatter('sidetable', 1); along('upright', 2, 1, 1); along('gramophone', 1, 1, 1); break;
    case 'servants': along('bed', 1, 2, Math.max(1, Math.floor(area / 6))); along('washstand', 1, 1, 1); along('chest', 1, 1, 1); break;
    case 'pantry': case 'bootleg': along('shelf', 1, 2, Math.max(1, Math.floor(area / 6))); scatter('barrel', Math.max(1, Math.floor(area / 7))); scatter('crate', Math.max(1, Math.floor(area / 8))); break;
    case 'hidden': mid(1, 1, 'circle'); along('altar', 2, 1, 1, 'N'); along('candles', 1, 1, 2); along('lectern', 1, 1, 1); along('chest', 1, 1, 1); break;
    case 'club': {
      const s = r.pick(['N', 'W', 'E']);
      if (s === 'N') { put('barcounter', rm.x + 1, rm.y + 1, Math.max(2, rm.w - 3), 1, 0); for (let x = rm.x + 1; x < rm.x + rm.w - 2; x++) put('stool', x, rm.y + 2, 1, 1); }
      else { const x = s === 'W' ? rm.x + 1 : rm.x + rm.w - 2; put('barcounter', x, rm.y + 1, 1, Math.max(2, rm.h - 3), 90); for (let y = rm.y + 1; y < rm.y + rm.h - 2; y++) put('stool', s === 'W' ? x + 1 : x - 1, y, 1, 1); }
      if (area > 40) along('bandstand', 3, 2, 1);
      scatter('roundtable', Math.max(2, Math.floor(area / 12)));
      along('upright', 2, 1, 1);
      break;
    }
    case 'front': along('barberchair', 1, 1, Math.max(1, Math.min(3, rm.w - 2)), 'N'); along('mirror', 2, 1, 1, 'N'); along('bench', 2, 1, 1); break;
    case 'cards': mid(2, 2, 'cardtable'); along('crate', 1, 1, 2); along('sidetable', 1, 1, 1); break;
    case 'station': along('writingdesk', 2, 1, 1); along('cabinet', 1, 1, 2); along('bench', 2, 1, 1); break;
    case 'treatment': mid(1, 2, 'optable'); along('cabinet', 1, 1, 2); along('sink', 1, 1, 1); scatter('trolley', 1); break;
    case 'records': along('cabinet', 1, 1, Math.max(2, Math.floor(area / 3))); break;
    case 'infirmary': along('bed', 1, 2, Math.max(2, Math.floor(area / 5))); along('cabinet', 1, 1, 1); break;
    case 'dayroom': scatter('roundtable', Math.max(1, Math.floor(area / 12))); scatter('armchair', 2); along('upright', 2, 1, 1); break;
    case 'corridor':
      along('bench', 2, 1, 2);
      if (area > 30) { scatter('roundtable', Math.floor(area / 30)); scatter('armchair', 3); along('upright', 2, 1, 1); along('bench', 2, 1, 2); }
      break;
    case 'cell': along('bed', 1, 2, 1, 'N'); break;
    case 'reading': {
      along('bookcase', 2, 1, Math.max(2, Math.floor((rm.w + rm.h) / 4)));
      for (let y = rm.y + 2; y + 2 <= rm.y + rm.h - 1; y += 3) for (let x = rm.x + 2; x + 2 <= rm.x + rm.w - 1; x += 4) if (fits(x, y, 2, 1)) put('table', x, y, 2, 1, 0, { seats: true, lamp: true });
      break;
    }
    case 'stacks': {
      if (rm.h >= rm.w) for (let x = rm.x + 1; x < rm.x + rm.w - 1; x += 2) for (let y = rm.y + 1; y + 1 < rm.y + rm.h - 1; y += 3) put('bookcase', x, y, 1, 2, 90);
      else for (let y = rm.y + 1; y < rm.y + rm.h - 1; y += 2) for (let x = rm.x + 1; x + 1 < rm.x + rm.w - 1; x += 3) put('bookcase', x, y, 2, 1, 0);
      break;
    }
    case 'restricted': along('bookcase', 2, 1, Math.max(2, Math.floor((rm.w + rm.h) / 3))); mid(1, 1, 'lectern'); along('safe', 1, 1, 1); break;
    case 'exhibit': {
      for (let y = rm.y + 1; y + 1 <= rm.y + rm.h - 1; y += 3) for (let x = rm.x + 1; x + 1 <= rm.x + rm.w - 1; x += 3) if (r() < 0.7) put(r() < 0.15 ? 'statue' : 'displaycase', x, y, 1, 1);
      if (area > 30) scatter('sarcophagus', 1, 1, 2);
      break;
    }
    case 'workroom': mid(2, 1, 'table'); along('shelf', 1, 2, 2); scatter('crate', 2); break;
    case 'nave': {
      // two banks of pews either side of the aisle, facing the far end
      const vert = rm.h >= rm.w;
      if (vert) { const aisle = rm.x + Math.floor(rm.w / 2); for (let y = rm.y + 3; y < rm.y + rm.h - 1; y += 2) { put('pew', rm.x + 1, y, aisle - rm.x - 1, 1); put('pew', aisle + 1, y, rm.x + rm.w - aisle - 2, 1); } }
      else { const aisle = rm.y + Math.floor(rm.h / 2); for (let x = rm.x + 3; x < rm.x + rm.w - 1; x += 2) { put('pew', x, rm.y + 1, 1, aisle - rm.y - 1, 90); put('pew', x, aisle + 1, 1, rm.y + rm.h - aisle - 2, 90); } }
      put('font', rm.x + (vert ? Math.floor(rm.w / 2) : 1), rm.y + (vert ? 1 : Math.floor(rm.h / 2)), 1, 1);
      break;
    }
    case 'chancel': along('altar', 2, 1, 1); along('candles', 1, 1, 2); along('lectern', 1, 1, 1); if (area > 12) along('organ', 2, 1, 1); if (area > 24) { along('pew', 2, 1, 2); along('candles', 1, 1, 2); along('statue', 1, 1, 1); } break;
    case 'vestry': along('wardrobe', 2, 1, 1); along('writingdesk', 2, 1, 1); along('chest', 1, 1, 1); if (area > 16) { along('shelf', 1, 2, 2); mid(2, 1, 'table', { seats: true }); along('candles', 1, 1, 1); } break;
    case 'tower': mid(2, 2, 'spiral'); along('bellrope', 1, 1, 1); break;
    default: scatter('crate', 1);
  }
}

// =====================================================================================================
// Outside
// =====================================================================================================
function car(L, r, placed, x, y, rot) {
  if (overlaps(placed, x, y, 2.2, 1, 0.4)) return;
  placed.push({ x, y, w: 2.2, h: 1 });
  L.objects.push({ type: 'oldcar', x, y, w: 2.2, h: 1, rot, hue: r.pick([0, 210, 30, 140, 0, 0]) });
}

function town(L, r) {
  L.title = r.pick(['Main Street, Esker Hollow', 'Water Street, Blackmere', 'Church Street, Dunmore Falls', 'High Street, Coldbrook', 'Market Square, Wexley']);
  const { cols, rows } = L;
  const roadH = rows >= 20 ? 5 : 4, walk = 2;
  const roadY = Math.floor((rows - roadH) / 2);
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'cobbles' });
  L.floors.push({ x: 0, y: roadY - walk, w: cols, h: walk, mat: 'brick' });
  L.floors.push({ x: 0, y: roadY + roadH, w: cols, h: walk, mat: 'brick' });
  L.floors.push({ x: 0, y: roadY, w: cols, h: roadH, mat: 'cobbles' });
  L.objects.push({ type: 'tramlines', x: 0, y: roadY, w: cols, h: roadH });
  const shops = ['General store', 'Pharmacy', 'Newsagent', 'Savings bank', 'Diner', 'Boarding house', 'Antiques', 'Undertaker', 'Hardware', 'Police station', 'Haberdasher', 'Tailor'];
  for (const spec of [{ y: 0, h: roadY - walk, side: 'S' }, { y: roadY + roadH + walk, h: rows - (roadY + roadH + walk), side: 'N' }]) {
    if (spec.h < 3) continue;
    let x = 0;
    while (x < cols - 2) {
      const w = Math.min(cols - x, r.int(4, 7));
      if (w < 3) break;
      const depth = Math.min(spec.h, r.int(3, spec.h));
      const by = spec.side === 'S' ? spec.y + spec.h - depth : spec.y;
      const name = r.pick(shops);
      building(L, r, x, by, w, depth, spec.side, { locked: r() < 0.4, name: `${name} door`, mat: 'slate' });
      L.objects.push({ type: 'awning', x: x + 0.5, y: spec.side === 'S' ? by + depth : by - 0.6, w: w - 1, h: 0.6, label: name, hue: r.pick([350, 140, 210, 40]) });
      x += w;
      if (r() < 0.3 && x < cols - 4) x += r.int(1, 2); // an alley
    }
  }
  const placed = [];
  for (let i = 0; i < Math.floor(cols / 7); i++) car(L, r, placed, r.int(0, cols - 3) + r() * 0.5, roadY + 0.15, 0);
  for (let i = 0; i < Math.floor(cols / 7); i++) car(L, r, placed, r.int(0, cols - 3) + r() * 0.5, roadY + roadH - 1.15, 180);
  if (!overlaps(placed, 3, roadY + roadH / 2 - 0.5, 3, 1, 0.3)) L.objects.push({ type: 'cart', x: r.int(1, cols - 5), y: roadY + roadH / 2 - 0.5, w: 3, h: 1, rot: r() < 0.5 ? 0 : 180 });
  for (let x = 1; x < cols; x += r.int(5, 7)) {
    L.objects.push({ type: 'gaslamp', x, y: roadY - 0.6, w: 0.5, h: 0.5 });
    L.objects.push({ type: 'gaslamp', x: x + 2, y: roadY + roadH + 0.1, w: 0.5, h: 0.5 });
  }
  for (let i = 0; i < Math.floor(cols / 7); i++) L.objects.push({ type: r.pick(['postbox', 'newsstand', 'hydrant', 'bench']), x: r.int(0, cols - 2), y: r() < 0.5 ? roadY - walk + 0.15 : roadY + roadH + 1, w: r() < 0.3 ? 1.6 : 0.7, h: 0.7 });
}

function graveyard(L, r) {
  L.title = r.pick(['Old Hill Burying Ground', 'St Jude’s Churchyard', 'Potter’s Field', 'Marsh End Cemetery', 'Greyfriars Yard']);
  const { cols, rows } = L;
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'grass' });
  // iron railings round it (you can see through them, so they're only drawn) with a gate in the south side
  const gx = r.int(3, cols - 5);
  L.objects.push({ type: 'fence', x: 1, y: 1, w: cols - 2, h: rows - 2, gate: gx, under: true });
  // a gravel path from the gate up the middle
  const px = gx + 1;
  const path = [[px, rows]];
  let x = px;
  for (let y = rows - 2; y >= 2; y -= 2) { x = Math.max(3, Math.min(cols - 3, x + r.pick([-1, 0, 0, 1]))); path.push([x, y]); }
  L.objects.push({ type: 'path', x: 0, y: 0, w: cols, h: rows, pts: path });
  const taken = path.map(([qx, qy]) => ({ x: qx - 1.2, y: qy - 1.2, w: 2.4, h: 2.4 }));
  // mausoleums (locked, blocking) and a yew or two
  for (let tries = 0, n = 0; tries < 40 && n < Math.max(1, Math.round(cols * rows / 220)); tries++) {
    const w = r.int(3, 4), h = r.int(3, 4), mx = r.int(2, cols - w - 2), my = r.int(2, rows - h - 3);
    if (overlaps(taken, mx, my, w, h, 1)) continue;
    taken.push({ x: mx, y: my, w, h }); n++;
    building(L, r, mx, my, w, h, r.pick(['N', 'S', 'E', 'W']), { locked: true, name: r.pick(['Pell family tomb', 'Whitlock mausoleum', 'Corbin vault', 'Unmarked tomb']), mat: 'stone' });
    L.objects.push({ type: 'sarcophagus', x: mx + w / 2 - 0.5, y: my + h / 2 - 1, w: 1, h: 2 });
  }
  for (let i = 0; i < Math.round(cols * rows / 160) + 1; i++) {
    const rad = 0.8 + r() * 0.5, cx = 2 + r() * (cols - 4), cy = 2 + r() * (rows - 4);
    if (overlaps(taken, cx - rad, cy - rad, rad * 2, rad * 2, 0.3)) continue;
    taken.push({ x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 });
    L.objects.push({ type: 'canopy', x: cx - rad * 1.8, y: cy - rad * 1.8, w: rad * 3.6, h: rad * 3.6, hue: 'yew' });
    blob(L, r, 'trunk', cx, cy, 0.35);
  }
  // rows of headstones, an open grave
  for (let y = 3; y < rows - 2; y += 2) for (let gx2 = 2.5; gx2 < cols - 2; gx2 += 1.5 + r() * 0.6) {
    if (r() < 0.3 || overlaps(taken, gx2, y, 0.8, 1.2, 0.2)) continue;
    L.objects.push({ type: 'headstone', x: gx2, y, w: 0.8, h: 0.4, rot: r.int(-8, 8), kind: r.pick(['slab', 'slab', 'cross', 'obelisk']) });
    taken.push({ x: gx2, y, w: 0.8, h: 1.6 });
    L.objects.push({ type: 'grave', x: gx2, y: y + 0.45, w: 0.8, h: 1.2, under: true });
  }
  for (let tries = 0; tries < 80; tries++) {
    const ox = r.int(3, cols - 4), oy = r.int(3, rows - 4);
    if (overlaps(taken, ox, oy, 1, 2, 0.5)) continue;
    L.objects.push({ type: 'opengrave', x: ox, y: oy, w: 1, h: 2 });
    L.objects.push({ type: 'spade', x: ox + 1.1, y: oy + 0.4, w: 0.4, h: 1 });
    break;
  }
}

function woods(L, r) {
  L.title = r.pick(['The Stones at Hob’s Hill', 'Blackmere Woods', 'Witch Hollow', 'The Long Copse', 'Esker Wood Clearing']);
  const { cols, rows } = L;
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'forest' });
  // a clearing with a stone circle, a stream across, a path, and a cabin
  const cx = cols * (0.35 + r() * 0.3), cy = rows * (0.35 + r() * 0.3), cr = Math.min(cols, rows) * 0.22;
  L.objects.push({ type: 'clearing', x: cx - cr * 1.3, y: cy - cr * 1.3, w: cr * 2.6, h: cr * 2.6 });
  const taken = [{ x: cx - cr * 1.2, y: cy - cr * 1.2, w: cr * 2.4, h: cr * 2.4 }];
  const stones = r.int(7, 9);
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + r() * 0.2;
    if (r() < 0.12) { L.objects.push({ type: 'fallenstone', x: cx + Math.cos(a) * cr - 0.6, y: cy + Math.sin(a) * cr - 0.3, w: 1.2, h: 0.6, rot: r.int(0, 180) }); continue; }
    blob(L, r, 'standingstone', cx + Math.cos(a) * cr, cy + Math.sin(a) * cr, 0.42);
  }
  L.objects.push({ type: 'altarstone', x: cx - 0.6, y: cy - 0.4, w: 1.2, h: 0.8 });
  // the stream
  const stream = []; let sy = r() < 0.5 ? r.int(1, Math.max(2, Math.floor(cy - cr - 2))) : r.int(Math.min(rows - 3, Math.ceil(cy + cr + 2)), rows - 2);
  for (let x = -1; x <= cols + 1; x++) { sy = Math.max(1, Math.min(rows - 2, sy + (r() - 0.5) * 0.9)); stream.push([x, +sy.toFixed(2)]); }
  L.objects.push({ type: 'stream', x: 0, y: 0, w: cols, h: rows, pts: stream });
  for (const [x, y] of stream) taken.push({ x: x - 0.5, y: y - 1, w: 1, h: 2 });
  // a track from the edge into the clearing
  const track = []; let tx = r.int(2, cols - 3);
  for (let y = rows; y >= cy; y -= 1) { tx += (cx - tx) * 0.15 + (r() - 0.5) * 0.8; track.push([+tx.toFixed(2), y]); }
  L.objects.push({ type: 'path', x: 0, y: 0, w: cols, h: rows, pts: track, earth: true });
  for (const [x, y] of track) taken.push({ x: x - 0.8, y: y - 0.5, w: 1.6, h: 1 });
  for (let tries = 0; tries < 30; tries++) {
    const w = r.int(3, 4), h = 3, x = r.int(1, cols - w - 1), y = r.int(1, rows - h - 1);
    if (overlaps(taken, x, y, w, h, 1)) continue;
    taken.push({ x, y, w, h });
    building(L, r, x, y, w, h, r.pick(['N', 'S', 'E', 'W']), { locked: r() < 0.5, name: 'Cabin door', mat: 'boards' });
    L.objects.push({ type: 'bed', x: x + 0.2, y: y + 0.5, w: 1, h: 2, room: 'cabin' }, { type: 'stove', x: x + w - 1.1, y: y + 0.2, w: 0.9, h: 0.9 });
    break;
  }
  // trees: trunks block sight; canopies are drawn over the top but don't
  const n = Math.round((cols * rows) / 9);
  for (let i = 0, made = 0; i < n * 4 && made < n; i++) {
    const rad = 0.28 + r() * 0.22, x = 0.5 + r() * (cols - 1), y = 0.5 + r() * (rows - 1);
    if (overlaps(taken, x - rad, y - rad, rad * 2, rad * 2, 0.5)) continue;
    taken.push({ x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 }); made++;
    blob(L, r, 'trunk', x, y, rad);
    L.objects.push({ type: 'canopy', x: x - rad * 4, y: y - rad * 4, w: rad * 8, h: rad * 8, hue: r.pick(['oak', 'pine', 'oak', 'birch']) });
  }
  for (let i = 0; i < Math.round(cols * rows / 20); i++) L.objects.push({ type: 'bush', x: r() * cols, y: r() * rows, w: 0.7, h: 0.7 });
}

function docks(L, r) {
  L.title = r.pick(['Pier 9, Blackmere Harbour', 'Coldbrook Wharf', 'The Old Fish Docks', 'Wexley Quay', 'Salter’s Landing']);
  const { cols, rows } = L;
  // water along the top, then the quay, warehouses at the bottom
  const waterH = Math.round(rows * 0.3);
  L.floors.push({ x: 0, y: 0, w: cols, h: rows, mat: 'cobbles' });
  L.floors.push({ x: 0, y: 0, w: cols, h: waterH, mat: 'water' });
  L.floors.push({ x: 0, y: waterH, w: cols, h: 3, mat: 'wharf' });
  // the quay edge blocks nothing, but piers stick out into the water
  const taken = [];
  for (let x = r.int(2, 4); x < cols - 3; x += r.int(7, 10)) {
    const len = r.int(Math.max(2, waterH - 3), waterH - 1);
    L.floors.push({ x, y: waterH - len, w: 2, h: len, mat: 'wharf' });
    L.objects.push({ type: 'pilings', x, y: waterH - len, w: 2, h: len });
    // a boat tied up alongside
    const bx = x + 2.2, by = waterH - len + 0.3;
    if (bx + 1.4 < cols) L.objects.push({ type: 'boat', x: bx, y: by, w: 1.4, h: Math.min(len - 0.5, 4), hue: r.pick([10, 200, 30]) });
  }
  for (let x = 1; x < cols; x += r.int(3, 5)) L.objects.push({ type: 'bollard', x, y: waterH + 0.1, w: 0.45, h: 0.45 });
  // warehouses
  const top = waterH + 4;
  let x = 0;
  while (x < cols - 3 && rows - top >= 3) {
    const w = Math.min(cols - x, r.int(6, 9)), h = Math.min(rows - top, r.int(4, rows - top));
    if (w < 4) break;
    building(L, r, x, top, w, h, 'N', { locked: r() < 0.6, name: r.pick(['Warehouse door', 'Cannery door', 'Customs shed door', 'Chandler’s door']), mat: 'boards' });
    taken.push({ x, y: top, w, h });
    // cargo inside, clear of the doorway on the north wall
    for (let j = top + 2; j < top + h - 1; j += 2) for (let i = x + 1; i < x + w - 1; i += 2) if (r() < 0.45) L.objects.push({ type: r.pick(['crate', 'crate', 'barrel', 'cratestack']), x: i, y: j, w: 1, h: 1 });
    L.objects.push({ type: 'shelf', x: x + w - 1.1, y: top + 1, w: 1, h: 2 });
    x += w + r.int(1, 2);
  }
  // cargo on the quay: stacks of crates block sight
  for (let i = 0; i < Math.round(cols / 4); i++) {
    const w = r.pick([1, 2]), h = r.pick([1, 2]), cx = r.int(1, cols - w - 1), cy = r.int(waterH + 1, top - 1);
    if (overlaps(taken, cx, cy, w, h, 0.5)) continue;
    taken.push({ x: cx, y: cy, w, h });
    L.objects.push({ type: 'cratestack', x: cx, y: cy, w, h, block: true });
    L.walls.push({ a: [cx, cy], b: [cx + w, cy], kind: 'wall' }, { a: [cx + w, cy], b: [cx + w, cy + h], kind: 'wall' }, { a: [cx + w, cy + h], b: [cx, cy + h], kind: 'wall' }, { a: [cx, cy + h], b: [cx, cy], kind: 'wall' });
  }
  for (let i = 0; i < Math.round(cols / 5); i++) L.objects.push({ type: r.pick(['rope', 'barrel', 'net', 'lobsterpot']), x: r() * (cols - 1), y: waterH + 0.3 + r() * 2.2, w: 0.8, h: 0.8 });
  for (let gx = 2; gx < cols; gx += r.int(6, 8)) L.objects.push({ type: 'gaslamp', x: gx, y: waterH + 2.4, w: 0.5, h: 0.5 });
  const placed = taken.map((t) => ({ ...t }));
  car(L, r, placed, r.int(1, cols - 4), top - 1.2, r() < 0.5 ? 0 : 180);
}
