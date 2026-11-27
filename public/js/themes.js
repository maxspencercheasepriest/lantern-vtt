// Theme artwork, drawn here as SVG (our own art, no pictures to load) with a few gentle animations (CSS in app.css,
// off for people who ask for less motion). Each theme draws the left side; the right side is the same art mirrored.
// Two ways to show one: applyTheme() puts it either side of a page (Lantern Plus's Your games), themeBackdrop() puts it
// behind something, like the map at the table (a game's theme, Scene tab). The list is in /shared/themes.js.
import { THEMES } from '/shared/themes.js';
import { serverUrl } from './net.js';

export { THEMES };

const W = 420, H = 1000;
// a little seeded randomness, so the art is the same every time
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const f = (n) => Math.round(n * 10) / 10;
const stars = (r, n, y0, y1, cls = 'tw') => Array.from({ length: n }, (_, i) => `<circle class="${i % 3 ? '' : cls}" style="animation-delay:${f(r() * 4)}s" cx="${f(r() * W)}" cy="${f(y0 + r() * (y1 - y0))}" r="${f(0.4 + r() * 1.3)}" fill="#fff" opacity="${f(0.3 + r() * 0.7)}"/>`).join('');

function fantasy() {
  const r = rng(11);
  let bricks = '';
  for (let y = 300; y < H; y += 22) {
    const off = (y / 22) % 2 ? 0 : 24;
    for (let x = -off; x < 190; x += 48) bricks += `<rect x="${x}" y="${y}" width="46" height="20" rx="2" fill="#2b2f3d" opacity="${f(0.55 + r() * 0.45)}"/>`;
  }
  let ivy = '';
  for (let k = 0; k < 3; k++) {
    let x = 150 + k * 14, y = 330 + k * 60, d = `M${x} ${y}`;
    for (let s = 0; s < 14; s++) { const nx = x + (r() - 0.6) * 30, ny = y + 28 + r() * 20; d += ` Q${f(x + (r() - 0.5) * 40)} ${f(y + 14)} ${f(nx)} ${f(ny)}`; x = nx; y = ny; ivy += `<ellipse cx="${f(nx + 5)}" cy="${f(ny - 4)}" rx="6" ry="3.5" transform="rotate(${f(r() * 90 - 45)} ${f(nx + 5)} ${f(ny - 4)})" fill="#2f5a34"/>`; }
    ivy = `<path d="${d}" stroke="#244529" stroke-width="2.5" fill="none"/>` + ivy;
  }
  return `
  <defs>
    <linearGradient id="fa-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1330"/><stop offset="0.7" stop-color="#1d2346"/><stop offset="1" stop-color="#2b2540"/></linearGradient>
    <radialGradient id="fa-glow"><stop offset="0" stop-color="#ffcf6b" stop-opacity="0.75"/><stop offset="1" stop-color="#ffb040" stop-opacity="0"/></radialGradient>
    <radialGradient id="fa-win"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#d8781e"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fa-sky)"/>
  ${stars(r, 90, 0, 600)}
  <circle cx="300" cy="120" r="34" fill="#f3ead0"/><circle cx="314" cy="110" r="32" fill="#0d1532"/>
  <path d="M0 ${H} L0 760 L60 700 L120 750 L190 640 L260 720 L330 660 L${W} 740 L${W} ${H} Z" fill="#161a2e"/>
  <path d="M0 ${H} L0 840 L90 790 L170 830 L260 780 L350 830 L${W} 800 L${W} ${H} Z" fill="#11131f"/>
  <!-- the tower -->
  <rect x="0" y="300" width="190" height="${H - 300}" fill="#20232f"/>
  ${bricks}
  <path d="M0 300 h20 v-34 h30 v34 h30 v-34 h30 v34 h30 v-34 h30 v34 h20 v20 H0 Z" fill="#2b2f3d"/>
  <rect x="70" y="420" width="22" height="58" rx="11" fill="url(#fa-win)"/><rect x="70" y="620" width="22" height="58" rx="11" fill="url(#fa-win)"/>
  <!-- the banner -->
  <rect x="112" y="330" width="4" height="250" fill="#6b5326"/>
  <path d="M116 340 h70 v200 l-35 -26 l-35 26 Z" fill="#7a1622" class="sway"/>
  <path d="M151 400 l9 18 l20 3 l-14 14 l3 20 l-18 -9 l-18 9 l3 -20 l-14 -14 l20 -3 Z" fill="#d8b04a" class="sway"/>
  ${ivy}
  <!-- the torch -->
  <circle cx="200" cy="560" r="90" fill="url(#fa-glow)" class="flicker"/>
  <path d="M186 590 h28 l-6 50 h-16 Z" fill="#4a3220"/><rect x="182" y="584" width="36" height="9" rx="3" fill="#6b4a2a"/>
  <path class="flame" d="M200 520 C188 545 184 560 192 578 C196 586 204 586 208 578 C216 560 212 545 200 520 Z" fill="#ffb53a"/>
  <path class="flame" d="M200 545 C194 558 194 568 198 576 C200 580 202 580 204 576 C208 568 206 558 200 545 Z" fill="#fff0b0"/>
  <path d="M260 210 q10 -8 20 0 q10 -8 20 0" stroke="#0a0f22" stroke-width="2" fill="none" class="drift"/>`;
}

