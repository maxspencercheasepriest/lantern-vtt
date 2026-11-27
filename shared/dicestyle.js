// Custom dice: what a person's dice look like when they roll. Used by the server (to clean what a browser sends,
// and to put the roller's style on each throw) and by the browser (to paint the dice and the Dice tab's picker).
// Pure: no DOM, no Node.

export const FINISHES = {
  gloss: { label: 'Gloss', roughness: 0.32, metalness: 0.05 },
  matte: { label: 'Matte', roughness: 0.85, metalness: 0 },
  metal: { label: 'Metal', roughness: 0.28, metalness: 0.85 },
  glass: { label: 'Glass', roughness: 0.08, metalness: 0, opacity: 0.72 },
  pearl: { label: 'Pearl', roughness: 0.22, metalness: 0.35 },
};

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
const PIC = /^\/uploads\/[a-f0-9]{16,40}\.(png|jpe?g|webp|gif)$/;

/** A style from anywhere (a browser, a saved file) made safe, or null when there's nothing usable. */
export function cleanDiceStyle(s) {
  if (!s || typeof s !== 'object') return null;
  const body = HEX.test(s.body) ? s.body.toLowerCase() : null;
  if (!body) return null;
  return {
    body,
    body2: HEX.test(s.body2) ? s.body2.toLowerCase() : body,
    ink: HEX.test(s.ink) ? s.ink.toLowerCase() : inkFor(body),
    finish: Object.hasOwn(FINISHES, s.finish) ? s.finish : 'gloss',
    pattern: Object.hasOwn(PATTERNS, s.pattern) ? s.pattern : 'plain',
    picture: typeof s.picture === 'string' && PIC.test(s.picture) ? s.picture : null,
  };
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
