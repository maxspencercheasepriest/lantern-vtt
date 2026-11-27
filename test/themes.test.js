import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_IDS, okTheme } from '../shared/themes.js';
import { cleanDiceStyle, materialsIn } from '../shared/dicestyle.js';

test('themes: every theme has words, a background and dice anyone can use', () => {
  assert.equal(THEME_IDS[0], 'none');
  for (const [id, t] of Object.entries(THEMES)) {
    assert.ok(t.name && t.icon && t.about, id);
    if (id === 'none') continue;
    assert.match(t.bg, /^#[0-9a-f]{6}$/, id);
    const d = cleanDiceStyle(t.dice);
    assert.ok(d, `${id} has dice`);
    assert.deepEqual(materialsIn(d), [], `${id}'s dice need nothing unlocked`);
    assert.equal(d.finish, t.dice.finish, `${id}'s finish is real`);
    assert.equal(d.pattern, t.dice.pattern, `${id}'s pattern is real`);
  }
  assert.equal(okTheme('gothic'), 'gothic');
  assert.equal(okTheme('<script>'), 'none');
});