function twenties() {
  const gold = '#c9a24a', dim = '#7a6230';
  let rays = '';
  for (let i = 0; i <= 18; i++) { const a = (Math.PI / 2) * (i / 18); rays += `<line x1="0" y1="${H}" x2="${f(Math.cos(a) * 520)}" y2="${f(H - Math.sin(a) * 520)}" stroke="${i % 2 ? dim : gold}" stroke-width="${i % 2 ? 1 : 2}"/>`; }
  let arcs = '';
  for (let k = 1; k <= 6; k++) arcs += `<path d="M0 ${H - k * 70} A ${k * 70} ${k * 70} 0 0 1 ${k * 70} ${H}" stroke="${gold}" stroke-width="${k % 2 ? 2.5 : 1}" fill="none" opacity="0.8"/>`;
  let chev = '';
  for (let y = 120; y < 760; y += 34) chev += `<path d="M30 ${y} l45 22 l45 -22" stroke="${y % 68 ? dim : gold}" stroke-width="2" fill="none"/>`;
  let fans = '';
  for (const [cx, cy, s] of [[300, 180, 1], [360, 470, 0.7], [250, 700, 0.55]]) {
    let p = '';
    for (let i = 0; i <= 8; i++) { const a = Math.PI + (Math.PI * i) / 8; p += `<line x1="${cx}" y1="${cy}" x2="${f(cx + Math.cos(a) * 70 * s)}" y2="${f(cy + Math.sin(a) * 70 * s)}" stroke="${gold}" stroke-width="1.5"/>`; }
    fans += `<g opacity="0.85">${p}<path d="M${cx - 70 * s} ${cy} A ${70 * s} ${70 * s} 0 0 1 ${cx + 70 * s} ${cy}" stroke="${gold}" stroke-width="3" fill="none"/><path d="M${cx - 40 * s} ${cy} A ${40 * s} ${40 * s} 0 0 1 ${cx + 40 * s} ${cy}" stroke="${dim}" stroke-width="2" fill="none"/><circle cx="${cx}" cy="${cy}" r="${6 * s}" fill="${gold}"/></g>`;
  }
  return `
  <defs>
    <linearGradient id="tw-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14110b"/><stop offset="1" stop-color="#0a0907"/></linearGradient>
    <linearGradient id="tw-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2c0" stop-opacity="0"/><stop offset="0.5" stop-color="#fff2c0" stop-opacity="0.35"/><stop offset="1" stop-color="#fff2c0" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#tw-bg)"/>
  ${rays}${arcs}
  <!-- the stepped column -->
  <path d="M0 ${H} V110 h30 v-30 h30 v-30 h30 v-30 h30 v90 h30 V${H} Z" fill="#1b170f" stroke="${gold}" stroke-width="3"/>
  <path d="M15 ${H} V125 M135 ${H} V125" stroke="${dim}" stroke-width="1.5"/>
  ${chev}
  <rect x="45" y="800" width="60" height="120" fill="none" stroke="${gold}" stroke-width="2"/><path d="M45 860 h60 M75 800 v120" stroke="${dim}"/>
  ${fans}
  <path d="M410 0 V${H} M400 0 V${H}" stroke="${gold}" stroke-width="1.5" opacity="0.7"/>
  <rect class="shine" x="-200" y="0" width="160" height="${H}" fill="url(#tw-shine)"/>`;
}

function scifi() {
  const r = rng(23);
  let panels = '';
  for (let y = 0; y < H; y += 120) {
    panels += `<rect x="0" y="${y + 2}" width="150" height="116" fill="#2a3240" stroke="#4a5568" stroke-width="2"/>`;
    for (const [x, yy] of [[8, y + 10], [140, y + 10], [8, y + 110], [140, y + 110]]) panels += `<circle cx="${x}" cy="${yy}" r="2.5" fill="#6b778a"/>`;
    if (r() < 0.5) panels += `<rect x="20" y="${y + 30}" width="${f(50 + r() * 60)}" height="8" fill="#1a2030"/>`;
  }
  let lights = '';
  for (let i = 0; i < 18; i++) lights += `<circle class="blink" style="animation-delay:${f(r() * 3)}s" cx="165" cy="${60 + i * 52}" r="4" fill="${['#39f0ff', '#ff5a6a', '#7dff8a'][i % 3]}"/>`;
  let hud = '';
  for (let i = 0; i < 24; i++) hud += `<line x1="390" y1="${200 + i * 20}" x2="${i % 4 ? 400 : 410}" y2="${200 + i * 20}" stroke="#39f0ff" stroke-width="1" opacity="0.6"/>`;
  return `
  <defs>
    <radialGradient id="sf-neb" cx="0.7" cy="0.55" r="0.6"><stop offset="0" stop-color="#5a2a8a" stop-opacity="0.55"/><stop offset="0.6" stop-color="#1f2a6a" stop-opacity="0.25"/><stop offset="1" stop-color="#05070f" stop-opacity="0"/></radialGradient>
    <radialGradient id="sf-planet" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#e9a86a"/><stop offset="0.6" stop-color="#9a4a3a"/><stop offset="1" stop-color="#2a1420"/></radialGradient>
    <linearGradient id="sf-win" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fe8ff" stop-opacity="0.5"/><stop offset="1" stop-color="#1a3a5a" stop-opacity="0.2"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#05070f"/>
  <rect width="${W}" height="${H}" fill="url(#sf-neb)"/>
  ${stars(r, 160, 0, H)}
  <g class="drift-slow">
    <ellipse cx="300" cy="300" rx="120" ry="22" fill="none" stroke="#d8b890" stroke-width="5" opacity="0.6" transform="rotate(-18 300 300)"/>
    <circle cx="300" cy="300" r="62" fill="url(#sf-planet)"/>
    <path d="M190 330 A 120 22 -18 0 0 405 262" fill="none" stroke="#e8c8a0" stroke-width="5" opacity="0.85" transform="rotate(0)"/>
  </g>
  <circle cx="250" cy="760" r="14" fill="#9ab0c8"/><circle cx="246" cy="756" r="13" fill="#05070f" opacity="0.6"/>
  ${panels}
  <rect x="25" y="380" width="100" height="150" rx="40" fill="#0b1420" stroke="#6b778a" stroke-width="4"/>
  <rect x="31" y="386" width="88" height="138" rx="35" fill="url(#sf-win)"/>
  <rect x="150" y="0" width="8" height="${H}" fill="#39f0ff" opacity="0.35" class="pulse"/>
  ${lights}${hud}
  <path d="M330 640 l40 -12 l-8 12 l8 12 Z" fill="#c8d0dc" class="cruise"/>`;
}

