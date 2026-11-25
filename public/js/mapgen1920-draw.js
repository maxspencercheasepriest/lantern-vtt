// Period art for the 1920s maps (shared/mapgen1920.js): parquet and flagstones, bookcases and chesterfields,
// gas lamps, headstones, standing stones. Our own drawings, all in code. mapgen-draw.js calls in here when a
// layout has `era: '1920s'`, and falls back to its own drawing for anything this file doesn't know.

export const MATS20 = {
  parquet: { base: '#6b4a2b' },
  boards: { base: '#5e4129', plank: '#47301d' },
  carpet: { base: '#521c20' },
  hextile: { base: '#d6d0c2' },
  flagstone: { base: '#6e665c' },
  stone: { base: '#8a8478', line: '#6f6a60' },
  cobbles: { base: '#4f4a44' },
  brick: { base: '#7a3e2e' },
  grass: { base: '#3d5530', speck: '#4a6638', grain: 1.4 },
  forest: { base: '#2c3a23', speck: '#3b2f1f', grain: 1.6 },
  water: { base: '#183039' },
  wharf: { base: '#6b6157', plank: '#544b43' },
  slate: { base: '#383c42', line: '#2c3035' },
};
// ground-level things: drawn before furniture, with no shadow
export const GROUND20 = ['rug', 'grave', 'path', 'stream', 'clearing', 'fence', 'tramlines', 'pilings', 'circle'];

/** Floors with a pattern of their own. Returns false to let the generic floor drawing do it. */
export function floor20(g, f, P, r) {
  const x = f.x * P, y = f.y * P, w = f.w * P, h = f.h * P;
  const m = MATS20[f.mat];
  if (!m || m.plank || m.line || (m.speck && f.mat !== 'grass' && f.mat !== 'forest')) return false;
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = m.base; g.fillRect(x, y, w, h);
  switch (f.mat) {
    case 'parquet': { // basket weave: squares of three strips, alternating direction
      const s = P / 2, t = s / 3;
      for (let j = 0; j * s < h; j++) for (let i = 0; i * s < w; i++) {
        const across = (i + j) % 2 === 0;
        for (let k = 0; k < 3; k++) {
          g.fillStyle = ['#70502f', '#654628', '#7a5834'][(i * 7 + j * 3 + k) % 3];
          across ? g.fillRect(x + i * s, y + j * s + k * t, s, t - 1) : g.fillRect(x + i * s + k * t, y + j * s, t - 1, s);
        }
      }
      break;
    }
    case 'carpet': { // a patterned carpet with a border
      g.strokeStyle = 'rgba(190,150,70,0.18)'; g.lineWidth = 2;
      const s = P / 2;
      for (let j = 0; j * s < h + s; j++) for (let i = 0; i * s < w + s; i++) {
        const cx = x + i * s, cy = y + j * s;
        g.beginPath(); g.moveTo(cx, cy - s / 3); g.lineTo(cx + s / 3, cy); g.lineTo(cx, cy + s / 3); g.lineTo(cx - s / 3, cy); g.closePath(); g.stroke();
      }
      g.strokeStyle = 'rgba(160,120,50,0.45)'; g.lineWidth = 5; g.strokeRect(x + 10, y + 10, w - 20, h - 20);
      break;
    }
    case 'hextile': { // little white tiles with black dots, as in every 1920s bathroom and ward
      const s = P / 5;
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
      for (let i = 0; i * s <= w; i++) { g.beginPath(); g.moveTo(x + i * s, y); g.lineTo(x + i * s, y + h); g.stroke(); }
      for (let j = 0; j * s <= h; j++) { g.beginPath(); g.moveTo(x, y + j * s); g.lineTo(x + w, y + j * s); g.stroke(); }
      g.fillStyle = '#2a2a2a';
      for (let j = 0; j * s < h; j += 2) for (let i = 0; i * s < w; i += 2) g.fillRect(x + i * s + s - 2, y + j * s + s - 2, 4, 4);
      break;
    }
    case 'flagstone': {
      const rowH = P / 2;
      for (let j = 0; j * rowH < h; j++) {
        let xx = x - r() * P * 0.5;
        while (xx < x + w) {
          const sw = P * (0.5 + r() * 0.6);
          g.fillStyle = ['#6e665c', '#655e55', '#776f64', '#6a6359'][Math.floor(r() * 4)];
          g.fillRect(xx + 2, y + j * rowH + 2, sw - 4, rowH - 4);
          xx += sw;
        }
      }
      break;
    }
    case 'cobbles': {
      const s = P / 5;
      for (let j = 0; j * s < h + s; j++) for (let i = 0; i * s < w + s; i++) {
        g.fillStyle = ['#5c564f', '#544e48', '#625b53', '#4c4741'][Math.floor(r() * 4)];
        g.beginPath(); g.ellipse(x + i * s + (j % 2) * s / 2 + (r() - 0.5) * 3, y + j * s + (r() - 0.5) * 3, s * 0.46, s * 0.4, r(), 0, 7); g.fill();
      }
      break;
    }
    case 'brick': {
      const bw = P / 2, bh = P / 4;
      for (let j = 0; j * bh < h; j++) for (let i = -1; i * bw < w; i++) {
        g.fillStyle = ['#7a3e2e', '#713827', '#834433'][Math.floor(r() * 3)];
        g.fillRect(x + i * bw + (j % 2) * bw / 2 + 1, y + j * bh + 1, bw - 2, bh - 2);
      }
      break;
    }
    case 'water': {
      g.strokeStyle = 'rgba(140,190,200,0.18)'; g.lineWidth = 2;
      for (let j = 0; j * 18 < h; j++) for (let i = 0; i * 60 < w; i++) {
        const xx = x + i * 60 + (j % 2) * 30 + r() * 10, yy = y + j * 18 + r() * 4;
        g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + 10, yy - 5, xx + 20, yy); g.stroke();
      }
      break;
    }
    case 'grass': case 'forest': {
      const n = Math.round((w * h) / 90 * m.grain);
      for (let i = 0; i < n; i++) {
        g.fillStyle = r() < 0.5 ? m.speck : f.mat === 'grass' ? '#33492a' : '#24301d';
        const px = x + r() * w, py = y + r() * h;
        if (f.mat === 'grass') g.fillRect(px, py, 1.5, 4 + r() * 3);
        else { g.beginPath(); g.ellipse(px, py, 2 + r() * 3, 1 + r() * 2, r() * 3, 0, 7); g.fill(); }
      }
      break;
    }
  }
  g.restore();
  return true;
}

