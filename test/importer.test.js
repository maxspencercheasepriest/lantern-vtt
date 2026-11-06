import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCampaign, htmlToText, imageUrls, biggestImage, usableImage, downloadImages, ROLL20_SQUARE } from '../importer.js';

const S = ROLL20_SQUARE; // 70

// A small campaign shaped exactly like the export extension writes one.
const sample = () => ({
  format: 'lantern-roll20',
  version: 1,
  campaign: { id: 'c1', name: 'The Sunless Keep' },
  pages: [{
    id: 'p1', name: 'The Keep', width: 30, height: 20,
    scale_number: 5, scale_units: 'ft', showgrid: true, grid_opacity: 0.4, gridcolor: '#112233',
    dynamicLighting: true,
    graphics: [
      // the map itself, and a smaller decoration also on the map layer
      { id: 'g1', name: '', imgsrc: 'https://files.d20.io/images/1/keep/max.png', left: 1050, top: 700, width: 2100, height: 1400, layer: 'map' },
      { id: 'g2', name: 'rug', imgsrc: 'https://files.d20.io/images/9/rug/thumb.png', left: 350, top: 350, width: 140, height: 140, layer: 'map' },
      // a player token, 1 square, with a hit point bar and a character behind it
      { id: 'g3', name: 'Brannock', imgsrc: 'https://files.d20.io/images/2/bran/max.png', left: 175, top: 105, width: 70, height: 70, layer: 'objects', represents: 'char1',
        bars: [{ value: '12', max: '18' }, { value: '', max: '' }, { value: '', max: '' }] },
      // a big ogre the players shouldn't see yet
      { id: 'g4', name: 'Ogre', imgsrc: 'https://files.d20.io/images/3/ogre/max.png', left: 700, top: 700, width: 140, height: 140, layer: 'gmlayer',
        bars: [{ value: '', max: '' }, { value: '', max: '' }, { value: '', max: '' }] },
      // scribbles and lighting-layer bits that shouldn't become tokens
      { id: 'g5', name: '', imgsrc: '', left: 10, top: 10, width: 10, height: 10, layer: 'objects', isdrawing: true },
      { id: 'g6', name: 'light', imgsrc: 'https://files.d20.io/images/4/l/max.png', left: 20, top: 20, width: 70, height: 70, layer: 'walls' },
    ],
    paths: [
      { id: 'w1', layer: 'walls', barrierType: 'wall', points: [[0, 0], [700, 0], [700, 350]] },
      { id: 'w2', layer: 'walls', barrierType: 'transparent', points: [[0, 0], [70, 0]] },
      { id: 'd1', layer: 'objects', points: [[5, 5], [10, 10]] },
    ],
    doors: [{ id: 'dr1', x: 700, y: 350, isOpen: false, isLocked: true, path: { handle0: { x: -35, y: 0 }, handle1: { x: 35, y: 0 } } }],
  }],
  characters: [{
    id: 'char1', name: 'Brannock', avatar: 'https://files.d20.io/images/2/bran/max.png',
    bio: '<p>A <b>surly</b> dwarf.</p>', gmnotes: '<p>Owes money.</p>', inplayerjournals: 'all',
    attribs: [
      { name: 'strength', current: '16', max: '' }, { name: 'dexterity', current: '12', max: '' },
      { name: 'constitution', current: '15', max: '' }, { name: 'intelligence', current: '9', max: '' },
      { name: 'wisdom', current: '11', max: '' }, { name: 'charisma', current: '8', max: '' },
      { name: 'hp', current: '12', max: '18' }, { name: 'ac', current: '16', max: '' },
      { name: 'class', current: 'Fighter', max: '' }, { name: 'level', current: '3', max: '' },
      { name: 'speed', current: '25', max: '' }, { name: 'favourite_pie', current: 'steak', max: '' },
    ],
  }],
  handouts: [
    { id: 'h1', name: 'The Letter', notes: '<h2>Dear friend</h2><p>Come at <i>once</i>.</p>', gmnotes: '<p>It is a trap.</p>', inplayerjournals: 'all' },
    { id: 'h2', name: 'Secret', notes: '<p>Not for players.</p>', gmnotes: '', inplayerjournals: '' },
  ],
  diagnostics: [],
});

const imagesFor = (data) => new Map(imageUrls(data).map((u, i) => [u, `/uploads/${String(i).padStart(24, 'a')}.png`]));