function altar() {
  const r = rng(37);
  let candles = '';
  const spots = [[40, 120], [95, 160], [150, 100], [205, 140], [260, 90], [320, 125]];
  for (const [x, h] of spots) {
    const top = 700 - h;
    let drips = '';
    for (let d = 0; d < 3; d++) drips += `<path d="M${x - 10 + d * 9} ${top} v${f(8 + r() * 26)} a3 3 0 0 0 6 0 v-${f(4 + r() * 10)}" fill="#e8dfc4"/>`;
    candles += `<circle cx="${x}" cy="${top - 18}" r="40" fill="url(#al-glow)" class="flicker" style="animation-delay:${f(r())}s"/>
      <rect x="${x - 12}" y="${top}" width="24" height="${h}" rx="3" fill="#d8ceb0"/>${drips}
      <path class="flame" style="animation-delay:${f(r())}s" d="M${x} ${top - 34} C${x - 9} ${top - 18} ${x - 8} ${top - 8} ${x} ${top - 3} C${x + 8} ${top - 8} ${x + 9} ${top - 18} ${x} ${top - 34} Z" fill="#ffc35a"/>
      <path class="flame" d="M${x} ${top - 22} C${x - 4} ${top - 14} ${x - 3} ${top - 8} ${x} ${top - 5} C${x + 3} ${top - 8} ${x + 4} ${top - 14} ${x} ${top - 22} Z" fill="#fff6d0"/>`;
  }
  let sig = '';
  for (let i = 0; i < 7; i++) {
    const x = 30 + i * 55, y = 790 + (i % 2) * 30;
    sig += `<g class="sigil" style="animation-delay:${f(i * 0.4)}s" transform="translate(${x} ${y})"><circle r="14" fill="none" stroke="#5dff9a" stroke-width="1.5"/><path d="M0 -12 L0 12 M-10 -6 L10 6 M-10 6 L10 -6" stroke="#5dff9a" stroke-width="1.5"/><circle r="3" fill="#5dff9a"/></g>`;
  }
  const tentacle = (x0, h, bend, w) => {
    let pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([x0 + Math.sin(t * 3 + bend) * 40 * t, H - t * h, w * (1 - t * 0.9)]); }
    const left = pts.map(([x, y, ww]) => `${f(x - ww)} ${f(y)}`), right = pts.slice().reverse().map(([x, y, ww]) => `${f(x + ww)} ${f(y)}`);
    let suckers = '';
    pts.slice(1, 9).forEach(([x, y, ww]) => { suckers += `<circle cx="${f(x + ww * 0.45)}" cy="${f(y)}" r="${f(Math.max(1.5, ww * 0.28))}" fill="#5f9a7a" opacity="0.8"/>`; });
    return `<g class="sway-slow" style="transform-origin:${x0}px ${H}px"><path d="M${left.join(' L')} L${right.join(' L')} Z" fill="#1d3f2f" stroke="#3f8a62" stroke-width="1.5"/>${suckers}</g>`;
  };
  return `
  <defs>
    <linearGradient id="al-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050807"/><stop offset="1" stop-color="#0b1510"/></linearGradient>
    <radialGradient id="al-glow"><stop offset="0" stop-color="#ffcf7a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffb040" stop-opacity="0"/></radialGradient>
    <radialGradient id="al-mist" cx="0.5" cy="1" r="0.8"><stop offset="0" stop-color="#2aff8a" stop-opacity="0.28"/><stop offset="1" stop-color="#2aff8a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#al-bg)"/>
  <!-- a star with an eye, carved high up -->
  <g transform="translate(200 210)" class="sigil"><path d="M0 -70 L18 -22 L68 -22 L28 8 L42 56 L0 28 L-42 56 L-28 8 L-68 -22 L-18 -22 Z" fill="none" stroke="#3aaa6a" stroke-width="3"/><ellipse rx="16" ry="9" fill="none" stroke="#5dff9a" stroke-width="2"/><circle r="5" fill="#5dff9a"/></g>
  ${tentacle(30, 640, 0.3, 26)}${tentacle(380, 520, 2, 22)}${tentacle(300, 380, 4, 16)}
  <!-- the altar -->
  <rect x="0" y="700" width="${W}" height="${H - 700}" fill="#1c2220"/>
  <rect x="0" y="700" width="${W}" height="18" fill="#2a322e"/>
  <path d="M0 760 H${W} M0 880 H${W}" stroke="#121715" stroke-width="3"/>
  ${sig}
  ${candles}
  <rect y="${H - 300}" width="${W}" height="300" fill="url(#al-mist)" class="pulse"/>`;
}

