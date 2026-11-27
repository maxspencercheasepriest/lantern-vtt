import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDiceStyle, defaultStyle, inkFor, pictureFace, PRESETS, FINISHES, BASE_FINISHES, groupOf } from '../shared/dicestyle.js';
import { valuesFor } from '../shared/dice3d.js';

test('dice styles: only safe colours, finishes, patterns and our own uploads get through', () => {
  assert.equal(cleanDiceStyle(null), null);
  assert.equal(cleanDiceStyle({ body: 'red' }), null, 'needs a real colour');
  const s = cleanDiceStyle({ body: '#AA0000', body2: 'javascript:x', ink: '#fff', finish: 'lava', pattern: '<b>', picture: 'https://evil.example/x.png', extra: 1 });
  assert.deepEqual(s, { body: '#aa0000', body2: '#aa0000', ink: '#ffffff', finish: 'gloss', pattern: 'plain', picture: null });
  const ok = cleanDiceStyle({ body: '#7a1020', body2: '#2a0508', ink: '#f2e6d0', finish: 'pearl', pattern: 'marble', picture: '/uploads/5aa5e1b87e97109d675a59ca.png' });
  assert.equal(ok.picture, '/uploads/5aa5e1b87e97109d675a59ca.png');
  for (const p of PRESETS) assert.ok(cleanDiceStyle(p), p.name);
  assert.equal(defaultStyle('#e8a33d').ink, inkFor('#e8a33d'));
  assert.equal(inkFor('#111111'), '#ffffff');
});

test('dice styles: the picture goes on the highest face', () => {
  const d20 = valuesFor('d', 20), d6 = valuesFor('d', 6), d10 = valuesFor('d', 10), tens = valuesFor('tens', 10);
  assert.equal(d20[pictureFace(d20, 20)], 20);
  assert.equal(d6[pictureFace(d6, 6)], 6);
  assert.equal(d10[pictureFace(d10, 10)], 10, "a d10's 10 (printed 0)");
  assert.equal(tens[pictureFace(tens, 10, 'tens')], 0, 'the 00 on a tens die');
  assert.equal(valuesFor('units', 10)[pictureFace(valuesFor('units', 10), 10, 'units')], 0);
});

test('dice styles: the everyday finishes and the materials', () => {
  assert.deepEqual(BASE_FINISHES, ['gloss', 'matte', 'metal', 'glass', 'pearl']);
  const materials = Object.keys(FINISHES).filter((k) => FINISHES[k].material);
  assert.deepEqual(materials, ['iron', 'oak', 'copper', 'bone', 'garnet', 'jade', 'silver', 'obsidian', 'arcane', 'dragonbone', 'celestial', 'eldritch', 'royal', 'void', 'first',
    'wood', 'stone', 'goldleaf', 'ivory', 'galaxy', 'molten', 'runes', 'lantern', 'ink', 'keeper', 'frost', 'blossom', 'sunburst', 'harvest']);
  assert.deepEqual(materials.filter((m) => groupOf(m) === 'gm'), ['lantern', 'ink', 'keeper']);
  assert.deepEqual(materials.filter((m) => groupOf(m) === 'season').map((m) => FINISHES[m].season), ['winter', 'spring', 'summer', 'autumn']);
  assert.equal(groupOf('gloss'), 'finish');
  assert.equal(groupOf('iron'), 'material');
  assert.deepEqual(materials.filter((m) => FINISHES[m].creator), ['wood', 'stone', 'goldleaf', 'ivory', 'galaxy', 'molten', 'runes']);
  for (const m of materials) assert.equal(FINISHES[m].colors.length, 3, `${m} starts in its own colours`);
  assert.equal(cleanDiceStyle({ body: '#123456', finish: 'gold' }).finish, 'goldleaf', "0.31's gold leaf");
  for (const m of materials) assert.equal(cleanDiceStyle({ body: '#123456', finish: m }).finish, m);
});

test('dice designer: per-die looks, overlays, rims, fonts, and saved sets', async () => {
  const { styleFor, materialsIn, cleanDiceSets, slotOf, MAX_SETS } = await import('../shared/dicestyle.js');
  const s = cleanDiceStyle({
    body: '#112233', finish: 'obsidian', overlay: 'galaxy', rim: 'gold', font: 'serif',
    dice: { d20: { body: '#aa0000', finish: 'garnet', overlay: 'garnet' }, d7: { body: '#000000' }, d6: { nope: 1 } },
  });
  assert.equal(s.overlay, 'galaxy');
  assert.equal(s.overlayColor, FINISHES.galaxy.colors[1], 'an overlay starts in its own colour');
  assert.equal(s.rim, 'goldleaf', '0.31 names still work');
  assert.equal(s.font, 'serif');
  assert.deepEqual(Object.keys(s.dice), ['d20'], 'only real dice with a usable look');
  assert.equal(s.dice.d20.overlay, undefined, "a material isn't painted over itself");
  assert.equal(cleanDiceStyle({ body: '#112233', overlay: 'gloss', rim: 'metal', font: 'comic' }).overlay, undefined, 'only materials mix in');
  assert.equal(styleFor(s, { sides: 20, kind: 'd' }).finish, 'garnet');
  assert.equal(styleFor(s, { sides: 10, kind: 'tens' }).finish, 'obsidian');
  assert.equal(styleFor(s, { sides: 10, kind: 'units' }).dice, undefined);
  assert.equal(slotOf({ sides: 3, kind: 'd' }), null);
  assert.deepEqual(materialsIn(s).sort(), ['galaxy', 'garnet', 'goldleaf', 'obsidian']);
  const sets = cleanDiceSets([{ id: 'abcd1234', name: '  Lucky ', style: s }, { id: 'abcd1234', name: 'Dup', style: s }, { id: 'x', name: 'Bad id', style: s }, { id: 'ok123456', name: '', style: s }, ...Array.from({ length: 20 }, (_, i) => ({ id: `set${i}xxxx`, name: `S${i}`, style: { body: '#ffffff' } }))]);
  assert.equal(sets[0].name, 'Lucky');
  assert.equal(sets.length, MAX_SETS);
  assert.ok(!sets.some((x) => x.name === 'Dup' || x.name === 'Bad id'));
});
