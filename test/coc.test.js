import test from 'node:test';
import assert from 'node:assert/strict';
import { pctLevel, passes, earnsTick, canTick, develop, skillRow } from '../shared/coc.js';

test('Call of Cthulhu success levels', () => {
  assert.equal(pctLevel(1, 10), 5, 'a 1 is always a critical');
  assert.equal(pctLevel(100, 99), 0, 'a 100 is always a fumble');
  assert.equal(pctLevel(96, 40), 0, 'under 50, 96+ fumbles');
  assert.equal(pctLevel(96, 60), 1, 'from 50, 96 is only a failure');
  assert.equal(pctLevel(12, 60), 4); assert.equal(pctLevel(30, 60), 3); assert.equal(pctLevel(60, 60), 2); assert.equal(pctLevel(61, 60), 1);
  assert.ok(passes({ type: 'pct', target: 60, need: 'regular' }, 55));
  assert.ok(!passes({ type: 'pct', target: 60, need: 'hard' }, 55), 'a regular success fails a Hard roll');
  assert.ok(passes({ type: 'pct', target: 60, need: 'hard' }, 30));
  assert.ok(!passes({ type: 'dc', target: 10 }, 15), 'only percentile checks');
});

test('which rolls tick a skill', () => {
  const meta = (skill, need = 'regular') => ({ check: { type: 'pct', target: 50, need }, improve: { sheet: 's1', skill } });
  assert.ok(earnsTick(meta('Spot Hidden'), 40));
  assert.ok(!earnsTick(meta('Spot Hidden'), 70), 'not on a failure');
  assert.ok(!earnsTick(meta('Spot Hidden', 'hard'), 40), 'not when it missed the level it needed');
  assert.ok(!earnsTick(meta('Cthulhu Mythos'), 10) && !earnsTick(meta(' credit rating '), 10), 'Mythos and Credit Rating never improve by use');
  assert.ok(!earnsTick({ check: { type: 'pct', target: 50 }, improve: { skill: 'Listen' } }, 10), 'only rolls made from a sheet');
  assert.ok(!earnsTick({ check: { type: 'pct', target: 50 } }, 10), 'characteristics, Luck and Sanity have no skill');
  assert.ok(canTick('Library Use') && !canTick(''));
  assert.equal(skillRow({ skills: [{ name: 'Library Use', value: 20 }] }, ' library use ').value, 20);
});

test('development phase', () => {
  assert.deepEqual(develop(45, 71, 7), { up: true, rolled: 71, gain: 7, before: 45, after: 52, sanity: 0 });
  assert.equal(develop(45, 30, 7).after, 45, 'rolling under the skill means no improvement');
  assert.equal(develop(97, 97, 4).after, 101, 'over 95 always improves');
  assert.equal(develop(85, 90, 6, 8).sanity, 8, 'reaching 90 earns 2d6 Sanity');
  assert.equal(develop(92, 99, 6, 8).sanity, 0, 'only the first time');
});