function cyberpunk() {
  const r = rng(53);
  let towers = '';
  const cols = ['#120a24', '#170d2c', '#0e0820'];
  [[0, 170, 120], [140, 300, 90], [230, 420, 110], [320, 250, 100]].forEach(([x, top, w], i) => {
    towers += `<rect x="${x}" y="${top}" width="${w}" height="${H - top}" fill="${cols[i % 3]}"/>`;
    for (let y = top + 16; y < H - 10; y += 16) for (let xx = x + 8; xx < x + w - 10; xx += 14) {
      if (r() < 0.38) towers += `<rect class="${r() < 0.08 ? 'blink' : ''}" style="animation-delay:${f(r() * 4)}s" x="${xx}" y="${y}" width="7" height="8" fill="${r() < 0.5 ? '#ffd27a' : r() < 0.5 ? '#39f0ff' : '#ff4fb0'}" opacity="${f(0.25 + r() * 0.6)}"/>`;
    }
  });
  // signs: made-up glyphs on neon tubes
  const glyphs = (x, y, n, col) => Array.from({ length: n }, (_, i) => {
    const gy = y + 14 + i * 30, k = Math.floor(r() * 4);
    return [`M${x + 6} ${gy} h16 M${x + 14} ${gy} v18`, `M${x + 6} ${gy} v18 h16 M${x + 6} ${gy + 9} h12`, `M${x + 6} ${gy} h16 v18 h-16 Z`, `M${x + 6} ${gy + 18} l8 -18 l8 18 M${x + 9} ${gy + 10} h10`][k];
  }).join(' ');
  const sign = (x, y, n, col, delay) => `<g class="neon" style="animation-delay:${delay}s"><rect x="${x}" y="${y}" width="28" height="${n * 30 + 10}" rx="5" fill="#0a0414" stroke="${col}" stroke-width="2.5"/><path d="${glyphs(x, y, n, col)}" stroke="${col}" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>`;
  let rain = '';
  for (let i = 0; i < 80; i++) { const x = f(r() * W), y = f(r() * H); rain += `<line x1="${x}" y1="${y}" x2="${f(x - 5)}" y2="${f(y + 22)}" stroke="#a8c8ff" stroke-width="1" opacity="${f(0.15 + r() * 0.35)}"/>`; }
  return `
  <defs>
    <linearGradient id="cp-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07030f"/><stop offset="0.6" stop-color="#1a0730"/><stop offset="1" stop-color="#3a0a3a"/></linearGradient>
    <linearGradient id="cp-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff2a8a" stop-opacity="0"/><stop offset="1" stop-color="#ff2a8a" stop-opacity="0.35"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#cp-sky)"/>
  <circle cx="330" cy="140" r="70" fill="#ff2a8a" opacity="0.12"/>
  ${towers}
  ${sign(108, 330, 5, '#ff2a8a', 0)}${sign(200, 520, 4, '#39f0ff', 1.3)}${sign(296, 380, 3, '#ffd23a', 2.1)}
  <ellipse cx="200" cy="260" rx="70" ry="16" fill="none" stroke="#39f0ff" stroke-width="2" opacity="0.6" class="pulse"/>
  <rect y="${H - 260}" width="${W}" height="260" fill="url(#cp-ground)"/>
  <g class="rain">${rain}</g><g class="rain rain2">${rain}</g>`;
}

function ww2() {
  const r = rng(71);
  let bags = '';
  for (let row = 0; row < 4; row++) for (let x = -20 + (row % 2) * 26; x < 230 - row * 30; x += 52) bags += `<rect x="${x}" y="${H - 60 - row * 30}" width="50" height="28" rx="12" fill="${row % 2 ? '#5a5238' : '#4d4630'}" stroke="#2e2a1c" stroke-width="2"/>`;
  let wire = '';
  for (let x = 0; x < W; x += 18) wire += `<path d="M${x} ${H - 150} q9 -12 18 0" stroke="#6b6b6b" stroke-width="1.5" fill="none"/><path d="M${x + 9} ${H - 160} l4 8 M${x + 13} ${H - 160} l-4 8" stroke="#8a8a8a" stroke-width="1"/>`;
  let ruin = '<path d="M0 520 L60 520 L60 470 L95 470 L95 540 L140 500 L170 560 L170 ' + H + ' L0 ' + H + ' Z" fill="#1d1a14"/>';
  for (let y = 560; y < 900; y += 46) for (let x = 15; x < 150; x += 40) if (r() < 0.7) ruin += `<rect x="${x}" y="${y}" width="18" height="24" fill="${r() < 0.2 ? '#d89a3a' : '#0d0b08'}" opacity="${r() < 0.2 ? 0.8 : 1}"/>`;
  const plane = (x, y, s, cls, delay) => `<g class="${cls}" style="animation-delay:${delay}s"><g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 h60 l6 4 l-6 4 h-60 Z M22 -2 l10 -26 h8 l-6 26 Z M22 10 l10 26 h8 l-6 -26 Z M52 0 l6 -10 h5 l-2 10 Z" fill="#14130f"/></g></g>`;
  return `
  <defs>
    <linearGradient id="w2-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11141a"/><stop offset="0.6" stop-color="#2a2a26"/><stop offset="1" stop-color="#4a3a26"/></linearGradient>
    <linearGradient id="w2-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff6d0" stop-opacity="0.45"/><stop offset="1" stop-color="#fff6d0" stop-opacity="0"/></linearGradient>
    <radialGradient id="w2-fire" cx="0.5" cy="1" r="0.8"><stop offset="0" stop-color="#ff8a2a" stop-opacity="0.5"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#w2-sky)"/>
  ${stars(r, 40, 0, 400)}
  <g class="sweep" style="transform-origin:120px ${H - 140}px"><path d="M108 ${H - 140} L60 0 L180 0 L132 ${H - 140} Z" fill="url(#w2-beam)"/></g>
  <g class="sweep sweep2" style="transform-origin:330px ${H - 160}px"><path d="M320 ${H - 160} L300 0 L400 0 L340 ${H - 160} Z" fill="url(#w2-beam)"/></g>
  <g class="drift-slow"><ellipse cx="300" cy="230" rx="38" ry="16" fill="#3a3a34"/><path d="M262 230 l-14 -10 v20 Z M330 222 l12 -8 M330 238 l12 8" stroke="#3a3a34" stroke-width="5" fill="#3a3a34"/><line x1="300" y1="246" x2="300" y2="${H}" stroke="#2a2a26" stroke-width="1"/></g>
  ${plane(380, 120, 0.7, 'cruise', 0)}${plane(420, 160, 0.55, 'cruise', -6)}${plane(400, 90, 0.5, 'cruise', -12)}
  <rect x="0" y="${H - 400}" width="${W}" height="400" fill="url(#w2-fire)" class="flicker"/>
  ${ruin}
  <rect x="190" y="420" width="6" height="${H - 420}" fill="#1a1812"/><path d="M180 430 h26 M184 470 h18 M186 510 h14" stroke="#1a1812" stroke-width="3"/>
  <circle cx="193" cy="418" r="4" fill="#ff3a2a" class="blink"/>
  <circle cx="120" cy="${H - 150}" r="18" fill="#2a2820"/><rect x="104" y="${H - 150}" width="32" height="40" fill="#2a2820"/>
  ${wire}${bags}`;
}