test('a page becomes a scene the right size, with the grid Roll20 used', () => {
  const data = sample();
  const { scenes } = buildCampaign(data, { images: imagesFor(data) });
  assert.equal(scenes.length, 1);
  const sc = scenes[0];
  assert.equal(sc.name, 'The Keep');
  assert.equal(sc.map.width, 30 * S);
  assert.equal(sc.map.height, 20 * S);
  assert.equal(sc.map.gridSize, S);
  assert.equal(sc.map.unitsPerSquare, 5);
  assert.equal(sc.map.unitName, 'ft');
  assert.equal(sc.map.gridColor, '#112233');
  assert.equal(sc.map.gridOpacity, 0.4);
  assert.equal(sc.fogMode, 'sight', 'pages with dynamic lighting come in with line of sight on');
});

test('the biggest map-layer picture becomes the background; the rest stay as locked scenery', () => {
  const data = sample();
  const { scenes } = buildCampaign(data, { images: imagesFor(data) });
  const sc = scenes[0];
  assert.ok(sc.map.image, 'the keep itself is the background');
  const rug = sc.tokens.find((t) => t.label === 'rug');
  assert.ok(rug, 'the rug is still on the map');
  assert.equal(rug.locked, true);
});

test('tokens move from Roll20 centres to Lantern corners, keeping size, bars and secrecy', () => {
  const data = sample();
  const { scenes } = buildCampaign(data, { images: imagesFor(data) });
  const sc = scenes[0];
  const bran = sc.tokens.find((t) => t.label === 'Brannock');
  assert.deepEqual([bran.x, bran.y], [140, 70], 'left/top 175,105 with a 70px token');
  assert.equal(bran.size, 1);
  assert.deepEqual(bran.bar, { cur: 12, max: 18 });
  assert.equal(bran.hidden, false);
  assert.ok(bran.image.startsWith('/uploads/'));

  const ogre = sc.tokens.find((t) => t.label === 'Ogre');
  assert.equal(ogre.size, 2);
  assert.equal(ogre.hidden, true, 'the GM layer stays hidden');
  assert.equal(ogre.bar, null);

  assert.equal(sc.tokens.some((t) => t.label === 'light'), false, 'the lighting layer is not scenery');
  assert.equal(sc.tokens.length, 3, 'rug, Brannock, ogre — drawings are not tokens');
});

test('dynamic lighting paths become walls, and doors stay doors', () => {
  const data = sample();
  const { scenes, warnings } = buildCampaign(data, { images: imagesFor(data) });
  const sc = scenes[0];
  const walls = sc.walls.filter((w) => w.kind === 'wall');
  assert.equal(walls.length, 2, 'a three-point path is two segments');
  assert.deepEqual(walls[0], { a: [0, 0], b: [700, 0], kind: 'wall', open: false, locked: false });
  const door = sc.walls.find((w) => w.kind === 'door');
  assert.deepEqual([door.a, door.b], [[665, 350], [735, 350]]);
  assert.equal(door.locked, true);
  assert.ok(warnings.some((w) => /see-through/.test(w)), 'says what it left out');
  assert.ok(warnings.some((w) => /freehand/.test(w)));
});

test('a D&D character becomes a D&D sheet', () => {
  const data = sample();
  const { sheets } = buildCampaign(data, { images: imagesFor(data), system: 'dnd5e' });
  assert.equal(sheets.length, 1);
  const d = sheets[0].data;
  assert.equal(sheets[0].system, 'dnd5e');
  assert.equal(d.name, 'Brannock');
  assert.deepEqual(d.abilities, { STR: 16, DEX: 12, CON: 15, INT: 9, WIS: 11, CHA: 8 });
  assert.equal(d.hp, 12);
  assert.equal(d.hpMax, 18);
  assert.equal(d.ac, 16);
  assert.equal(d.level, 3);
  assert.equal(d.classLevel, 'Fighter');
  assert.equal(d.speed, 25);
  assert.ok(d.portrait.startsWith('/uploads/'));
  assert.match(d.notes, /surly/, 'the bio comes too');
  assert.match(d.notes, /GM notes/);
  assert.match(d.notes, /favourite_pie: steak/, 'anything unmapped is listed rather than lost');
  assert.ok(!/strength: 16/.test(d.notes), 'what was mapped is not repeated');
});

