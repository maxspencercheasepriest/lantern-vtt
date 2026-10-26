import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, evaluate, rollExpression, diceNeeded } from '../shared/dice.js';

// scripted roller: returns the given values in order
const script = (...vals) => async (sides) => {
  if (!vals.length) throw new Error(`ran out of scripted dice (wanted d${sides})`);
  const v = vals.shift();
  assert.ok(v >= 1 && v <= sides, `scripted ${v} not valid for d${sides}`);
  return v;
};

test('plain dice and modifiers', async () => {
  const r = await rollExpression('2d6 + 3', script(4, 5));
  assert.equal(r.total, 12);
  const r2 = await rollExpression('1d20-2', script(1));
  assert.equal(r2.total, -1);
  assert.ok(r2.flags.includes('nat1'));
});

test('keep highest / lowest (Traveller boon/bane)', async () => {
  assert.equal((await rollExpression('3d6kh2', script(2, 6, 5))).total, 11);
  assert.equal((await rollExpression('3d6kl2', script(2, 6, 5))).total, 7);
});

test('exploding dice chain', async () => {
  const r = await rollExpression('1d6!', script(6, 6, 2));
  assert.equal(r.total, 14);
  assert.ok(r.flags.includes('ace'));
});

test('cyberpunk crit and fumble', async () => {
  assert.equal((await rollExpression('1d10cp+12', script(10, 7))).total, 29);
  const f = await rollExpression('1d10cp+12', script(1, 4));
  assert.equal(f.total, 9);
  assert.ok(f.flags.includes('fumble'));
});

test('savage worlds wild die', async () => {
  const r = await rollExpression('sw8+1', script(3, 6, 4));
  assert.equal(r.total, 11); // wild die aced 6+4=10 beats 3
  const p = r.parts[0];
  assert.equal(p.dice[1].kept, true);
  const s = await rollExpression('sw6', script(1, 1));
  assert.ok(s.flags.includes('snake-eyes'));
});

test('dice needed and errors', () => {
  assert.deepEqual(diceNeeded(parse('2d6+sw8')), [6, 6, 8, 6]);
  assert.throws(() => parse('2d6*3'));
  assert.throws(() => parse('d1'));
  assert.throws(() => parse('1d6cp'));
  assert.throws(() => parse('hello'));
  assert.equal(parse('d%').terms[0].sides, 100);
});

test('percentile bonus and penalty dice', async () => {
  // order asked for: units, then tens dice. 10 on a d10 reads as 0.
  let r = await rollExpression('d100b1', script(5, 7, 2)); // units 5, tens 70 / 20 -> keep 25
  assert.equal(r.total, 25);
  r = await rollExpression('d100p1', script(5, 7, 2)); // penalty keeps 75
  assert.equal(r.total, 75);
  r = await rollExpression('d100b0', script(10, 10)); // 00 + 0 = 100
  assert.equal(r.total, 100);
  assert.ok(r.flags.includes('fumble'));
  r = await rollExpression('d100p2', script(1, 10, 10, 10)); // 01 even with penalty dice of 00
  assert.equal(r.total, 1);
  assert.ok(r.flags.includes('crit'));
  assert.deepEqual(diceNeeded(parse('d%b2')), [10, 10, 10, 10]);
  assert.throws(() => parse('d100b3'));
});

test('success pools (Year Zero)', async () => {
  const r = await rollExpression('5d6s6', script(6, 2, 6, 1, 5));
  assert.equal(r.total, 2);
  assert.equal(r.mode, 'successes');
  assert.equal((await rollExpression('4d10s8', script(8, 9, 7, 10))).total, 3);
});

test('advantage keeps natural 20', async () => {
  const r = await rollExpression('2d20kh1+5', script(20, 3));
  assert.equal(r.total, 25);
  assert.ok(r.flags.includes('nat20'));
  const d = await rollExpression('2d20kl1', script(20, 1));
  assert.ok(d.flags.includes('nat1'));
});

test('pushing a Year Zero pool re-rolls only the failures', async () => {
  const { pushPool, pushNeeded } = await import('../shared/dice.js');
  const r = await rollExpression('4d6s6+0', script(6, 2, 6, 3));
  assert.deepEqual(pushNeeded(r), [6, 6]);
  const p = await pushPool(r, script(6, 1));
  assert.equal(p.total, 3);
  assert.deepEqual(p.parts[0].dice.map((d) => d.value), [6, 6, 6, 1]);
  assert.ok(p.parts[0].dice[1].pushed && !p.parts[0].dice[0].pushed);
  assert.ok(p.flags.includes('pushed'));
});