function western() {
  const r = rng(83);
  const cactus = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#1f2a1a"><rect x="-8" y="-120" width="16" height="120" rx="8"/><path d="M-8 -60 h-18 a8 8 0 0 1 -8 -8 v-30 a8 8 0 0 1 16 0 v22 h10 Z M8 -80 h18 a8 8 0 0 0 8 -8 v-20 a8 8 0 0 0 -16 0 v12 h-10 Z"/></g>`;
  let planks = '';
  for (let x = 0; x < 170; x += 17) planks += `<rect x="${x}" y="420" width="16" height="${H - 420}" fill="${x % 34 ? '#4a2f1c' : '#55361f'}"/>`;
  return `
  <defs>
    <linearGradient id="we-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1a3a"/><stop offset="0.45" stop-color="#a84a3a"/><stop offset="0.7" stop-color="#e8a050"/><stop offset="1" stop-color="#6a3a20"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#we-sky)"/>
  <circle cx="300" cy="640" r="70" fill="#ffd27a" opacity="0.9"/>
  <path d="M170 700 h40 v-60 h70 v60 h40 v-30 h60 v40 h40 V${H} H170 Z" fill="#4a2420"/>
  <path d="M0 780 Q120 740 230 770 T${W} 760 V${H} H0 Z" fill="#3a1c14"/>
  <!-- the saloon -->
  ${planks}
  <path d="M0 360 h180 v60 h-180 Z" fill="#5a3a22"/><rect x="10" y="372" width="160" height="36" fill="#2a1a10"/>
  <text class="unmirror" x="90" y="399" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="24" letter-spacing="4" fill="#e8c27a">SALOON</text>
  <rect x="30" y="520" width="60" height="70" fill="#1a0f08"/><rect x="34" y="524" width="52" height="62" fill="#e8a050" opacity="0.5" class="flicker"/>
  <rect x="40" y="660" width="80" height="130" fill="#1a0f08"/>
  <g class="swing" style="transform-origin:150px 470px"><line x1="150" y1="470" x2="150" y2="490" stroke="#2a1a10" stroke-width="2"/><rect x="128" y="490" width="44" height="26" fill="#6a4426" stroke="#2a1a10" stroke-width="2"/></g>
  <!-- the windmill -->
  <path d="M300 520 L290 ${H} M300 520 L310 ${H}" stroke="#2a1a10" stroke-width="4"/>
  <g class="spin" style="transform-origin:300px 520px">${Array.from({ length: 12 }, (_, i) => `<path d="M300 520 L${f(300 + Math.cos((i / 12) * Math.PI * 2) * 48)} ${f(520 + Math.sin((i / 12) * Math.PI * 2) * 48)}" stroke="#2a1a10" stroke-width="5"/>`).join('')}</g>
  <circle cx="300" cy="520" r="7" fill="#2a1a10"/>
  ${cactus(240, 900, 1.1)}${cactus(380, 860, 0.7)}${cactus(205, 820, 0.5)}
  <g class="roll"><circle cx="0" cy="${H - 70}" r="18" fill="none" stroke="#5a3a20" stroke-width="2"/><circle cx="0" cy="${H - 70}" r="12" fill="none" stroke="#5a3a20" stroke-width="1.5" stroke-dasharray="4 3"/></g>
  <path d="M220 160 q14 -10 28 0 q14 -10 28 0" stroke="#2a1a1a" stroke-width="2" fill="none" class="drift"/>`;
}

