// The themes: artwork either side of a page (Lantern Plus's Your games) or round the map at the table (a game's
// theme, set by its GM). The art is drawn in public/js/themes.js, or (pictures: true) is Flick's own pictures in
// public/themes/<id>-left.jpg and -right.jpg; this is the list, shared with the server, and each
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
  western: { name: 'Wild West', icon: '🤠', about: 'A frontier town at sunset: a windmill, a water tower, saloon porches', bg: '#1a0f0a', pictures: true,
    dice: { body: '#b8903a', body2: '#5a3a20', ink: '#2a1a10', finish: 'metal', pattern: 'plain', font: 'serif' } },
  pirate: { name: 'Nautical', icon: '⚓', about: 'A tall ship at the quay, a lighthouse over a stormy sea', bg: '#0a1018', pictures: true,
    dice: { body: '#d8ccb0', body2: '#2a3a52', ink: '#141418', finish: 'matte', pattern: 'speckle', font: 'serif' } },
  gothic: { name: 'Gothic horror', icon: '🦇', about: 'Cemetery gates, ravens, a dark manor under a full moon', bg: '#0c0c12', pictures: true,
    dice: { body: '#1a1626', body2: '#8a1a2a', ink: '#efe8d2', finish: 'pearl', pattern: 'marble', font: 'serif' } },
  wasteland: { name: 'Post-apocalyptic', icon: '☢️', about: 'Overgrown ruins, scaffolding and a rusted car', bg: '#11130e', pictures: true,
    dice: { body: '#8a4a1a', body2: '#3a2a1a', ink: '#f2d8a0', finish: 'matte', pattern: 'speckle', font: 'plain' } },
  eighties: { name: '1980s countryside', icon: '📼', about: 'Fields, pylons, a cooling tower and strange machines at dusk', bg: '#1a2030',
    dice: { body: '#e8a07a', body2: '#2a3a5a', ink: '#1a1a2a', finish: 'gloss', pattern: 'split', font: 'plain' } },
  academia: { name: 'Dark academia', icon: '📚', about: 'A candlelit library: tall windows, shelves of old books, a brass armillary', bg: '#120d08', pictures: true,
    dice: { body: '#3a2414', body2: '#c9a24a', ink: '#f2e2b0', finish: 'gloss', pattern: 'marble', font: 'serif' } },
  mythic: { name: 'Mythological', icon: '🏛️', about: 'Marble temples, columns and a god with a spear', bg: '#14120e', pictures: true,
    dice: { body: '#e8e0cc', body2: '#b8a06a', ink: '#2a2418', finish: 'pearl', pattern: 'marble', font: 'serif' } },
  dieselpunk: { name: 'Dieselpunk', icon: '🛩️', about: 'Airships over factories, smokestacks and glowing ironwork', bg: '#120f0b', pictures: true,
    dice: { body: '#4a3a28', body2: '#d89a3a', ink: '#f2d8a0', finish: 'metal', pattern: 'plain', font: 'plain' } },
  folklore: { name: 'Japanese folklore', icon: '⛩️', about: 'Cherry blossom, stone lanterns, a torii gate and a pagoda in the mist', bg: '#100e16', pictures: true,
    dice: { body: '#2a1a2a', body2: '#e8607a', ink: '#ffd8a0', finish: 'gloss', pattern: 'split', font: 'serif' } },
};
export const THEME_IDS = Object.keys(THEMES);
export const okTheme = (t) => (THEME_IDS.includes(t) ? t : 'none');
