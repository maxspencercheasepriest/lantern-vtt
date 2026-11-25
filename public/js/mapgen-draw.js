// Draws a generated battlemap (shared/mapgen.js) onto a canvas: floors, furniture, walls, doors.
// Our own top-down art, all drawn in code. `P` is pixels per grid square (70 matches Lantern's default grid).
import { rng } from '/shared/mapgen.js';
import { MATS20, GROUND20, floor20, object20 } from './mapgen1920-draw.js';

const MATS = {
  carpet: { base: '#2b3140', speck: '#363d50', grain: 0.5 },
  wood: { base: '#4a3324', plank: '#3c2a1e' },
  checker: { base: '#d8d4cc', alt: '#2a2a2e' },
  tile: { base: '#a9b1b6', line: '#8c949a' },
  metal: { base: '#3a4046', line: '#2c3136' },
  concrete: { base: '#5b5d5e', speck: '#4f5152', grain: 0.6 },
  pavement: { base: '#4a4c50', line: '#3e4044' },
  asphalt: { base: '#26282b', speck: '#2f3135', grain: 0.6 },
  road: { base: '#202225', speck: '#2a2c30', grain: 0.6 },
  roof: { base: '#34363b', line: '#2c2e33' },
  sand: { base: '#a08a63', speck: '#93805a', grain: 1 },
  planks: { base: '#5d4a36', plank: '#4d3c2c' },
  ruin: { base: '#4b4744', speck: '#57524e', grain: 1 },
  rubblefloor: { base: '#3e3a37', speck: '#4a4541', grain: 1 },
};

/** Render a layout to a new canvas. */
export function drawMap(L, P = 70, opts = {}) {
  const c = document.createElement('canvas');
  c.width = L.cols * P; c.height = L.rows * P;
  const g = c.getContext('2d');
  const r = rng(L.seed * 7919 + 17);
  const era = L.era === '1920s';
  for (const f of L.floors) if (!(era && floor20(g, f, P, r))) floor(g, f, P, r, era);
  // shadows under furniture and along walls give it depth
  const flat = ['lanes', 'track', 'crater', 'debris', 'scrub', 'scorch', 'fire', 'deadtree', 'canopy', 'bush', 'awning', 'gaslamp', 'candles', 'headstone', 'trunk', 'standingstone', ...GROUND20];
  for (const o of L.objects) if (!flat.includes(o.type)) shadowOf(g, o, P);
  const ground = ['lanes', 'track', 'crater', 'scorch', ...GROUND20];
  const draw = (o) => { if (!(era && object20(g, o, P, r))) object(g, o, P, r); };
  for (const o of L.objects.filter((o) => ground.includes(o.type))) draw(o);
  for (const o of L.objects.filter((o) => !ground.includes(o.type) && o.type !== 'canopy')) draw(o);
  walls(g, L, P, era);
  // treetops over everything else (they don't block sight; the trunks do)
  for (const o of L.objects.filter((o) => o.type === 'canopy')) draw(o);
  if (opts.devices) for (const d of L.devices) device(g, d, P);
  if (opts.devices) secretMarks(g, L, P);
  if (era) { g.fillStyle = 'rgba(112,78,36,0.10)'; g.fillRect(0, 0, c.width, c.height); } // a touch of sepia
  vignette(g, c.width, c.height);
  return c;
}