function pirate() {
  const r = rng(97);
  let waves = '';
  for (let row = 0; row < 6; row++) {
    const y = 760 + row * 40;
    let d = `M-60 ${y}`;
    for (let x = -60; x < W + 120; x += 60) d += ` q15 -12 30 0 t30 0`;
    waves += `<path class="${row % 2 ? 'wave' : 'wave wave2'}" d="${d} V${H} H-60 Z" fill="${['#0d2238', '#0f2a44', '#11304e', '#0d2640', '#0b2036', '#091a2c'][row]}"/>`;
  }
  let rig = '';
  for (let i = 0; i < 9; i++) rig += `<line x1="70" y1="${120 + i * 40}" x2="${f(150 + i * 18)}" y2="${f(760)}" stroke="#2a2016" stroke-width="1.5"/>`;
  return `
  <defs>
    <linearGradient id="pi-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1426"/><stop offset="1" stop-color="#1e3a56"/></linearGradient>
    <radialGradient id="pi-moon"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#e8dcb0"/></radialGradient>
    <radialGradient id="pi-lamp"><stop offset="0" stop-color="#ffcf6b" stop-opacity="0.6"/><stop offset="1" stop-color="#ffcf6b" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#pi-sky)"/>
  ${stars(r, 80, 0, 600)}
  <circle cx="310" cy="170" r="46" fill="url(#pi-moon)"/>
  <path d="M260 700 l40 -6 l40 6 l-10 10 h-60 Z M300 694 v-40 l22 30 Z" fill="#0a1220" class="drift-slow"/>
  <!-- mast, sails, rigging -->
  ${rig}
  <rect x="62" y="40" width="16" height="${H}" fill="#3a2a1a"/>
  <rect x="0" y="150" width="200" height="8" fill="#3a2a1a"/><rect x="0" y="420" width="230" height="8" fill="#3a2a1a"/>
  <g class="sway" style="transform-origin:0 160px"><path d="M0 158 h190 q-20 110 0 230 h-190 Z" fill="#d8ccb0"/><path d="M0 158 h190 q-20 110 0 230 h-190 Z" fill="none" stroke="#a8987a" stroke-width="2"/></g>
  <g class="sway" style="transform-origin:0 430px"><path d="M0 428 h220 q-24 120 0 250 h-220 Z" fill="#cfc2a4"/></g>
  <g class="sway"><path d="M78 40 h70 l-10 22 l10 22 h-70 Z" fill="#111"/><circle cx="105" cy="58" r="8" fill="#e8e0d0"/><path d="M95 72 l20 -6 M95 66 l20 6" stroke="#e8e0d0" stroke-width="3"/></g>
  <circle cx="160" cy="560" r="60" fill="url(#pi-lamp)" class="flicker"/>
  <line x1="160" y1="500" x2="160" y2="540" stroke="#2a2016" stroke-width="2"/><rect x="150" y="540" width="20" height="28" rx="4" fill="#ffcf6b" stroke="#3a2a1a" stroke-width="3" class="flicker"/>
  <rect x="0" y="740" width="${W}" height="30" fill="#2a1c10"/>
  ${waves}`;
}

function gothic() {
  const r = rng(109);
  let fence = '';
  for (let x = 0; x < W; x += 22) fence += `<path d="M${x} ${H - 30} V${H - 120} l5 -14 l5 14 V${H - 30}" fill="#0b0b10"/>`;
  fence += `<rect x="0" y="${H - 110}" width="${W}" height="6" fill="#0b0b10"/><rect x="0" y="${H - 50}" width="${W}" height="6" fill="#0b0b10"/>`;
  let graves = '';
  [[40, 960, 1], [120, 975, 0.8], [250, 965, 0.9], [340, 985, 0.7]].forEach(([x, y, s], i) => {
    graves += i % 2 ? `<g transform="translate(${x} ${y}) rotate(${f(r() * 10 - 5)}) scale(${s})"><rect x="-8" y="-90" width="16" height="90" fill="#3a3a44"/><rect x="-34" y="-70" width="68" height="16" fill="#3a3a44"/></g>`
      : `<path transform="translate(${x} ${y}) rotate(${f(r() * 10 - 5)}) scale(${s})" d="M-30 0 V-60 a30 30 0 0 1 60 0 V0 Z" fill="#33333d"/>`;
  });
  const bat = (x, y, d) => `<g class="flap" style="animation-delay:${d}s"><path transform="translate(${x} ${y})" d="M0 0 q-8 -8 -18 -4 q4 4 2 8 q-6 -2 -10 2 q10 2 16 -2 q4 6 10 0 q6 6 10 0 q6 4 16 2 q-4 -4 -10 -2 q-2 -4 2 -8 q-10 -4 -18 4 Z" fill="#0a0a0e"/></g>`;
  let tree = '<path d="M330 ' + H + ' C320 700 340 600 300 520 M318 640 C360 600 380 560 410 540 M310 580 C270 540 250 520 220 500 M300 520 C300 470 280 440 260 420 M300 520 C320 470 350 450 370 430" stroke="#0e0d12" stroke-width="14" fill="none" stroke-linecap="round"/>';
  return `
  <defs>
    <linearGradient id="go-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0b18"/><stop offset="0.7" stop-color="#2a2640"/><stop offset="1" stop-color="#3a3650"/></linearGradient>
    <radialGradient id="go-lamp"><stop offset="0" stop-color="#ffe8a0" stop-opacity="0.65"/><stop offset="1" stop-color="#ffe8a0" stop-opacity="0"/></radialGradient>
    <linearGradient id="go-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8b8d0" stop-opacity="0"/><stop offset="1" stop-color="#b8b8d0" stop-opacity="0.3"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#go-sky)"/>
  ${stars(r, 50, 0, 450)}
  <circle cx="280" cy="200" r="70" fill="#efe8d2"/><circle cx="260" cy="190" r="10" fill="#d8d0b8"/><circle cx="300" cy="220" r="7" fill="#d8d0b8"/>
  <path d="M0 640 h40 v-120 l30 -50 l30 50 v40 h30 v-90 l20 -30 l20 30 v170 Z" fill="#14121e"/>
  <rect x="58" y="540" width="10" height="16" fill="#e8c87a" opacity="0.7"/>
  ${tree}
  <!-- the gas lamp -->
  <rect x="186" y="560" width="8" height="${H - 560}" fill="#0b0b10"/>
  <circle cx="190" cy="550" r="80" fill="url(#go-lamp)" class="flicker"/>
  <path d="M176 530 h28 l-4 30 h-20 Z" fill="#ffe8a0" stroke="#0b0b10" stroke-width="3" class="flicker"/><path d="M172 530 h36 l-18 -14 Z" fill="#0b0b10"/>
  ${fence}
  ${graves}
  ${bat(240, 300, 0)}${bat(330, 360, 0.3)}${bat(380, 290, 0.6)}
  <rect class="fog" x="-420" y="${H - 300}" width="${W * 2 + 420}" height="300" fill="url(#go-fog)"/>`;
}

