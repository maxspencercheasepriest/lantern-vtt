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