test('the same character under Call of Cthulhu uses that sheet instead', () => {
  const data = sample();
  data.characters[0].attribs.push({ name: 'sanity', current: '55', max: '' }, { name: 'size', current: '60', max: '' });
  const { sheets } = buildCampaign(data, { images: new Map(), system: 'coc7' });
  const d = sheets[0].data;
  assert.equal(sheets[0].system, 'coc7');
  assert.equal(d.chars.STR, 16);
  assert.equal(d.chars.SIZ, 60);
  assert.equal(d.san, 55);
});

test('an unknown ruleset keeps the name and writes the numbers into the notes', () => {
  const data = sample();
  const { sheets } = buildCampaign(data, { images: new Map(), system: 'tftl' });
  const d = sheets[0].data;
  assert.equal(d.name, 'Brannock');
  assert.match(d.notes, /strength: 16/);
  assert.match(d.notes, /hp: 12 \/ 18/);
});

test('handouts become notes, shared only if they were shared in Roll20', () => {
  const data = sample();
  const { notes } = buildCampaign(data, { images: new Map() });
  assert.equal(notes.length, 2);
  const letter = notes.find((n) => n.title === 'The Letter');
  assert.equal(letter.share, 'all');
  assert.equal(letter.folder, 'Roll20');
  assert.match(letter.body, /## Dear friend/);
  assert.match(letter.body, /\*once\*/);
  assert.match(letter.body, /GM notes/);
  assert.equal(notes.find((n) => n.title === 'Secret').share, 'none');
});

test('archived things are left behind', () => {
  const data = sample();
  data.characters[0].archived = true;
  data.handouts[0].archived = true;
  const out = buildCampaign(data, { images: new Map() });
  assert.equal(out.sheets.length, 0);
  assert.equal(out.notes.length, 1);
});

test('the report counts what came across', () => {
  const data = sample();
  const { report } = buildCampaign(data, { images: imagesFor(data) });
  assert.deepEqual(report, { campaign: 'The Sunless Keep', scenes: 1, tokens: 3, walls: 3, sheets: 1, notes: 2, backgrounds: 1 });
});

test('a file that is not one of ours is refused', () => {
  assert.throws(() => buildCampaign({ format: 'something-else' }), /isn't a Lantern export/);
  assert.throws(() => buildCampaign(null), /isn't a Lantern export/);
});

test('pictures are asked for at full size and only once', () => {
  const data = sample();
  const urls = imageUrls(data);
  assert.ok(urls.includes('https://files.d20.io/images/9/rug/max.png'), 'thumbnails are swapped for the big version');
  assert.equal(urls.filter((u) => u.includes('/bran/')).length, 1, 'the token and the avatar share one download');
  assert.equal(biggestImage('https://x/med.jpg?1'), 'https://x/max.jpg?1');
  assert.equal(usableImage('data:image/png;base64,xx'), false);
});

test('html becomes the markdown the notes panel understands', () => {
  assert.equal(htmlToText('<p>One</p><p>Two</p>'), 'One\n\nTwo');
  assert.equal(htmlToText('<ul><li>a</li><li>b</li></ul>'), '- a\n- b');
  assert.equal(htmlToText('Caf&eacute; &amp; bar &#8212; open'), 'Café & bar — open');
  assert.equal(htmlToText('<a href="https://x.test">link</a>'), '[link](https://x.test)');
  assert.equal(htmlToText('<script>bad()</script>safe'), 'safe');
  assert.equal(htmlToText(null), '');
});

test('downloading pictures keeps the good ones and reports the rest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-import-'));
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const fetchImpl = async (url) => {
    if (url.endsWith('gone.png')) return { ok: false, status: 404, headers: new Map() };
    if (url.endsWith('page.html')) return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => Buffer.from('<html>') };
    if (url.endsWith('boom.png')) throw new Error('socket hang up');
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => png };
  };
  const urls = ['https://x/a/max.png', 'https://x/b/max.png', 'https://x/gone.png', 'https://x/page.html', 'https://x/boom.png'];
  const seen = [];
  const { images, failed } = await downloadImages(urls, dir, { fetchImpl, concurrency: 2, onProgress: (d, t) => seen.push([d, t]) });

  assert.equal(images.size, 2);
  assert.equal(failed.length, 3);
  assert.deepEqual(failed.map((f) => f.why).sort(), ['HTTP 404', 'not an image (text/html)', 'socket hang up']);
  assert.equal(seen.length, 5, 'progress is reported for every file');
  for (const saved of images.values()) {
    assert.match(saved, /^\/uploads\/[a-f0-9]{24}\.png$/, 'saved under a name the server will serve');
    assert.ok(fs.existsSync(path.join(dir, path.basename(saved))));
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