// ---------- floors ----------
function floor(g, f, P, r, era) {
  const m = (era && MATS20[f.mat]) || MATS[f.mat] || MATS.concrete;
  const x = f.x * P, y = f.y * P, w = f.w * P, h = f.h * P;
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = m.base; g.fillRect(x, y, w, h);
  if (f.mat === 'checker') {
    const s = P / 3;
    g.fillStyle = m.alt;
    for (let j = 0; j * s < h; j++) for (let i = 0; i * s < w; i++) if ((i + j) % 2) g.fillRect(x + i * s, y + j * s, s, s);
  } else if (m.plank) {
    const s = P / 4;
    g.strokeStyle = m.plank; g.lineWidth = 2;
    for (let j = 0; j * s < h; j++) {
      g.beginPath(); g.moveTo(x, y + j * s); g.lineTo(x + w, y + j * s); g.stroke();
      const off = (j % 3) * P * 0.6;
      for (let i = -1; i * P * 1.8 < w; i++) { const xx = x + i * P * 1.8 + off; g.beginPath(); g.moveTo(xx, y + j * s); g.lineTo(xx, y + (j + 1) * s); g.stroke(); }
    }
  } else if (m.line) {
    const s = f.mat === 'tile' ? P / 2 : f.mat === 'pavement' ? P : P / 2;
    g.strokeStyle = m.line; g.lineWidth = f.mat === 'metal' ? 1 : 1.5;
    for (let i = 0; i * s <= w; i++) { g.beginPath(); g.moveTo(x + i * s, y); g.lineTo(x + i * s, y + h); g.stroke(); }
    for (let j = 0; j * s <= h; j++) { g.beginPath(); g.moveTo(x, y + j * s); g.lineTo(x + w, y + j * s); g.stroke(); }
    if (f.mat === 'metal') { // tread plate dashes
      g.strokeStyle = '#464c53';
      for (let j = 0; j * 9 < h; j++) for (let i = 0; i * 9 < w; i++) { const xx = x + i * 9 + (j % 2) * 4, yy = y + j * 9; g.beginPath(); if ((i + j) % 2) { g.moveTo(xx, yy); g.lineTo(xx + 4, yy + 2); } else { g.moveTo(xx, yy + 2); g.lineTo(xx + 4, yy); } g.stroke(); }
    }
  }
  if (m.speck) { // noise speckle
    const n = Math.round((w * h) / 90 * m.grain);
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() < 0.5 ? m.speck : shade(m.base, -12);
      const sz = 1 + r() * 2.5;
      g.fillRect(x + r() * w, y + r() * h, sz, sz);
    }
  }
  if (f.mat === 'ruin' || f.mat === 'concrete' || f.mat === 'asphalt') cracks(g, x, y, w, h, r, f.mat === 'ruin' ? 14 : 4);
  g.restore();
}
function cracks(g, x, y, w, h, r, n) {
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.2;
  for (let i = 0; i < n * (w * h) / 400000; i++) {
    let px = x + r() * w, py = y + r() * h;
    g.beginPath(); g.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; g.lineTo(px, py); }
    g.stroke();
  }
}

// ---------- objects ----------
function shadowOf(g, o, P) {
  if (o.pts || o.type === 'sign' || o.type === 'streetlight') return;
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.filter = 'blur(4px)';
  g.fillRect(o.x * P + 4, o.y * P + 6, o.w * P, o.h * P);
  g.restore();
}

