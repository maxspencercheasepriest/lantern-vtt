// Custom dice: what a person's dice look like when they roll. Used by the server (to clean what a browser sends,
// and to put the roller's style on each throw) and by the browser (to paint the dice and the Dice tab's picker).
// Pure: no DOM, no Node.

export const FINISHES = {
  gloss: { label: 'Gloss', roughness: 0.32, metalness: 0.05 },
  matte: { label: 'Matte', roughness: 0.85, metalness: 0 },
  metal: { label: 'Metal', roughness: 0.28, metalness: 0.85 },
  glass: { label: 'Glass', roughness: 0.08, metalness: 0, opacity: 0.72 },
  pearl: { label: 'Pearl', roughness: 0.22, metalness: 0.35 },
  // materials: painted with their own texture, starting from their own colours (which you can change). An add-on
  // (Lantern Plus) can make these earned, in this order; without one (the free app) they're all there.
  // serif: ornate numbers; edges: a coloured rim round each face; opacity: see-through.
  iron: { label: 'Iron', roughness: 0.55, metalness: 0.75, material: true, colors: ['#3a3b3e', '#6d6f74', '#d8d8d8'] },
  oak: { label: 'Oak', roughness: 0.7, metalness: 0, material: true, colors: ['#6b4423', '#3b2412', '#e8b04a'] },
  copper: { label: 'Copper', roughness: 0.45, metalness: 0, material: true, colors: ['#b0673a', '#3f8f84', '#f2d49a'] },
  bone: { label: 'Bone', roughness: 0.55, metalness: 0, material: true, colors: ['#e4dac4', '#5a4a34', '#1a1410'] },
  garnet: { label: 'Garnet', roughness: 0.1, metalness: 0, material: true, opacity: 0.86, colors: ['#6e0a18', '#e0283c', '#f0c36a'] },
  jade: { label: 'Jade', roughness: 0.2, metalness: 0, material: true, colors: ['#1f5a32', '#6fbf7a', '#e8b84a'] },
  silver: { label: 'Silver', roughness: 0.22, metalness: 0.95, material: true, serif: true, edges: true, colors: ['#d6d9de', '#3c3e44', '#1c1d20'] },
  obsidian: { label: 'Obsidian', roughness: 0.12, metalness: 0.1, material: true, colors: ['#0c0b0e', '#e01b24', '#ff3a3a'] },
  arcane: { label: 'Arcane', roughness: 0.15, metalness: 0.1, material: true, opacity: 0.93, colors: ['#1a1440', '#8a4dff', '#f0c36a'] },
  dragonbone: { label: 'Dragonbone', roughness: 0.5, metalness: 0.6, material: true, serif: true, edges: true, colors: ['#2a2218', '#8a7350', '#e0c27a'] },
  celestial: { label: 'Celestial', roughness: 0.08, metalness: 0, material: true, opacity: 0.88, colors: ['#0d2a66', '#4a8cff', '#f0c36a'] },
  eldritch: { label: 'Eldritch', roughness: 0.1, metalness: 0, material: true, opacity: 0.84, colors: ['#c76a78', '#7a0c1c', '#fbe6e6'] },
  royal: { label: 'Royal', roughness: 0.3, metalness: 0, material: true, serif: true, edges: true, colors: ['#7a0d14', '#d4af37', '#f2d26a'] },
  void: { label: 'Void', roughness: 0.15, metalness: 0.1, material: true, colors: ['#07060c', '#6a3ab8', '#b57bff'] },
  first: { label: 'The First Dice', roughness: 0.22, metalness: 1, material: true, serif: true, edges: true, colors: ['#e8c46a', '#8a6420', '#fff4c0'] },
  // creator materials: on Lantern Plus, earned by publishing modules, updating them and getting reviews
  wood: { label: 'Wood', roughness: 0.7, metalness: 0, material: true, creator: true, colors: ['#9a6a3a', '#5a3618', '#f5e6c8'] },
  stone: { label: 'Stone', roughness: 0.92, metalness: 0, material: true, creator: true, colors: ['#8a8a86', '#4a4a48', '#1a1a1a'] },
  goldleaf: { label: 'Gold leaf', roughness: 0.45, metalness: 0, material: true, creator: true, colors: ['#1a1a20', '#1a1a20', '#f6e27a'] },
  ivory: { label: 'Ivory', roughness: 0.55, metalness: 0, material: true, creator: true, colors: ['#d8ccb0', '#6a5a40', '#2a1a0a'] },
  galaxy: { label: 'Galaxy', roughness: 0.2, metalness: 0.1, material: true, creator: true, colors: ['#0b0b2a', '#7a3aff', '#ffffff'] },
  molten: { label: 'Molten', roughness: 0.75, metalness: 0, material: true, creator: true, colors: ['#2a1208', '#ff6a00', '#ffd08a'] },
  runes: { label: 'Runes', roughness: 0.3, metalness: 0.2, material: true, creator: true, colors: ['#10241a', '#5fe08a', '#b8ffcf'] },
  // game master materials: on Lantern Plus, earned by running sessions
  lantern: { label: 'Lantern', roughness: 0.12, metalness: 0, material: true, gm: true, opacity: 0.9, colors: ['#b8560c', '#ffc65a', '#fff1c4'] },
  ink: { label: 'Ink and quill', roughness: 0.8, metalness: 0, material: true, gm: true, serif: true, colors: ['#e6d8b4', '#1b1736', '#16122c'] },
  keeper: { label: 'Keeper’s seal', roughness: 0.6, metalness: 0, material: true, gm: true, serif: true, edges: true, colors: ['#1d3a2a', '#c9a24a', '#ead07c'] },
  // seasonal materials: on Lantern Plus, earned by playing during that season (and only then)
  frost: { label: 'Frost', roughness: 0.12, metalness: 0, material: true, season: 'winter', opacity: 0.88, colors: ['#bfe0f2', '#ffffff', '#16385a'] },
  blossom: { label: 'Blossom', roughness: 0.45, metalness: 0, material: true, season: 'spring', colors: ['#f5d3de', '#d9577e', '#4a1a2a'] },
  sunburst: { label: 'Sunburst', roughness: 0.3, metalness: 0.2, material: true, season: 'summer', colors: ['#ffae2a', '#ff5e00', '#4a1600'] },
  harvest: { label: 'Harvest', roughness: 0.55, metalness: 0, material: true, season: 'autumn', colors: ['#c8601a', '#6a2606', '#ffd884'] },
};
/** Which group of the Dice tab's list a finish is in. */
export const groupOf = (k) => { const f = FINISHES[k]; return !f?.material ? 'finish' : f.creator ? 'creator' : f.gm ? 'gm' : f.season ? 'season' : 'material'; };
/** The finishes everyone always has. */
export const BASE_FINISHES = Object.keys(FINISHES).filter((k) => !FINISHES[k].material);