function wasteland() {
  const r = rng(127);
  let ruins = '';
  [[0, 280, 110], [120, 420, 80], [230, 360, 70], [320, 500, 100]].forEach(([x, top, w]) => {
    let d = `M${x} ${H} V${top}`;
    for (let xx = x; xx <= x + w; xx += 12) d += ` L${xx} ${f(top + r() * 40)}`;
    ruins += `<path d="${d} V${H} Z" fill="#2a2418"/>`;
    for (let y = top + 40; y < H - 40; y += 30) for (let xx = x + 8; xx < x + w - 10; xx += 20) if (r() < 0.55) ruins += `<rect x="${xx}" y="${y}" width="10" height="14" fill="#140f08"/>`;
    ruins += `<path d="M${x + w * 0.3} ${top + 30} l10 30 l-6 20" stroke="#140f08" stroke-width="2" fill="none"/>`;
  });
  let dust = '';
  for (let i = 0; i < 40; i++) dust += `<circle cx="${f(r() * W)}" cy="${f(500 + r() * 500)}" r="${f(1 + r() * 2)}" fill="#e8c890" opacity="${f(0.2 + r() * 0.3)}"/>`;
  return `
  <defs>
    <linearGradient id="wa-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a18"/><stop offset="0.6" stop-color="#8a6a3a"/><stop offset="1" stop-color="#b88a4a"/></linearGradient>
    <radialGradient id="wa-fire" cx="0.5" cy="1" r="0.7"><stop offset="0" stop-color="#ff9a3a" stop-opacity="0.7"/><stop offset="1" stop-color="#ff9a3a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wa-sky)"/>
  <circle cx="300" cy="260" r="60" fill="#f2d8a0" opacity="0.55"/>
  ${ruins}
  <path d="M0 900 Q140 860 260 900 T${W} 890 V${H} H0 Z" fill="#4a3a22"/>
  <!-- a rusted car -->
  <g transform="translate(200 910) rotate(-6)"><path d="M0 0 h120 l-10 -26 h-30 l-14 -20 h-40 l-14 20 h-12 Z" fill="#6a3a1a"/><circle cx="24" cy="2" r="12" fill="#1a1208"/><circle cx="96" cy="2" r="12" fill="#1a1208"/><path d="M36 -40 h28 l8 12 h-44 Z" fill="#2a1a10"/></g>
  <!-- a warning sign -->
  <g transform="translate(-150 0)"><rect x="356" y="760" width="6" height="140" fill="#2a2016"/><path d="M359 700 l40 70 h-80 Z" fill="#d8b03a" stroke="#2a2016" stroke-width="4"/><circle cx="359" cy="748" r="5" fill="#1a1208"/><path d="M359 735 l-7 -14 a16 16 0 0 1 14 0 Z M352 752 l-12 6 a16 16 0 0 0 7 12 Z M366 752 l12 6 a16 16 0 0 1 -7 12 Z" fill="#1a1208"/></g>
  <!-- a burning barrel -->
  <circle cx="90" cy="900" r="70" fill="url(#wa-fire)" class="flicker"/>
  <rect x="70" y="880" width="40" height="56" rx="4" fill="#3a2a1a"/><path d="M70 896 h40 M70 920 h40" stroke="#1a1208" stroke-width="3"/>
  <path class="flame" d="M90 840 C76 862 74 874 82 884 h16 C106 874 104 862 90 840 Z" fill="#ff9a3a"/>
  <g class="dust">${dust}</g>`;
}