function object(g, o, P, r) {
  const x = o.x * P, y = o.y * P, w = o.w * P, h = o.h * P;
  const cx = x + w / 2, cy = y + h / 2;
  g.save();
  // turn things that face a wall (rot is 0/90/180/270 for furniture)
  const rotated = (fn) => {
    g.translate(cx, cy); g.rotate(((o.rot || 0) * Math.PI) / 180);
    const swap = (o.rot || 0) % 180 !== 0;
    fn(swap ? h : w, swap ? w : h);
  };
  switch (o.type) {
    case 'desk': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 6, W - 8, H * 0.45, '#5c5650', '#47423d'); g.fillStyle = '#111'; g.fillRect(-W * 0.22, -H / 2 + 8, W * 0.44, 5); glow('#59c3ff', 6, () => { g.fillStyle = '#59c3ff'; g.fillRect(-W * 0.2, -H / 2 + 9, W * 0.4, 2); }); chair(0, H * 0.18, P * 0.18); }); break;
    case 'bigdesk': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 6, W - 8, H * 0.55, '#3d2b22', '#2c1f19'); g.fillStyle = '#111'; g.fillRect(-W * 0.15, -H / 2 + 10, W * 0.3, 5); chair(0, H * 0.25, P * 0.22); }); break;
    case 'reception': rotated((W, H) => { box(-W / 2 + 2, -H / 2 + 8, W - 4, H * 0.5, '#2e2e36', '#1f1f25'); glow('#ff3bd4', 10, () => { g.fillStyle = '#ff3bd4'; g.fillRect(-W / 2 + 4, -H / 2 + 8 + H * 0.5 - 3, W - 8, 3); }); chair(0, -H * 0.3, P * 0.18); }); break;
    case 'table': {
      box(x + 6, y + 6, w - 12, h - 12, '#4b3a2e', '#3a2c22');
      if (o.seats) { const n = Math.max(1, Math.round(o.w)); for (let i = 0; i < n; i++) { chair(x + (i + 0.5) * (w / n), y - 2, P * 0.17); chair(x + (i + 0.5) * (w / n), y + h + 2, P * 0.17); } }
      break;
    }
    case 'roundtable': case 'cafetable': {
      const rad = (o.type === 'cafetable' ? 0.26 : 0.32) * P;
      for (let i = 0; i < (o.type === 'cafetable' ? 2 : 4); i++) { const a = (i / (o.type === 'cafetable' ? 2 : 4)) * Math.PI * 2 + 0.6; chair(cx + Math.cos(a) * rad * 1.5, cy + Math.sin(a) * rad * 1.5, P * 0.13); }
      g.fillStyle = o.type === 'cafetable' ? '#c9c2b5' : '#3c2c22'; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2; g.stroke();
      break;
    }
    case 'chair': chair(cx, cy, P * 0.18); break;
    case 'sofa': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 8, W - 8, H - 14, '#5a2338', '#41192a'); g.fillStyle = '#6d2c45'; g.fillRect(-W / 2 + 10, -H / 2 + 18, W - 20, H - 30); }); break;
    case 'plant': g.fillStyle = '#3b2b20'; g.beginPath(); g.arc(cx, cy, P * 0.22, 0, 7); g.fill(); for (let i = 0; i < 7; i++) { const a = r() * 7; g.fillStyle = i % 2 ? '#3f7a3a' : '#2f6030'; g.beginPath(); g.ellipse(cx + Math.cos(a) * P * 0.12, cy + Math.sin(a) * P * 0.12, P * 0.16, P * 0.07, a, 0, 7); g.fill(); } break;
    case 'cabinet': case 'locker': box(x + 8, y + 8, w - 16, h - 16, o.type === 'locker' ? '#556070' : '#6b6b6b', '#4a4a4a'); g.strokeStyle = '#333'; g.beginPath(); g.moveTo(cx, y + 10); g.lineTo(cx, y + h - 10); g.stroke(); break;
    case 'safe': box(x + 12, y + 12, w - 24, h - 24, '#2d3238', '#1c2024'); g.strokeStyle = '#8a8f96'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, P * 0.1, 0, 7); g.stroke(); break;
    case 'screen': rotated((W, H) => { g.fillStyle = '#0d0f14'; g.fillRect(-W / 2 + 8, -H / 2 + 4, W - 16, 8); glow('#4cf2ff', 14, () => { g.fillStyle = '#4cf2ff'; g.fillRect(-W / 2 + 10, -H / 2 + 6, W - 20, 3); }); }); break;
    case 'rack': {
      box(x + 6, y + 4, w - 12, h - 8, '#1b1e23', '#101215');
      const vert = h > w;
      for (let i = 0; i < 10; i++) { const col = r() < 0.15 ? '#ff4d4d' : r() < 0.5 ? '#3dff8a' : '#3db7ff'; glow(col, 5, () => { g.fillStyle = col; vert ? g.fillRect(x + 10 + (i % 2) * (w - 24), y + 10 + (i * (h - 20)) / 10, 3, 3) : g.fillRect(x + 10 + (i * (w - 20)) / 10, y + 10 + (i % 2) * (h - 24), 3, 3); }); }
      break;
    }
    case 'console': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 6, W - 8, H * 0.5, '#23272f', '#171a20'); for (let i = 0; i < 3; i++) glow('#ffb43b', 8, () => { g.fillStyle = '#ffb43b'; g.fillRect(-W / 2 + 10 + i * (W - 20) / 3, -H / 2 + 10, (W - 20) / 3 - 6, 4); }); chair(0, H * 0.25, P * 0.17); chair(-W * 0.3, H * 0.25, P * 0.17); }); break;
    case 'cooler': box(x + 6, y + 6, w - 12, h - 12, '#7d8790', '#5c656d'); for (let i = 0; i < 2; i++) { g.strokeStyle = '#3a4147'; g.lineWidth = 3; g.beginPath(); g.arc(x + w * (0.3 + i * 0.4), cy, P * 0.25, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x + w * (0.3 + i * 0.4) - P * 0.2, cy); g.lineTo(x + w * (0.3 + i * 0.4) + P * 0.2, cy); g.stroke(); } break;
    case 'pipe': g.fillStyle = '#6f777f'; g.fillRect(cx - 6, y + 4, 12, h - 8); break;
    case 'battery': box(x + 8, y + 6, w - 16, h - 12, '#2e3a2e', '#202a20'); glow('#7dff6b', 6, () => { g.fillStyle = '#7dff6b'; g.fillRect(cx - 2, y + 12, 4, 4); }); break;
    case 'weaponrack': box(x + 8, y + 6, w - 16, h - 12, '#3a3a3a', '#262626'); g.strokeStyle = '#111'; g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + 14, y + 14 + i * (h - 28) / 3); g.lineTo(x + w - 14, y + 14 + i * (h - 28) / 3); g.stroke(); } break;
    case 'mirror': rotated((W, H) => { g.fillStyle = '#8fb3c2'; g.fillRect(-W / 2 + 6, -H / 2 + 2, W - 12, 5); }); break;
    case 'bunk': box(x + 8, y + 6, w - 16, h - 12, '#5b6168', '#3f444a'); g.fillStyle = '#8f8a7c'; g.fillRect(x + 10, y + 8, w - 20, h * 0.28); break;
    case 'bench': box(x + 4, y + 18, w - 8, h - 36, '#5d5f63', '#46484c'); break;
    case 'toilet': g.fillStyle = '#e4e6e8'; g.beginPath(); g.ellipse(cx, cy + 4, P * 0.18, P * 0.24, 0, 0, 7); g.fill(); g.fillRect(cx - P * 0.2, y + 8, P * 0.4, P * 0.14); break;
    case 'sink': g.fillStyle = '#d9dcdf'; g.fillRect(x + 10, y + 10, w - 20, h - 26); g.fillStyle = '#9aa1a6'; g.beginPath(); g.ellipse(cx, y + h * 0.4, P * 0.15, P * 0.1, 0, 0, 7); g.fill(); break;
    case 'counter': rotated((W, H) => box(-W / 2 + 2, -H / 2 + 4, W - 4, H * 0.55, '#7c7f84', '#5d6065')); break;
    case 'stove': box(x + 6, y + 6, w - 12, h - 12, '#2b2b2b', '#1a1a1a'); for (let i = 0; i < 4; i++) { g.strokeStyle = '#ff6a2b'; g.lineWidth = 2; g.beginPath(); g.arc(x + w * (0.33 + (i % 2) * 0.34), y + h * (0.33 + Math.floor(i / 2) * 0.34), P * 0.1, 0, 7); g.stroke(); } break;
    case 'fridge': box(x + 6, y + 6, w - 12, h - 12, '#d3d6d9', '#aeb2b6'); break;
    case 'vending': box(x + 8, y + 8, w - 16, h - 16, '#1d2a3a', '#111a24'); glow('#ff3b6e', 10, () => { g.fillStyle = '#ff3b6e'; g.fillRect(x + 10, y + 10, w - 20, 4); }); break;
    case 'shelf': box(x + 6, y + 4, w - 12, h - 8, '#6a5a46', '#4f4334'); for (let i = 0; i < 4; i++) { g.fillStyle = ['#8a6d47', '#5d7a8a', '#9a4a3a', '#6b6b6b'][i]; g.fillRect(x + 10, y + 8 + i * (h - 16) / 4, w - 20, (h - 16) / 4 - 4); } break;
    case 'crate': box(x + 8, y + 8, w - 16, h - 16, '#7a5d3a', '#5c452b'); g.strokeStyle = '#4a3720'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 8, y + 8); g.lineTo(x + w - 8, y + h - 8); g.moveTo(x + w - 8, y + 8); g.lineTo(x + 8, y + h - 8); g.stroke(); break;
    case 'pallet': box(x + 6, y + 6, w - 12, h - 12, '#8b6f4a', '#6d5638'); for (let i = 0; i < 4; i++) { g.fillStyle = '#7a5d3a'; g.fillRect(x + 12 + i * (w - 24) / 4, y + 12, (w - 24) / 4 - 6, h - 24); } break;
    case 'barcounter': {
      box(x + 2, y + 2, w - 4, h - 4, '#3a2418', '#2a1a11');
      const vert = h > w;
      glow('#ff2bd6', 14, () => { g.fillStyle = '#ff2bd6'; vert ? g.fillRect(x + w - 5, y + 4, 3, h - 8) : g.fillRect(x + 4, y + h - 5, w - 8, 3); });
      for (let i = 0; i < Math.round((vert ? h : w) / P) * 2; i++) { g.fillStyle = ['#b8e0ff', '#ffcf6b', '#9bffb3'][i % 3]; const t = (i + 0.5) / (Math.round((vert ? h : w) / P) * 2); g.beginPath(); g.arc(vert ? x + w * 0.35 : x + t * w, vert ? y + t * h : y + h * 0.35, 3, 0, 7); g.fill(); }
      break;
    }
    case 'stool': g.fillStyle = '#8a1f3a'; g.beginPath(); g.arc(cx, cy, P * 0.14, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 2; g.stroke(); break;
    case 'booth': rotated((W, H) => { g.fillStyle = '#4a1530'; g.fillRect(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.22); g.fillRect(-W / 2 + 4, H / 2 - 4 - H * 0.22, W - 8, H * 0.22); box(-W / 2 + 14, -H * 0.18, W - 28, H * 0.36, '#2d2622', '#1f1a17'); glow('#3bd5ff', 10, () => { g.fillStyle = '#3bd5ff'; g.fillRect(-W / 2 + 6, -H / 2 + 4, 3, H - 8); }); }); break;
    case 'pooltable': box(x + 4, y + 8, w - 8, h - 16, '#3a2414', '#2a190e'); g.fillStyle = '#1f6b46'; g.fillRect(x + 10, y + 14, w - 20, h - 28); break;
    case 'stage': box(x + 2, y + 2, w - 4, h - 4, '#1c1c22', '#121216'); glow('#ffe14d', 16, () => { g.strokeStyle = '#ffe14d'; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, w - 12, h - 12); }); break;
    case 'jukebox': box(x + 10, y + 8, w - 20, h - 16, '#3a1d4a', '#28123a'); glow('#ff8a3b', 12, () => { g.fillStyle = '#ff8a3b'; g.beginPath(); g.arc(cx, cy, P * 0.12, 0, 7); g.fill(); }); break;
    case 'lanes': {
      g.strokeStyle = '#d9c84a'; g.lineWidth = 4; g.setLineDash([P * 0.6, P * 0.5]);
      g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(230,230,230,0.6)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + w, y + 6); g.moveTo(x, y + h - 6); g.lineTo(x + w, y + h - 6); g.stroke();
      // a crossing
      const zx = x + w * 0.62;
      g.fillStyle = 'rgba(230,230,230,0.55)'; for (let j = 0; j < Math.floor(h / 16); j++) g.fillRect(zx, y + 10 + j * 16, P * 1.4, 9);
      break;
    }
    case 'car': rotated((W, H) => car(W, H, o)); break;
    case 'dumpster': box(x + 2, y + 2, w - 4, h - 4, '#2f5a3a', '#204029'); break;
    case 'bin': g.fillStyle = '#3a3d42'; g.beginPath(); g.arc(cx, cy, P * 0.2, 0, 7); g.fill(); break;
    case 'barrier': box(x, y + h * 0.3, w, h * 0.4, '#c9c9c9', '#9a9a9a'); g.fillStyle = '#d13a2a'; for (let i = 0; i < 3; i++) g.fillRect(x + i * w / 3 + 2, y + h * 0.3, w / 6, h * 0.4); break;
    case 'streetlight': { const grd = g.createRadialGradient(cx, cy, 2, cx, cy, P * 1.4); grd.addColorStop(0, 'rgba(255,220,160,0.28)'); grd.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, P * 1.4, 0, 7); g.fill(); g.fillStyle = '#eee'; g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill(); break; }
    case 'scorch': { const grd = g.createRadialGradient(cx, cy, 2, cx, cy, w / 2); grd.addColorStop(0, 'rgba(10,8,6,0.75)'); grd.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, w / 2, 0, 7); g.fill(); break; }
    case 'barrel': g.fillStyle = '#4b5a3a'; g.beginPath(); g.arc(cx, cy, P * 0.22, 0, 7); g.fill(); g.strokeStyle = '#2e3824'; g.lineWidth = 3; g.stroke(); break;
    case 'deadtree': g.strokeStyle = '#4a3a2a'; g.lineWidth = 4; for (let i = 0; i < 5; i++) { const a = r() * 7; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * P * 0.5, cy + Math.sin(a) * P * 0.5); g.stroke(); } g.fillStyle = '#3a2d20'; g.beginPath(); g.arc(cx, cy, 6, 0, 7); g.fill(); break;
    case 'sign': { const col = `hsl(${o.hue ?? 300} 100% 62%)`; glow(col, 18, () => { g.fillStyle = col; g.fillRect(x, y, w, Math.max(5, h * 0.35)); }); break; }
    case 'track': {
      g.strokeStyle = 'rgba(70,52,30,0.55)'; g.lineWidth = P * 1.7; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); o.pts.forEach(([px, py], i) => (i ? g.lineTo(px * P, py * P) : g.moveTo(px * P, py * P))); g.stroke();
      g.strokeStyle = 'rgba(50,36,20,0.5)'; g.lineWidth = 4; g.setLineDash([10, 8]);
      for (const off of [-0.35, 0.35]) { g.beginPath(); o.pts.forEach(([px, py], i) => (i ? g.lineTo(px * P, (py + off) * P) : g.moveTo(px * P, (py + off) * P))); g.stroke(); }
      g.setLineDash([]);
      break;
    }
    case 'rock': case 'rubble': {
      const col = o.type === 'rock' ? ['#7a6a52', '#5f523f'] : ['#625d58', '#4a4643'];
      g.fillStyle = 'rgba(0,0,0,0.35)'; poly(o.pts.map(([px, py]) => [px * P + 6, py * P + 8])); g.fill();
      g.fillStyle = col[0]; poly(o.pts.map(([px, py]) => [px * P, py * P])); g.fill();
      g.strokeStyle = col[1]; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.08)'; poly(o.pts.slice(0, Math.ceil(o.pts.length / 2)).map(([px, py]) => [px * P, py * P]).concat([[cx, cy]])); g.fill();
      if (o.type === 'rubble') for (let i = 0; i < 8; i++) { g.fillStyle = r() < 0.5 ? '#7a746e' : '#3d3a37'; g.fillRect(cx + (r() - 0.5) * w * 0.7, cy + (r() - 0.5) * h * 0.7, 6 + r() * 8, 5 + r() * 7); }
      break;
    }
    case 'scrub': g.fillStyle = r() < 0.5 ? '#6b6a3c' : '#5a5a33'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(cx + (r() - 0.5) * 18, cy + (r() - 0.5) * 18, 5 + r() * 5, 0, 7); g.fill(); } break;
    case 'crater': {
      const grd = g.createRadialGradient(cx, cy, 2, cx, cy, w / 2);
      grd.addColorStop(0, '#1a1816'); grd.addColorStop(0.65, '#2c2926'); grd.addColorStop(0.9, '#5d5650'); grd.addColorStop(1, 'rgba(93,86,80,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, w / 2, 0, 7); g.fill();
      break;
    }
    case 'sandbags': {
      const vert = h > w, n = Math.round((vert ? h : w) / (P * 0.45));
      for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#8a7a55' : '#7a6b4a'; g.beginPath(); vert ? g.ellipse(cx, y + (i + 0.5) * h / n, w * 0.5, h / n * 0.6, 0, 0, 7) : g.ellipse(x + (i + 0.5) * w / n, cy, w / n * 0.6, h * 0.5, 0, 0, 7); g.fill(); g.strokeStyle = '#4f4530'; g.lineWidth = 1.5; g.stroke(); }
      break;
    }
    case 'fire': {
      const grd = g.createRadialGradient(cx, cy, 2, cx, cy, P * 0.8);
      grd.addColorStop(0, 'rgba(255,230,140,0.95)'); grd.addColorStop(0.3, 'rgba(255,120,30,0.7)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, P * 0.8, 0, 7); g.fill();
      g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(cx, cy, P * 0.2, 0, 7); g.fill();
      g.fillStyle = '#ffb02e'; g.beginPath(); g.arc(cx, cy, P * 0.13, 0, 7); g.fill();
      break;
    }
    case 'debris': g.translate(cx, cy); g.rotate(((o.rot || 0) * Math.PI) / 180); g.fillStyle = r() < 0.5 ? '#6d6862' : '#2e2b29'; g.fillRect(-w / 2, -h / 2, w, h); break;
    default: box(x + 8, y + 8, w - 16, h - 16, '#666', '#444');
  }
  g.restore();

  function box(bx, by, bw, bh, top, edge) { g.fillStyle = edge; g.fillRect(bx, by + 3, bw, bh); g.fillStyle = top; g.fillRect(bx, by, bw, bh - 3); }
  function chair(px, py, rad) { g.fillStyle = '#1e2026'; g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill(); g.fillStyle = '#30333b'; g.beginPath(); g.arc(px, py, rad * 0.65, 0, 7); g.fill(); }
  function glow(col, blur, fn) { g.save(); g.shadowColor = col; g.shadowBlur = blur; fn(); g.restore(); }
  function poly(pts) { g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); }
  function car(W, H, o) {
    const body = o.wreck ? '#3a332e' : `hsl(${o.hue ?? 0} 55% 38%)`;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.roundRect(-W / 2 + 6, -H / 2 + 8, W, H, 14); g.fill();
    g.fillStyle = body; g.beginPath(); g.roundRect(-W / 2, -H / 2, W, H, 14); g.fill();
    g.fillStyle = o.wreck ? '#1d1a18' : '#141a22'; g.beginPath(); g.roundRect(-W * 0.18, -H / 2 + 7, W * 0.42, H - 14, 8); g.fill();
    if (!o.wreck) { g.save(); g.shadowColor = '#fff6c0'; g.shadowBlur = 12; g.fillStyle = '#fff6c0'; g.fillRect(W / 2 - 5, -H / 2 + 6, 3, 8); g.fillRect(W / 2 - 5, H / 2 - 14, 3, 8); g.restore(); g.fillStyle = '#ff2b2b'; g.fillRect(-W / 2 + 2, -H / 2 + 6, 3, 8); g.fillRect(-W / 2 + 2, H / 2 - 14, 3, 8); }
    if (o.burning) { const grd = g.createRadialGradient(0, 0, 2, 0, 0, W * 0.6); grd.addColorStop(0, 'rgba(255,200,90,0.85)'); grd.addColorStop(0.5, 'rgba(255,90,20,0.45)'); grd.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = grd; g.beginPath(); g.arc(0, 0, W * 0.6, 0, 7); g.fill(); }
  }
}