export const PATTERNS = {
  plain: 'Plain',
  marble: 'Marble',
  speckle: 'Speckled',
  split: 'Two-tone',
};

/** Ready-made sets: a quick start, and what the picker shows first. */
export const PRESETS = [
  { name: 'Lantern', body: '#e8a33d', body2: '#b3641c', ink: '#141418', finish: 'gloss', pattern: 'plain' },
  { name: 'Bone', body: '#ece3cf', body2: '#c9b998', ink: '#3a2a1a', finish: 'matte', pattern: 'speckle' },
  { name: 'Obsidian', body: '#17171c', body2: '#3b3b48', ink: '#e8c46a', finish: 'gloss', pattern: 'marble' },
  { name: 'Brass', body: '#b8903a', body2: '#7a5b1e', ink: '#1a1208', finish: 'metal', pattern: 'plain' },
  { name: 'Sea glass', body: '#5fb3a8', body2: '#2f6f7a', ink: '#ffffff', finish: 'glass', pattern: 'plain' },
  { name: 'Blood moon', body: '#7a1020', body2: '#2a0508', ink: '#f2e6d0', finish: 'pearl', pattern: 'marble' },
  { name: 'Neon', body: '#1a1030', body2: '#ff2a8a', ink: '#39f0ff', finish: 'gloss', pattern: 'split' },
  { name: 'Eldritch', body: '#1f3b2c', body2: '#7fbf6a', ink: '#e9f5d0', finish: 'pearl', pattern: 'marble' },
];

const HEX = /^#[0-9a-f]{6}$/i;
// a material from 0.31 that's called something else now
const RENAMED = { gold: 'goldleaf' };
const PIC = /^\/uploads\/[a-f0-9]{16,40}\.(png|jpe?g|webp|gif)$/;

