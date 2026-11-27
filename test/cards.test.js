import test from 'node:test';
import assert from 'node:assert/strict';
import { cardFacts, cleanCardDesign, cardColors } from '../shared/cards.js';

test('character cards: the right numbers for each game, and designs made safe', () => {
  const coc = cardFacts('coc7', { name: 'Harriet Vane', occupation: 'Antiquarian', age: 34, chars: { STR: 45, EDU: 85 }, hp: 11, san: 75, luck: 55, mp: 15 });
  assert.equal(coc.subtitle, 'Antiquarian · age 34');
  assert.deepEqual(coc.stats[0], ['STR', '45']);
  assert.deepEqual(coc.stats[1], ['CON', '—'], 'missing numbers show a dash');
  assert.deepEqual(coc.extras.map(([k]) => k), ['HP', 'Sanity', 'Luck', 'MP']);
  assert.equal(cardFacts('cpr', { name: 'Vincent', handle: 'Vex', role: 'Netrunner', stats: { INT: 8 } }).name, 'Vex', 'a handle is the name on the card');
  assert.deepEqual(cardFacts('traveller', { chars: { STR: { max: 7, cur: 5 } } }).stats[0], ['STR', '5']);
  assert.deepEqual(cardFacts('swade', { attrs: { Agility: '8' } }).stats[0], ['Agility', 'd8']);
  assert.equal(cardFacts('nonsense', {}).name, 'Unnamed');
  assert.equal(cardFacts('generic', { name: 'X', fields: [{ label: 'Class', value: 'Thief' }] }).stats[0][1], 'Thief');
  const d = cleanCardDesign({ theme: 'nope', layout: 'weird', c1: 'red', tagline: 'x'.repeat(200), photo: 'http://x/y.png', zoom: 99 });
  assert.deepEqual([d.theme, d.layout, d.c1, d.tagline.length, d.photo, d.zoom], ['fantasy', 'classic', null, 90, null, 5]);
  assert.equal(cardColors(cleanCardDesign({ theme: 'gothic', c1: '#112233' }))[0], '#112233', 'your own frame colour wins');
});