// ---------- walls and doors ----------
function walls(g, L, P, era) {
  // secret doors are painted as plain wall: the picture mustn't give them away
  const solid = L.walls.filter((w) => (w.kind === 'wall' || w.secret) && !L.objects.some((o) => o.pts && o.pts.some(([px, py]) => px === w.a[0] && py === w.a[1])));
  const thick = L.interior ? 12 : 10;
  const col = era ? { edge: '#1a120c', core: '#6a5844', door: '#7a5532', locked: '#4a3a2e' } : { edge: '#0d0e10', core: '#2c2f35', door: '#6b4f35', locked: '#4b5563' };
  g.save();
  g.lineCap = 'square';
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 10;
  g.strokeStyle = col.edge; g.lineWidth = thick;
  g.beginPath(); for (const w of solid) { g.moveTo(w.a[0] * P, w.a[1] * P); g.lineTo(w.b[0] * P, w.b[1] * P); } g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = col.core; g.lineWidth = thick - 6;
  g.beginPath(); for (const w of solid) { g.moveTo(w.a[0] * P, w.a[1] * P); g.lineTo(w.b[0] * P, w.b[1] * P); } g.stroke();
  for (const w of L.walls.filter((x) => x.kind === 'door' && !x.secret)) {
    const ax = w.a[0] * P, ay = w.a[1] * P, bx = w.b[0] * P, by = w.b[1] * P;
    const vert = ax === bx;
    g.fillStyle = col.edge;
    vert ? g.fillRect(ax - thick / 2, ay, thick, 5) : g.fillRect(ax, ay - thick / 2, 5, thick);
    vert ? g.fillRect(bx - thick / 2, by - 5, thick, 5) : g.fillRect(bx - 5, by - thick / 2, 5, thick);
    g.fillStyle = w.locked ? col.locked : col.door;
    vert ? g.fillRect(ax - 3, ay + 5, 6, by - ay - 10) : g.fillRect(ax + 5, ay - 3, bx - ax - 10, 6);
  }
  g.restore();
}

/** GM-only markers for devices (used in the generator preview). */
function device(g, d, P) {
  const x = d.x * P, y = d.y * P;
  const col = { camera: '#4cf2ff', lock: '#ffb43b', alarm: '#ff3b3b', turret: '#ff3bd4' }[d.type] || '#fff';
  g.save();
  if (d.type === 'camera') {
    g.fillStyle = 'rgba(76,242,255,0.12)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, P * 4, d.dir - 0.6, d.dir + 0.6); g.closePath(); g.fill();
  }
  g.shadowColor = col; g.shadowBlur = 10; g.fillStyle = col;
  g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
  g.restore();
}

/** GM-only: where the secret doors are (generator preview). */
function secretMarks(g, L, P) {
  g.save();
  g.strokeStyle = '#b07cff'; g.lineWidth = 5; g.setLineDash([5, 4]); g.shadowColor = '#b07cff'; g.shadowBlur = 8;
  for (const w of L.walls.filter((x) => x.secret)) { g.beginPath(); g.moveTo(w.a[0] * P, w.a[1] * P); g.lineTo(w.b[0] * P, w.b[1] * P); g.stroke(); }
  g.restore();
}

function vignette(g, w, h) {
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
