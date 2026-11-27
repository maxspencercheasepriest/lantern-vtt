// The themes: artwork either side of a page (Lantern Plus's Your games) or round the map at the table (a game's
// theme, set by its GM). The art is drawn in public/js/themes.js; this is the list, shared with the server, and each
// theme's matching dice (everyday finishes and patterns only, so nobody's locked out of them).
export const THEMES = {
  none: { name: 'Plain', icon: '◻️', about: 'Nothing either side', bg: null },
  fantasy: { name: 'Fantasy', icon: '🏰', about: 'A castle tower at night, banners and torchlight', bg: '#0e1226',
    dice: { body: '#7a1622', body2: '#d8b04a', ink: '#f2e2b0', finish: 'pearl', pattern: 'marble', font: 'serif' } },
  twenties: { name: '1920s', icon: '🍸', about: 'Art deco gold: fans, sunbursts and stepped columns', bg: '#0c0b08',
    dice: { body: '#15120c', body2: '#c9a24a', ink: '#e8c46a', finish: 'gloss', pattern: 'split', font: 'serif' } },
  scifi: { name: 'Sci-fi', icon: '🚀', about: 'A starship hull, blinking lights and a ringed planet', bg: '#05070f',
    dice: { body: '#2a3240', body2: '#39f0ff', ink: '#9ff6ff', finish: 'metal', pattern: 'plain', font: 'plain' } },
  altar: { name: 'Eldritch altar', icon: '🕯️', about: 'Candles on an old stone altar, glowing sigils, things rising from below', bg: '#060a08',
    dice: { body: '#14261d', body2: '#5dff9a', ink: '#c8ffd8', finish: 'glass', pattern: 'marble', font: 'serif' } },
  cyberpunk: { name: 'Cyberpunk', icon: '🌆', about: 'Neon towers in the rain', bg: '#0b0416',
    dice: { body: '#1a1030', body2: '#ff2a8a', ink: '#39f0ff', finish: 'gloss', pattern: 'split', font: 'plain' } },
  ww2: { name: 'Second World War', icon: '✈️', about: 'Searchlights over a bombed street, sandbags and planes overhead', bg: '#13140f',
    dice: { body: '#4d4a30', body2: '#2e2a1c', ink: '#e8e0c0', finish: 'matte', pattern: 'speckle', font: 'plain' } },
  western: { name: 'Wild West', icon: '🤠', about: 'A saloon at sunset, a turning windmill and tumbleweed', bg: '#1c1018',
    dice: { body: '#b8903a', body2: '#5a3a20', ink: '#2a1a10', finish: 'metal', pattern: 'plain', font: 'serif' } },
  pirate: { name: 'High seas', icon: '🏴‍☠️', about: 'A ship’s sails and rigging under the moon, waves rolling by', bg: '#081220',
    dice: { body: '#d8ccb0', body2: '#7a6a4a', ink: '#141418', finish: 'matte', pattern: 'speckle', font: 'serif' } },
  gothic: { name: 'Gothic', icon: '🦇', about: 'A graveyard by gaslight, a full moon, bats and creeping fog', bg: '#0c0b16',
    dice: { body: '#1a1626', body2: '#8a1a2a', ink: '#efe8d2', finish: 'pearl', pattern: 'marble', font: 'serif' } },
  wasteland: { name: 'Wasteland', icon: '☢️', about: 'Ruined towers, a rusted car and a burning barrel in the dust', bg: '#1a140c',
    dice: { body: '#8a4a1a', body2: '#3a2a1a', ink: '#f2d8a0', finish: 'matte', pattern: 'speckle', font: 'plain' } },
  eighties: { name: '1980s countryside', icon: '📼', about: 'Fields, pylons, a cooling tower and strange machines at dusk', bg: '#1a2030',
    dice: { body: '#e8a07a', body2: '#2a3a5a', ink: '#1a1a2a', finish: 'gloss', pattern: 'split', font: 'plain' } },
};
export const THEME_IDS = Object.keys(THEMES);
export const okTheme = (t) => (THEME_IDS.includes(t) ? t : 'none');