/** Draw one object. Returns false for things this file leaves to mapgen-draw.js. */
export function object20(g, o, P, r) {
  const x = o.x * P, y = o.y * P, w = o.w * P, h = o.h * P;
  const cx = x + w / 2, cy = y + h / 2;
  const WOOD = '#4e321e', DARK = '#3a2415', BRASS = '#b8923f';
  g.save();
  const rotated = (fn) => {
    g.translate(cx, cy); g.rotate(((o.rot || 0) * Math.PI) / 180);
    const swap = (o.rot || 0) % 180 !== 0;
    fn(swap ? h : w, swap ? w : h);
  };
  let done = true;
  switch (o.type) {
    case 'rug': {
      g.fillStyle = `hsl(${o.hue} 45% 27%)`; g.fillRect(x + 6, y + 6, w - 12, h - 12);
      g.strokeStyle = `hsl(${o.hue} 40% 45%)`; g.lineWidth = 4; g.strokeRect(x + 14, y + 14, w - 28, h - 28);
      g.strokeStyle = `hsl(${(o.hue + 40) % 360} 35% 40%)`; g.lineWidth = 2; g.strokeRect(x + 22, y + 22, w - 44, h - 44);
      g.fillStyle = `hsl(${o.hue} 40% 38%)`; g.beginPath(); g.ellipse(cx, cy, w * 0.18, h * 0.18, 0, 0, 7); g.fill();
      g.fillStyle = '#d8ccb0'; for (const fx of [x + 6, x + w - 8]) for (let i = 0; i < h - 12; i += 6) g.fillRect(fx, y + 6 + i, 2, 3); // fringe
      break;
    }
    case 'stairs': rotated((W, H) => {
      box(-W / 2 + 4, -H / 2 + 2, W - 8, H - 4, '#5a3c24', DARK);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
      for (let i = 1; i < 7; i++) { const yy = -H / 2 + 2 + (i * (H - 4)) / 7; g.beginPath(); g.moveTo(-W / 2 + 10, yy); g.lineTo(W / 2 - 10, yy); g.stroke(); }
      g.fillStyle = '#6a1f24'; g.fillRect(-W * 0.18, -H / 2 + 4, W * 0.36, H - 8); // stair runner
      g.fillStyle = DARK; g.fillRect(-W / 2 + 4, -H / 2 + 2, 6, H - 4); g.fillRect(W / 2 - 10, -H / 2 + 2, 6, H - 4);
    }); break;
    case 'clock': box(x + 18, y + 12, w - 36, h - 24, '#4a2a16', '#2e1a0d'); g.fillStyle = '#e6dcc0'; g.beginPath(); g.arc(cx, cy - 4, P * 0.1, 0, 7); g.fill(); g.strokeStyle = BRASS; g.lineWidth = 2; g.stroke(); break;
    case 'sidetable': lampTable(cx, cy, P * 0.22); break;
    case 'fern': {
      g.fillStyle = '#7a4a2a'; g.beginPath(); g.arc(cx, cy, P * 0.2, 0, 7); g.fill();
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 7 + r() * 0.3; g.strokeStyle = i % 2 ? '#4f7a3a' : '#3c6430'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a) * P * 0.2, cy + Math.sin(a) * P * 0.2, cx + Math.cos(a + 0.3) * P * 0.36, cy + Math.sin(a + 0.3) * P * 0.36); g.stroke(); }
      break;
    }
    case 'chesterfield': rotated((W, H) => {
      box(-W / 2 + 4, -H / 2 + 8, W - 8, H - 14, '#6a2a1e', '#4a1c14');
      g.fillStyle = '#7d3424'; g.fillRect(-W / 2 + 14, -H / 2 + 20, W - 28, H - 32);
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-W / 2 + 18 + (i * (W - 36)) / 5, -H / 2 + 14, 2, 0, 7); g.fill(); }
    }); break;
    case 'armchair': rotated((W, H) => {
      const s = Math.min(W, H) * 0.8;
      g.fillStyle = '#2f4a35'; g.beginPath(); g.roundRect(-s / 2, -s / 2, s, s, 8); g.fill();
      g.fillStyle = '#3c5c43'; g.beginPath(); g.roundRect(-s / 2 + 8, -s / 2 + 12, s - 16, s - 16, 6); g.fill();
      g.fillStyle = '#26402c'; g.fillRect(-s / 2, -s / 2, s, 10);
    }); break;
    case 'fireplace': rotated((W, H) => {
      box(-W / 2 + 2, -H / 2 + 2, W - 4, H * 0.6, '#8a8276', '#6a6358');
      g.fillStyle = '#141110'; g.fillRect(-W * 0.28, -H / 2 + 4, W * 0.56, H * 0.38);
      const grd = g.createRadialGradient(0, -H * 0.2, 2, 0, -H * 0.2, P * 0.9);
      grd.addColorStop(0, 'rgba(255,190,90,0.7)'); grd.addColorStop(0.4, 'rgba(255,120,40,0.25)'); grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(0, -H * 0.2, P * 0.9, 0, 7); g.fill();
    }); break;
    case 'grandpiano': {
      g.fillStyle = '#121212';
      g.beginPath(); g.moveTo(x + 8, y + 10); g.lineTo(x + w - 10, y + 10); g.lineTo(x + w - 10, y + h * 0.45);
      g.bezierCurveTo(x + w - 10, y + h - 6, x + w * 0.35, y + h - 4, x + 8, y + h - 10); g.closePath(); g.fill();
      g.strokeStyle = '#3a3a3a'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#eee'; g.fillRect(x + 10, y + 10, w - 22, 7);
      g.fillStyle = '#111'; for (let i = 0; i < 14; i++) g.fillRect(x + 12 + i * (w - 26) / 14, y + 10, 2, 4);
      break;
    }
    case 'upright': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.45, '#1a1412', '#0e0a09'); g.fillStyle = '#eee'; g.fillRect(-W / 2 + 8, -H / 2 + 4 + H * 0.45 - 6, W - 16, 5); }); break;
    case 'bookcase': rotated((W, H) => {
      box(-W / 2 + 2, -H / 2 + 2, W - 4, H * 0.42, '#3e2716', '#2a1a0e');
      let bx = -W / 2 + 5;
      while (bx < W / 2 - 6) { const bw = 3 + r() * 4; g.fillStyle = ['#6a1f24', '#2f4a35', '#2b3a55', '#7a5a2a', '#4a2a4a', '#8a7a5a'][Math.floor(r() * 6)]; g.fillRect(bx, -H / 2 + 2 + H * 0.42 - 9, bw, 7); bx += bw + 0.6; }
    }); break;
    case 'table': {
      box(x + 6, y + 6, w - 12, h - 12, '#5a3a22', '#40291a');
      g.strokeStyle = 'rgba(255,220,160,0.1)'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + 8, y + 10 + i * (h - 20) / 3); g.lineTo(x + w - 8, y + 10 + i * (h - 20) / 3); g.stroke(); }
      if (o.seats) { const n = Math.max(1, Math.round(o.w)); for (let i = 0; i < n; i++) { chair(x + (i + 0.5) * (w / n), y - 2); chair(x + (i + 0.5) * (w / n), y + h + 2); } }
      if (o.lamp) bankerLamp(cx, cy);
      break;
    }
    case 'globe': g.fillStyle = DARK; g.beginPath(); g.arc(cx, cy, P * 0.26, 0, 7); g.fill(); g.fillStyle = '#4a6a6a'; g.beginPath(); g.arc(cx, cy, P * 0.2, 0, 7); g.fill(); g.fillStyle = '#b89a5a'; g.beginPath(); g.ellipse(cx - 4, cy - 2, P * 0.08, P * 0.12, 0.4, 0, 7); g.fill(); g.strokeStyle = BRASS; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, P * 0.23, 0, 7); g.stroke(); break;
    case 'sideboard': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.5, '#5a2a1a', '#3e1d12'); g.fillStyle = BRASS; for (let i = 0; i < 3; i++) g.fillRect(-W / 2 + 14 + i * (W - 28) / 2 - 2, -H / 2 + 12, 4, 3); }); break;
    case 'writingdesk': rotated((W, H) => {
      box(-W / 2 + 4, -H / 2 + 6, W - 8, H * 0.55, '#5a2a1a', '#3e1d12');
      g.fillStyle = '#2f4a35'; g.fillRect(-W * 0.3, -H / 2 + 10, W * 0.6, H * 0.3);
      g.fillStyle = '#e6dcc0'; g.save(); g.rotate(0.15); g.fillRect(-W * 0.1, -H / 2 + 12, W * 0.16, H * 0.2); g.restore();
      bankerLamp(W * 0.3, -H / 2 + 14);
      chair(0, H * 0.25);
    }); break;
    case 'range': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.6, '#1c1c1c', '#0e0e0e'); g.strokeStyle = '#555'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-W / 2 + 18 + i * (W - 36) / 2, -H / 2 + 4 + H * 0.3, P * 0.09, 0, 7); g.stroke(); } }); break;
    case 'dresser': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.45, '#6a4a2a', '#4a321c'); for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#c9d4dd' : '#e6e0d0'; g.beginPath(); g.arc(-W / 2 + 14 + i * (W - 28) / 4, -H / 2 + 12, 5, 0, 7); g.fill(); } }); break;
    case 'bed': {
      const vert = h >= w;
      box(x + 6, y + 4, w - 12, h - 8, '#4e321e', '#3a2415');
      g.fillStyle = '#d8ccb0'; vert ? g.fillRect(x + 10, y + 8, w - 20, h * 0.18) : g.fillRect(x + 8, y + 10, w * 0.18, h - 20);
      g.fillStyle = '#6a5a4a'; vert ? g.fillRect(x + 8, y + h * 0.32, w - 16, h * 0.6) : g.fillRect(x + w * 0.32, y + 8, w * 0.6, h - 16);
      break;
    }
    case 'washstand': box(x + 10, y + 10, w - 20, h - 20, '#6a4a2a', '#4a321c'); g.fillStyle = '#e8e4dc'; g.beginPath(); g.arc(cx, cy - 2, P * 0.15, 0, 7); g.fill(); break;
    case 'chest': box(x + 10, y + 14, w - 20, h - 26, '#5a3a20', '#3e2714'); g.fillStyle = '#2a2a2a'; g.fillRect(x + 18, y + 14, 4, h - 26); g.fillRect(x + w - 22, y + 14, 4, h - 26); g.fillStyle = BRASS; g.fillRect(cx - 3, y + 16, 6, 6); break;
    case 'barrel': g.fillStyle = '#6a4626'; g.beginPath(); g.arc(cx, cy, P * 0.3, 0, 7); g.fill(); g.strokeStyle = '#2e2a26'; g.lineWidth = 3; for (const k of [0.3, 0.2]) { g.beginPath(); g.arc(cx, cy, P * k, 0, 7); g.stroke(); } break;
    case 'circle': {
      g.strokeStyle = 'rgba(160,30,30,0.75)'; g.lineWidth = 3;
      for (const k of [1.1, 0.9]) { g.beginPath(); g.arc(cx, cy, P * k, 0, 7); g.stroke(); }
      g.fillStyle = 'rgba(160,30,30,0.8)'; g.font = `${P * 0.18}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const marks = '᚛ᚠᚢᚦᚨᚱᚲᚷᚹ'; // runic-looking marks
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 7; g.fillText(marks[i], cx + Math.cos(a) * P, cy + Math.sin(a) * P); }
      g.fillStyle = 'rgba(70,10,10,0.45)'; g.beginPath(); g.ellipse(cx + 6, cy - 4, P * 0.22, P * 0.15, 0.6, 0, 7); g.fill();
      break;
    }
    case 'altar': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.6, '#7e786e', '#5e594f'); g.fillStyle = '#5a1a1e'; g.fillRect(-W * 0.3, -H / 2 + 4, W * 0.6, H * 0.6 - 3); }); break;
    case 'candles': for (let i = 0; i < 4; i++) { const px = cx + (r() - 0.5) * w * 0.5, py = cy + (r() - 0.5) * h * 0.5; const grd = g.createRadialGradient(px, py, 1, px, py, P * 0.4); grd.addColorStop(0, 'rgba(255,210,120,0.55)'); grd.addColorStop(1, 'rgba(255,210,120,0)'); g.fillStyle = grd; g.beginPath(); g.arc(px, py, P * 0.4, 0, 7); g.fill(); g.fillStyle = '#e8e0c8'; g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill(); g.fillStyle = '#ffcf6b'; g.beginPath(); g.arc(px, py, 1.6, 0, 7); g.fill(); } break;
    case 'lectern': box(x + 16, y + 14, w - 32, h - 28, '#4e321e', '#3a2415'); g.fillStyle = '#e6dcc0'; g.fillRect(cx - 12, cy - 8, 11, 14); g.fillRect(cx + 1, cy - 8, 11, 14); g.fillStyle = '#6a1f24'; g.fillRect(cx - 1, cy - 9, 2, 16); break;
    case 'barcounter': {
      box(x + 2, y + 2, w - 4, h - 4, '#5a2a1a', '#3e1d12');
      const vert = h > w;
      g.fillStyle = BRASS; vert ? g.fillRect(x + w - 5, y + 4, 3, h - 8) : g.fillRect(x + 4, y + h - 5, w - 8, 3);
      const n = Math.round((vert ? h : w) / P) * 2;
      for (let i = 0; i < n; i++) { g.fillStyle = ['#7a5a2a', '#3a5a3a', '#d8ccb0'][i % 3]; const t = (i + 0.5) / n; g.beginPath(); g.arc(vert ? x + w * 0.35 : x + t * w, vert ? y + t * h : y + h * 0.35, 3, 0, 7); g.fill(); }
      break;
    }
    case 'stool': g.fillStyle = '#6a1f24'; g.beginPath(); g.arc(cx, cy, P * 0.14, 0, 7); g.fill(); g.strokeStyle = BRASS; g.lineWidth = 2; g.stroke(); break;
    case 'bandstand': box(x + 2, y + 2, w - 4, h - 4, '#5a3a22', '#3e2714'); g.strokeStyle = BRASS; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, w - 12, h - 12); g.fillStyle = '#111'; g.beginPath(); g.arc(x + w * 0.3, cy, 6, 0, 7); g.fill(); g.fillStyle = BRASS; g.beginPath(); g.arc(x + w * 0.65, cy, 8, 0, 7); g.fill(); break;
    case 'roundtable': {
      const rad = 0.3 * P;
      for (let i = 0; i < 3; i++) { const a = (i / 3) * 7 + 0.5; chair(cx + Math.cos(a) * rad * 1.55, cy + Math.sin(a) * rad * 1.55); }
      g.fillStyle = '#e8e2d2'; g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#ffcf6b'; g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fill();
      break;
    }
    case 'cardtable': {
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 7 + 0.8; chair(cx + Math.cos(a) * w * 0.42, cy + Math.sin(a) * h * 0.42); }
      g.fillStyle = '#3a2415'; g.beginPath(); g.arc(cx, cy, w * 0.34, 0, 7); g.fill();
      g.fillStyle = '#25583a'; g.beginPath(); g.arc(cx, cy, w * 0.3, 0, 7); g.fill();
      for (let i = 0; i < 5; i++) { g.save(); g.translate(cx + (r() - 0.5) * w * 0.3, cy + (r() - 0.5) * h * 0.3); g.rotate(r() * 3); g.fillStyle = '#f2efe6'; g.fillRect(-5, -7, 10, 14); g.restore(); }
      break;
    }
    case 'barberchair': g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(cx, cy, P * 0.26, 0, 7); g.fill(); g.fillStyle = '#7a1e24'; g.beginPath(); g.roundRect(cx - P * 0.18, cy - P * 0.2, P * 0.36, P * 0.4, 6); g.fill(); break;
    case 'mirror': rotated((W, H) => { g.fillStyle = BRASS; g.fillRect(-W / 2 + 6, -H / 2 + 1, W - 12, 7); g.fillStyle = '#a9c2c9'; g.fillRect(-W / 2 + 9, -H / 2 + 3, W - 18, 3); }); break;
    case 'bench': box(x + 4, y + 16, w - 8, h - 32, '#5a3a22', '#3e2714'); break;
    case 'cabinet': box(x + 10, y + 10, w - 20, h - 20, '#5a4a32', '#40341f'); g.fillStyle = BRASS; for (let i = 0; i < 3; i++) g.fillRect(cx - 4, y + 14 + i * (h - 28) / 3, 8, 3); break;
    case 'optable': box(x + 12, y + 6, w - 24, h - 12, '#d8d8d2', '#a8a8a2'); g.fillStyle = '#5a4a3a'; g.fillRect(x + 12, y + h * 0.35, w - 24, 5); g.fillRect(x + 12, y + h * 0.65, w - 24, 5); g.fillStyle = 'rgba(110,20,20,0.35)'; g.beginPath(); g.ellipse(cx + 4, cy + 10, 8, 5, 0.5, 0, 7); g.fill(); break;
    case 'trolley': box(x + 14, y + 16, w - 28, h - 32, '#b8bcc0', '#8a8e92'); g.fillStyle = '#555'; for (let i = 0; i < 3; i++) g.fillRect(x + 18 + i * 8, y + 22, 2, 10); break;
    case 'pew': {
      const vert = h > w;
      box(x + 3, y + 3, w - 6, h - 6, '#5a3a22', '#3e2714');
      g.fillStyle = '#3e2714'; vert ? g.fillRect(x + 3, y + 3, 6, h - 6) : g.fillRect(x + 3, y + 3, w - 6, 6);
      break;
    }
    case 'font': g.fillStyle = '#9a948a'; poly(octagon(cx, cy, P * 0.32)); g.fill(); g.fillStyle = '#3f5a66'; g.beginPath(); g.arc(cx, cy, P * 0.18, 0, 7); g.fill(); break;
    case 'organ': rotated((W, H) => { box(-W / 2 + 2, -H / 2 + 2, W - 4, H * 0.5, '#3e2716', '#2a1a0e'); g.fillStyle = '#c9b27a'; for (let i = 0; i < 9; i++) g.fillRect(-W / 2 + 8 + i * (W - 16) / 9, -H / 2 + 4, 4, H * 0.25); }); break;
    case 'wardrobe': rotated((W, H) => { box(-W / 2 + 4, -H / 2 + 4, W - 8, H * 0.6, '#4e321e', '#3a2415'); g.strokeStyle = '#2a1a0e'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -H / 2 + 6); g.lineTo(0, -H / 2 + H * 0.6); g.stroke(); }); break;
    case 'spiral': {
      g.fillStyle = '#6a6358'; g.beginPath(); g.arc(cx, cy, w * 0.42, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 7; g.beginPath(); g.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8); g.lineTo(cx + Math.cos(a) * w * 0.42, cy + Math.sin(a) * w * 0.42); g.stroke(); }
      g.fillStyle = '#3a3630'; g.beginPath(); g.arc(cx, cy, 8, 0, 7); g.fill();
      break;
    }
    case 'bellrope': g.strokeStyle = '#b89a6a'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy - 12); g.quadraticCurveTo(cx + 8, cy, cx, cy + 14); g.stroke(); g.fillStyle = '#6a1f24'; g.beginPath(); g.arc(cx, cy + 14, 5, 0, 7); g.fill(); break;
    case 'displaycase': box(x + 10, y + 10, w - 20, h - 20, '#4e321e', '#3a2415'); g.fillStyle = 'rgba(180,210,220,0.35)'; g.fillRect(x + 14, y + 14, w - 28, h - 32); g.fillStyle = r() < 0.5 ? '#c9a15a' : '#8a8a7a'; g.beginPath(); g.arc(cx, cy - 2, P * 0.08, 0, 7); g.fill(); break;
    case 'statue': g.fillStyle = '#8a8478'; g.fillRect(x + 12, y + 12, w - 24, h - 24); g.fillStyle = '#b0aa9c'; g.beginPath(); g.arc(cx, cy, P * 0.16, 0, 7); g.fill(); g.beginPath(); g.ellipse(cx, cy + 10, P * 0.18, P * 0.08, 0, 0, 7); g.fill(); break;
    case 'sarcophagus': { g.fillStyle = '#7e786e'; g.beginPath(); g.roundRect(x + 8, y + 6, w - 16, h - 12, 12); g.fill(); g.strokeStyle = '#5e594f'; g.lineWidth = 2; g.beginPath(); g.roundRect(x + 14, y + 12, w - 28, h - 24, 8); g.stroke(); g.beginPath(); g.moveTo(cx, y + 16); g.lineTo(cx, y + h - 16); g.stroke(); break; }
    // ----- outside -----
    case 'tramlines': {
      g.strokeStyle = '#8a8a8a'; g.lineWidth = 3;
      for (const k of [0.3, 0.42, 0.58, 0.7]) { g.beginPath(); g.moveTo(x, y + h * k); g.lineTo(x + w, y + h * k); g.stroke(); }
      break;
    }
    case 'awning': {
      for (let i = 0; i * 12 < w; i++) { g.fillStyle = i % 2 ? '#e8e2d2' : `hsl(${o.hue} 45% 35%)`; g.fillRect(x + i * 12, y, Math.min(12, w - i * 12), h); }
      g.fillStyle = '#e8e2d2'; g.font = `bold ${Math.min(14, P * 0.2)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(20,14,8,0.85)'; g.fillRect(cx - g.measureText(o.label).width / 2 - 4, cy - 8, g.measureText(o.label).width + 8, 16);
      g.fillStyle = '#e8dcc0'; g.fillText(o.label, cx, cy + 1);
      break;
    }
    case 'oldcar': rotated((W, H) => {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.roundRect(-W / 2 + 5, -H / 2 + 7, W, H, 8); g.fill();
      // running boards and mudguards, then the body: a long bonnet and a square cab
      g.fillStyle = '#151515'; g.fillRect(-W / 2 + 6, -H / 2, W - 12, H);
      const body = `hsl(${o.hue} ${o.hue ? 40 : 0}% ${o.hue ? 26 : 12}%)`;
      g.fillStyle = body; g.beginPath(); g.roundRect(-W / 2 + 2, -H / 2 + 6, W * 0.42, H - 12, 6); g.fill();
      g.beginPath(); g.roundRect(-W * 0.1, -H / 2 + 3, W * 0.55, H - 6, 4); g.fill();
      g.fillStyle = '#1e2226'; g.fillRect(-W * 0.06, -H / 2 + 7, W * 0.12, H - 14);
      g.fillStyle = '#d8d0b0'; g.beginPath(); g.arc(-W / 2 + 4, -H / 2 + 10, 4, 0, 7); g.arc(-W / 2 + 4, H / 2 - 10, 4, 0, 7); g.fill();
      g.fillStyle = '#9a9a9a'; g.fillRect(W * 0.45 - 4, -H * 0.25, 6, H * 0.5); // spare wheel
    }); break;
    case 'cart': rotated((W, H) => {
      box(-W / 2 + 4, -H / 2 + 6, W * 0.55, H - 12, '#6a4a2a', '#4a321c');
      g.fillStyle = '#2a2a2a'; g.fillRect(-W / 2 + W * 0.2, -H / 2 + 2, 10, 4); g.fillRect(-W / 2 + W * 0.2, H / 2 - 6, 10, 4);
      g.strokeStyle = '#5a3a22'; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.05, -H * 0.2); g.lineTo(W * 0.45, -H * 0.2); g.moveTo(W * 0.05, H * 0.2); g.lineTo(W * 0.45, H * 0.2); g.stroke();
      g.fillStyle = '#5a3b26'; g.beginPath(); g.ellipse(W * 0.3, 0, W * 0.13, H * 0.2, 0, 0, 7); g.fill(); // the horse
      g.beginPath(); g.ellipse(W * 0.45, 0, W * 0.06, H * 0.09, 0, 0, 7); g.fill();
    }); break;
    case 'gaslamp': { const grd = g.createRadialGradient(cx, cy, 2, cx, cy, P * 1.5); grd.addColorStop(0, 'rgba(255,200,110,0.32)'); grd.addColorStop(1, 'rgba(255,200,110,0)'); g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, P * 1.5, 0, 7); g.fill(); g.fillStyle = '#1a1a1a'; g.fillRect(cx - 5, cy - 5, 10, 10); g.fillStyle = '#ffd98a'; g.fillRect(cx - 3, cy - 3, 6, 6); break; }
    case 'postbox': g.fillStyle = '#a3201c'; g.beginPath(); g.arc(cx, cy, P * 0.2, 0, 7); g.fill(); g.fillStyle = '#111'; g.fillRect(cx - 6, cy - 2, 12, 3); break;
    case 'newsstand': box(x + 2, y + 4, w - 4, h - 8, '#2f4a35', '#203326'); g.fillStyle = '#e8e2d2'; for (let i = 0; i < 4; i++) g.fillRect(x + 6 + i * (w - 12) / 4, y + 8, (w - 12) / 4 - 3, h - 20); break;
    case 'hydrant': g.fillStyle = '#b02a1c'; g.beginPath(); g.arc(cx, cy, P * 0.14, 0, 7); g.fill(); g.fillStyle = '#7a1a10'; g.fillRect(cx - P * 0.2, cy - 3, P * 0.4, 6); break;
    case 'fence': {
      g.strokeStyle = '#1b1b1d'; g.lineWidth = 3;
      const gx = o.gate * P, gw = 2 * P;
      g.beginPath(); g.moveTo(gx, y + h); g.lineTo(x, y + h); g.lineTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(gx + gw, y + h); g.stroke();
      g.fillStyle = '#1b1b1d';
      const dots = (ax, ay, bx2, by2) => { const n = Math.round(Math.hypot(bx2 - ax, by2 - ay) / 9); for (let i = 0; i <= n; i++) { g.beginPath(); g.arc(ax + (bx2 - ax) * i / n, ay + (by2 - ay) * i / n, 2.4, 0, 7); g.fill(); } };
      dots(x, y, x + w, y); dots(x, y, x, y + h); dots(x + w, y, x + w, y + h); dots(x, y + h, gx, y + h); dots(gx + gw, y + h, x + w, y + h);
      g.strokeStyle = '#2a2a2c'; g.lineWidth = 3; g.beginPath(); g.moveTo(gx, y + h); g.lineTo(gx + gw * 0.45, y + h + P * 0.35); g.moveTo(gx + gw, y + h); g.lineTo(gx + gw * 0.55, y + h + P * 0.35); g.stroke(); // gates ajar
      break;
    }
    case 'path': {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = o.earth ? 'rgba(80,60,36,0.7)' : 'rgba(150,140,120,0.75)'; g.lineWidth = P * 1.2;
      g.beginPath(); o.pts.forEach(([px, py], i) => (i ? g.lineTo(px * P, py * P) : g.moveTo(px * P, py * P))); g.stroke();
      break;
    }
    case 'headstone': {
      g.translate(cx, cy); g.rotate(((o.rot || 0) * Math.PI) / 180);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
      g.fillStyle = '#8f8a80';
      if (o.kind === 'cross') { g.fillRect(-w * 0.12, -h / 2 - 6, w * 0.24, h + 6); g.fillRect(-w / 2, -h * 0.2, w, h * 0.4); }
      else if (o.kind === 'obelisk') { g.fillRect(-w * 0.3, -h / 2, w * 0.6, h); g.fillStyle = '#a7a296'; g.fillRect(-w * 0.15, -h / 2, w * 0.3, h); }
      else { g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, [8, 8, 2, 2]); g.fill(); }
      g.strokeStyle = 'rgba(40,60,30,0.35)'; g.lineWidth = 2; g.stroke();
      break;
    }
    case 'grave': g.fillStyle = 'rgba(30,40,22,0.35)'; g.beginPath(); g.roundRect(x + 4, y, w - 8, h, 10); g.fill(); break;
    case 'opengrave': g.fillStyle = '#4a3a28'; g.beginPath(); g.ellipse(cx + w * 0.7, cy, w * 0.5, h * 0.4, 0, 0, 7); g.fill(); g.fillStyle = '#0e0b08'; g.fillRect(x + 4, y + 4, w - 8, h - 8); g.strokeStyle = '#5a4632'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, w - 8, h - 8); break;
    case 'spade': g.strokeStyle = '#6a4a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, y + h * 0.7); g.stroke(); g.fillStyle = '#7a7a7a'; g.fillRect(cx - 6, y + h * 0.65, 12, h * 0.3); break;
    case 'canopy': {
      const tones = { oak: ['#3a5a2c', '#2f4c24'], pine: ['#24402e', '#1c3424'], birch: ['#5a7a3a', '#4a6a30'], yew: ['#1f3524', '#18291c'] }[o.hue] || ['#3a5a2c', '#2f4c24'];
      g.globalAlpha = 0.82;
      for (let i = 0; i < 7; i++) { const a = r() * 7, d = w * 0.18 * r(); g.fillStyle = tones[i % 2]; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, w * (0.25 + r() * 0.12), 0, 7); g.fill(); }
      g.globalAlpha = 1;
      break;
    }
    case 'trunk': case 'standingstone': {
      const col = o.type === 'trunk' ? ['#3a2a1a', '#2a1d12'] : ['#7a766c', '#58544c'];
      g.fillStyle = 'rgba(0,0,0,0.4)'; poly(o.pts.map(([px, py]) => [px * P + 5, py * P + 7])); g.fill();
      g.fillStyle = col[0]; poly(o.pts.map(([px, py]) => [px * P, py * P])); g.fill();
      g.strokeStyle = col[1]; g.lineWidth = 3; g.stroke();
      if (o.type === 'standingstone') { g.fillStyle = 'rgba(90,120,70,0.5)'; g.beginPath(); g.arc(cx - 4, cy - 3, 5, 0, 7); g.fill(); }
      break;
    }
    case 'fallenstone': g.translate(cx, cy); g.rotate((o.rot * Math.PI) / 180); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-w / 2 + 4, -h / 2 + 5, w, h); g.fillStyle = '#7a766c'; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 8); g.fill(); break;
    case 'altarstone': g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + 5, y + 7, w, h); g.fillStyle = '#6e6a62'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(110,20,20,0.5)'; g.beginPath(); g.ellipse(cx, cy, w * 0.25, h * 0.2, 0.4, 0, 7); g.fill(); break;
    case 'clearing': { const grd = g.createRadialGradient(cx, cy, 2, cx, cy, w / 2); grd.addColorStop(0, 'rgba(96,110,64,0.9)'); grd.addColorStop(0.7, 'rgba(80,96,52,0.7)'); grd.addColorStop(1, 'rgba(80,96,52,0)'); g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, w / 2, 0, 7); g.fill(); break; }
    case 'stream': {
      g.lineCap = 'round'; g.lineJoin = 'round';
      const line = () => { g.beginPath(); o.pts.forEach(([px, py], i) => (i ? g.lineTo(px * P, py * P) : g.moveTo(px * P, py * P))); g.stroke(); };
      g.strokeStyle = '#3a3324'; g.lineWidth = P * 1.05; line();
      g.strokeStyle = '#1f3a44'; g.lineWidth = P * 0.8; line();
      g.strokeStyle = 'rgba(160,200,210,0.18)'; g.lineWidth = 2; g.setLineDash([12, 18]); line(); g.setLineDash([]);
      break;
    }
    case 'bush': g.fillStyle = r() < 0.5 ? '#334a28' : '#2a3e22'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(cx + (r() - 0.5) * 16, cy + (r() - 0.5) * 16, 6 + r() * 5, 0, 7); g.fill(); } break;
    case 'pilings': g.fillStyle = '#2a241e'; for (let j = 0; j <= Math.round(h / (P * 0.8)); j++) for (const px of [x + 3, x + w - 3]) { g.beginPath(); g.arc(px, y + j * P * 0.8 + 4, 5, 0, 7); g.fill(); } break;
    case 'boat': { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(cx + 4, cy + 6, w / 2, h / 2, 0, 0, 7); g.fill(); g.fillStyle = `hsl(${o.hue} 35% 30%)`; g.beginPath(); g.ellipse(cx, cy, w / 2, h / 2, 0, 0, 7); g.fill(); g.fillStyle = '#7a5a3a'; g.beginPath(); g.ellipse(cx, cy, w / 2 - 6, h / 2 - 8, 0, 0, 7); g.fill(); g.fillStyle = '#5a3a22'; for (let i = 1; i < 3; i++) g.fillRect(x + 6, y + (i * h) / 3, w - 12, 5); break; }
    case 'bollard': g.fillStyle = '#1e1e1e'; g.beginPath(); g.arc(cx, cy, P * 0.18, 0, 7); g.fill(); g.strokeStyle = '#444'; g.lineWidth = 2; g.stroke(); break;
    case 'cratestack': for (let j = 0; j < o.h; j++) for (let i = 0; i < o.w; i++) { const bx = x + i * P, by = y + j * P; box(bx + 4, by + 4, P - 8, P - 8, '#7a5d3a', '#5c452b'); g.strokeStyle = '#4a3720'; g.lineWidth = 2; g.strokeRect(bx + 10, by + 10, P - 20, P - 22); } break;
    case 'rope': g.strokeStyle = '#b89a6a'; g.lineWidth = 3; for (const k of [0.3, 0.22, 0.14]) { g.beginPath(); g.arc(cx, cy, P * k, 0, 7); g.stroke(); } break;
    case 'net': g.strokeStyle = 'rgba(160,150,120,0.7)'; g.lineWidth = 1; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x + i * w / 5, y); g.lineTo(x + w - i * w / 5, y + h); g.stroke(); } break;
    case 'lobsterpot': box(x + 8, y + 10, w - 16, h - 20, '#6a5a3a', '#4a3e28'); g.strokeStyle = '#3a2e1c'; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + 10 + i * (w - 20) / 3, y + 10); g.lineTo(x + 10 + i * (w - 20) / 3, y + h - 12); g.stroke(); } break;
    case 'stove': g.fillStyle = '#1c1c1c'; g.beginPath(); g.arc(cx, cy, P * 0.3, 0, 7); g.fill(); g.fillStyle = '#ff8a3b'; g.beginPath(); g.arc(cx, cy, P * 0.08, 0, 7); g.fill(); break;
    default: done = false;
  }
  g.restore();
  return done;

  function box(bx, by, bw, bh, top, edge) { g.fillStyle = edge; g.fillRect(bx, by + 3, bw, bh); g.fillStyle = top; g.fillRect(bx, by, bw, bh - 3); }
  function chair(px, py) { g.fillStyle = '#3a2415'; g.beginPath(); g.roundRect(px - P * 0.13, py - P * 0.13, P * 0.26, P * 0.26, 4); g.fill(); g.fillStyle = '#5a3a22'; g.beginPath(); g.roundRect(px - P * 0.09, py - P * 0.09, P * 0.18, P * 0.18, 3); g.fill(); }
  function bankerLamp(px, py) {
    const grd = g.createRadialGradient(px, py, 1, px, py, P * 0.7); grd.addColorStop(0, 'rgba(255,220,140,0.35)'); grd.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(px, py, P * 0.7, 0, 7); g.fill();
    g.fillStyle = '#2f6a45'; g.beginPath(); g.ellipse(px, py, 8, 4, 0, 0, 7); g.fill();
  }
  function lampTable(px, py, rad) {
    g.fillStyle = '#4a2a16'; g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill();
    const grd = g.createRadialGradient(px, py, 1, px, py, P * 0.8); grd.addColorStop(0, 'rgba(255,210,130,0.4)'); grd.addColorStop(1, 'rgba(255,210,130,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(px, py, P * 0.8, 0, 7); g.fill();
    g.fillStyle = '#e8d8a8'; g.beginPath(); g.arc(px, py, rad * 0.45, 0, 7); g.fill();
  }
  function poly(pts) { g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); }
  function octagon(px, py, rad) { return Array.from({ length: 8 }, (_, i) => [px + Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8) * rad, py + Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8) * rad]); }
}