function eighties() {
  const r = rng(139);
  const pylon = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#1a1a2a" stroke-width="3" fill="none"><path d="M-20 0 L-4 -200 L4 -200 L20 0 M-12 -60 L12 -60 M-8 -120 L8 -120 M-14 -60 L8 -120 M14 -60 L-8 -120 M-40 -160 H40 M-30 -190 H30 M-4 -200 V-220 H4 V-200"/><path d="M-40 -160 v8 M40 -160 v8 M-30 -190 v8 M30 -190 v8" stroke-width="2"/></g>`;
  let field = '';
  for (let i = 0; i < 16; i++) field += `<path d="M0 ${800 + i * 14} Q200 ${790 + i * 14} ${W} ${804 + i * 14}" stroke="#3a4a2a" stroke-width="1" fill="none" opacity="0.6"/>`;
  return `
  <defs>
    <linearGradient id="ei-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a5a"/><stop offset="0.5" stop-color="#8a6a8a"/><stop offset="0.75" stop-color="#e8a07a"/><stop offset="1" stop-color="#f2c88a"/></linearGradient>
    <radialGradient id="ei-orb" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#e8ecf2"/><stop offset="1" stop-color="#6a7488"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ei-sky)"/>
  ${stars(r, 30, 0, 250)}
  <!-- a cooling tower and a dome far off -->
  <path d="M250 760 C262 700 262 650 246 600 H330 C314 650 314 700 326 760 Z" fill="#5a5a72"/>
  <path class="steam" d="M260 600 q-10 -40 20 -60 q30 -20 10 -60" stroke="#e8e0e8" stroke-width="30" fill="none" stroke-linecap="round" opacity="0.35"/>
  <path d="M340 760 a40 40 0 0 1 80 0 Z" fill="#4a4a62"/>
  <!-- the power lines -->
  ${pylon(70, 820, 1.5)}${pylon(230, 790, 0.9)}${pylon(330, 775, 0.6)}
  <path d="M10 580 Q150 640 197 609 M130 580 Q170 620 197 618 M10 535 Q150 600 212 580 M130 535 Q180 590 212 586" stroke="#1a1a2a" stroke-width="1.5" fill="none"/>
  <!-- a floating machine -->
  <g class="drift-slow"><ellipse cx="300" cy="330" rx="56" ry="18" fill="#3a3e4e"/><circle cx="300" cy="312" r="34" fill="url(#ei-orb)"/><rect x="292" y="346" width="16" height="30" fill="#3a3e4e"/><circle cx="300" cy="384" r="5" fill="#ff6a3a" class="blink"/></g>
  <path d="M0 780 Q120 760 260 790 T${W} 780 V${H} H0 Z" fill="#4a5a32"/>
  ${field}
  <!-- a robot standing in the field -->
  <g transform="translate(170 860)" fill="#2a2a34"><rect x="-26" y="-140" width="52" height="70" rx="10"/><rect x="-16" y="-172" width="32" height="30" rx="6"/><circle cx="0" cy="-158" r="7" fill="#ffcf6b" class="blink"/><rect x="-22" y="-70" width="14" height="70"/><rect x="8" y="-70" width="14" height="70"/><rect x="-40" y="-134" width="12" height="56" rx="6"/><rect x="28" y="-134" width="12" height="56" rx="6"/></g>
  <g transform="translate(60 930)"><circle cx="-16" cy="0" r="12" fill="none" stroke="#1a1a2a" stroke-width="3"/><circle cx="16" cy="0" r="12" fill="none" stroke="#1a1a2a" stroke-width="3"/><path d="M-16 0 L-2 -16 L16 0 M-2 -16 h14 M-6 -22 h10" stroke="#c83a3a" stroke-width="3" fill="none"/></g>`;
}

// the drawn themes (fantasy, western, pirate, gothic and wasteland are pictures now, but their drawings stay for anyone who wants them back)
const ART = { twenties, scifi, altar, cyberpunk, ww2, eighties };
void [fantasy, western, pirate, gothic, wasteland];

/** A picture theme's two sides. */
export const pictureOf = (id, side) => serverUrl(`/themes/${id}-${side}.jpg`);
/** What goes in a flank: the drawing, or that side's picture. */
function flankHtml(id, side) {
  const t = THEMES[id];
  const pos = t?.focus?.[side] ? ` style="object-position:${t.focus[side]}"` : '';
  return t?.pictures ? `<img src="${pictureOf(id, side)}" alt="" decoding="async"${pos}>` : artOf(id);
}

/** Put a theme on the page (or 'none'): two fixed flanks either side of the content. */
export function applyTheme(name) {
  const id = Object.hasOwn(THEMES, name) ? name : 'none';
  document.querySelectorAll('body > .theme-flank').forEach((x) => x.remove());
  document.body.dataset.theme = id;
  try { localStorage.setItem('lantern.theme', id); } catch { /* private mode */ }
  if (id === 'none') { document.body.style.removeProperty('--theme-bg'); return; }
  document.body.style.setProperty('--theme-bg', THEMES[id].bg);
  for (const side of ['left', 'right']) {
    const el = document.createElement('div');
    el.className = `theme-flank ${side}${THEMES[id].pictures ? ' photo' : ''}`;
    el.innerHTML = flankHtml(id, side);
    document.body.prepend(el);
  }
}

const cache = new Map();
/** A theme's SVG (drawn once, then kept). */
export function artOf(id) {
  if (!ART[id]) return '';
  if (!cache.has(id)) cache.set(id, `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ART[id]()}</svg>`);
  return cache.get(id);
}

/**
 * Put a theme behind `el` (it needs position: relative or absolute): the art at both sides, dimmed, under
 * everything else in it. 'none' takes it away.
 */
export function themeBackdrop(el, name) {
  if (!el) return;
  const id = Object.hasOwn(THEMES, name) ? name : 'none';
  if (el.dataset.backdrop === id) return;
  el.dataset.backdrop = id;
  el.querySelector(':scope > .theme-backdrop')?.remove();
  el.style.setProperty('--theme-bg', id === 'none' ? '' : THEMES[id].bg);
  if (id === 'none') return;
  const box = document.createElement('div');
  box.className = 'theme-backdrop';
  box.setAttribute('aria-hidden', 'true');
  const ph = THEMES[id].pictures ? ' photo' : '';
  box.innerHTML = `<div class="theme-flank left${ph}">${flankHtml(id, 'left')}</div><div class="theme-flank right${ph}">${flankHtml(id, 'right')}</div>`;
  el.prepend(box);
}

/** The theme this browser last used (so the page doesn't flash plain before the login's arrives). */
export const savedTheme = () => { try { return localStorage.getItem('lantern.theme') || 'none'; } catch { return 'none'; } };