/** The dice in a set, each of which can have its own look in the dice designer. */
export const DIE_SLOTS = ['d4', 'd6', 'd8', 'd10', 'd100', 'd12', 'd20'];
/** Which of the set a rolled die is: a percentile tens die is the d100, anything unusual (d2, d3) uses the set's own look. */
export const slotOf = (d) => (d?.kind === 'tens' ? 'd100' : DIE_SLOTS.includes(`d${d?.sides}`) ? `d${d.sides}` : null);
/** How the numbers are written: as the material has them, or always plain or always serif. */
export const FONTS = { auto: 'As the material has them', plain: 'Plain', serif: 'Old style (serif)' };
const isMaterial = (k) => typeof k === 'string' && Object.hasOwn(FINISHES, RENAMED[k] || k) && !!FINISHES[RENAMED[k] || k].material;

/**
 * A style from anywhere (a browser, a saved file) made safe, or null when there's nothing usable. Beyond the colours,
 * finish, pattern and picture, the dice designer adds: overlay (another material's pattern painted over this one,
 * in overlayColor), rim (a rim round each face in a material's colour, metal if it's a metal), font, and dice: a look
 * of its own for any die in the set ({ d20: style, … }).
 */
export function cleanDiceStyle(s, nested = false) {
  if (!s || typeof s !== 'object') return null;
  const body = HEX.test(s.body) ? s.body.toLowerCase() : null;
  if (!body) return null;
  const out = {
    body,
    body2: HEX.test(s.body2) ? s.body2.toLowerCase() : body,
    ink: HEX.test(s.ink) ? s.ink.toLowerCase() : inkFor(body),
    finish: Object.hasOwn(FINISHES, s.finish) ? s.finish : RENAMED[s.finish] || 'gloss',
    pattern: Object.hasOwn(PATTERNS, s.pattern) ? s.pattern : 'plain',
    picture: typeof s.picture === 'string' && PIC.test(s.picture) ? s.picture : null,
  };
  if (isMaterial(s.overlay) && (RENAMED[s.overlay] || s.overlay) !== out.finish) {
    out.overlay = RENAMED[s.overlay] || s.overlay;
    out.overlayColor = HEX.test(s.overlayColor) ? s.overlayColor.toLowerCase() : FINISHES[out.overlay].colors[1];
  }
  if (isMaterial(s.rim)) out.rim = RENAMED[s.rim] || s.rim;
  if (Object.hasOwn(FONTS, s.font) && s.font !== 'auto') out.font = s.font;
  if (!nested && s.dice && typeof s.dice === 'object') {
    const dice = {};
    for (const k of DIE_SLOTS) { const d = cleanDiceStyle(s.dice[k], true); if (d) dice[k] = d; }
    if (Object.keys(dice).length) out.dice = dice;
  }
  return out;
}

/** The look one die of a set gets: its own, if it has one, or the set's. */
export function styleFor(set, d) {
  if (!set) return null;
  const own = set.dice?.[slotOf(d)];
  if (own) return own;
  const { dice, ...base } = set;
  return base;
}

/** Every material a set uses, anywhere (to check they're all unlocked). */
export function materialsIn(set) {
  const out = new Set();
  for (const s of [set, ...Object.values(set?.dice || {})]) {
    if (!s) continue;
    for (const k of [s.finish, s.overlay, s.rim]) if (k && FINISHES[k]?.material) out.add(k);
  }
  return [...out];
}

/** Your saved sets ([{ id, name, style }], up to 12), made safe. */
export const MAX_SETS = 12;
export function cleanDiceSets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const style = cleanDiceStyle(x?.style);
    const id = /^[a-z0-9]{4,20}$/.test(x?.id) ? x.id : null;
    const name = String(x?.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (!style || !id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, style });
    if (out.length >= MAX_SETS) break;
  }
  return out;
}

/** The plain style a roll gets when its roller hasn't chosen one: their player colour. */
export function defaultStyle(color) {
  const body = HEX.test(color) ? color.toLowerCase() : '#e8a33d';
  return { body, body2: body, ink: inkFor(body), finish: 'gloss', pattern: 'plain', picture: null };
}

/** Black or white numbers, whichever reads better on this colour. */
export function inkFor(hex) {
  const n = parseInt(String(hex || '#e8a33d').slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#141418' : '#ffffff';
}

/** Which face carries the picture: the highest number (20 on a d20, 6 on a d6, the 0 on a d10, the 00 on a tens die). */
export function pictureFace(labels, sides, kind = 'd') {
  const top = kind === 'tens' || kind === 'units' ? 0 : sides;
  return labels.indexOf(top);
}
