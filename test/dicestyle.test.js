import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanDiceStyle, defaultStyle, inkFor, pictureFace, PRESETS } from '../shared/dicestyle.js';
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
