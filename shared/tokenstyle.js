// Tokens from the token designer: a round picture with a rim, made in the browser (tokendesigner.js) and uploaded
// as a PNG. The design is kept too, so a token can be opened and changed again. Pure, shared by the server and
// the browser (and Lantern Plus, which keeps your tokens with your login).
import { FINISHES } from './dicestyle.js';

export const TRIMS = { none: 'Nothing', double: 'Double line', studs: 'Studs', ticks: 'Notches' };
export const MAX_TOKENS = 40;
const HEX = /^#[0-9a-f]{6}$/i;
const PIC = /^\/uploads\/[a-f0-9]{16,40}\.(png|jpe?g|webp|gif)$/;
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const hex = (v, d) => (HEX.test(v) ? v.toLowerCase() : d);

export const DEFAULT_TOKEN = {
  photo: null, zoom: 1, ox: 0, oy: 0, bg: '#2a2a33',
  rim: 'metal', c1: '#c9a24a', c2: '#6b4d17', width: 0.12, trim: 'double',
  glow: null, plate: '', plateColor: '#17151c', plateInk: '#f2e6c8',
};

/** A design from anywhere, made safe. */
export function cleanTokenDesign(d) {
  const x = d && typeof d === 'object' ? d : {};
  return {
    photo: typeof x.photo === 'string' && PIC.test(x.photo) ? x.photo : null,
    zoom: num(x.zoom, 1, 0.3, 5),
    ox: num(x.ox, 0, -1.5, 1.5),
    oy: num(x.oy, 0, -1.5, 1.5),
    bg: hex(x.bg, DEFAULT_TOKEN.bg),
    rim: Object.hasOwn(FINISHES, x.rim) ? x.rim : 'metal',
    c1: hex(x.c1, DEFAULT_TOKEN.c1),
    c2: hex(x.c2, DEFAULT_TOKEN.c2),
    width: num(x.width, 0.12, 0.04, 0.24),
    trim: Object.hasOwn(TRIMS, x.trim) ? x.trim : DEFAULT_TOKEN.trim,
    glow: HEX.test(x.glow) ? x.glow.toLowerCase() : null,
    plate: text(x.plate, 24),
    plateColor: hex(x.plateColor, DEFAULT_TOKEN.plateColor),
    plateInk: hex(x.plateInk, DEFAULT_TOKEN.plateInk),
  };
}

/** Your tokens ([{ id, name, image, design }], up to 40), made safe. */
export function cleanTokenLib(list) {
  if (!Array.isArray(list)) return [];
  const out = [], seen = new Set();
  for (const t of list) {
    const id = /^[a-z0-9]{4,20}$/.test(t?.id) ? t.id : null;
    const image = typeof t?.image === 'string' && PIC.test(t.image) ? t.image : null;
    if (!id || !image || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: text(t.name, 40) || 'Token', image, design: cleanTokenDesign(t.design) });
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

/** The materials a design uses (to check they're unlocked). */
export const tokenMaterials = (d) => (FINISHES[d?.rim]?.material ? [d.rim] : []);
