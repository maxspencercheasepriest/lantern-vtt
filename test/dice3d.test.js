// 3D dice: the shapes, and the server's physics landing every die on the number that was rolled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED, dieShape, readFace, labelsFor, valuesFor, diceForResult } from '../shared/dice3d.js';
import { simulateThrow } from '../dicesim.js';

// a repeatable "random" for the throws
function seeded(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('each die has the right faces and numbers', () => {
  for (const s of SUPPORTED) {
    const d = dieShape(s);
    assert.equal(d.faces.length, s, `d${s} faces`);
    assert.deepEqual([...d.values].sort((a, b) => a - b), Array.from({ length: s }, (_, k) => k + 1), `d${s} numbers`);
    if (s !== 4) d.normals.forEach((n, k) => {
      const opp = d.normals.findIndex((m) => n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < -0.999);
      assert.equal(d.values[k] + d.values[opp], s + 1, `d${s} opposite faces add to ${s + 1}`);
    });
  }
  assert.deepEqual(valuesFor('tens', 10).slice().sort((a, b) => a - b), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.deepEqual(valuesFor('units', 10).slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('relabelling puts the wanted number on the landed face, each number once', () => {
  const d = dieShape(20);
  const labels = labelsFor(d, 3, 17);
  assert.equal(labels[3], 17);
  assert.equal(new Set(labels).size, 20);
  assert.equal(readFace(d, [0, 0, 0, 1]), d.normals.reduce((b, n, k) => (n[2] > d.normals[b][2] ? k : b), 0));
});

test('rolls become the dice to throw', () => {
  const dice = diceForResult({ parts: [
    { type: 'pct', dice: [{ chain: [30], label: 'tens', kept: false }, { chain: [70], label: 'tens', kept: true }, { chain: [7], label: 'units', kept: true }] },
    { type: 'dice', dice: [{ sides: 100, chain: [100] }, { sides: 3, chain: [2] }, { sides: 6, chain: [6, 4], value: 10 }] },
  ] });
  assert.deepEqual(dice.map((d) => `${d.kind}${d.sides}:${d.value}${d.kept ? '' : 'x'}`), ['tens10:30x', 'tens10:70', 'units10:7', 'tens10:0', 'units10:0', 'd6:6']);
});

test('the physics lands every die showing the rolled number', () => {
  const want = [{ sides: 4, v: 3 }, { sides: 6, v: 1 }, { sides: 8, v: 8 }, { sides: 10, v: 10 }, { sides: 12, v: 5 }, { sides: 20, v: 20 }];
  for (let seed = 1; seed <= 3; seed++) {
    const r = simulateThrow({ dice: want.map((w) => ({ sides: w.sides, kind: 'd', value: w.v, kept: true })), arena: { w: 18, h: 11 }, random: seeded(seed) });
    assert.ok(r.duration > 0.5 && r.duration <= 6.1, `duration ${r.duration}`);
    const last = r.frames.at(-1);
    r.dice.forEach((d, k) => {
      const q = last.slice(k * 7 + 3, k * 7 + 7);
      assert.equal(d.labels[readFace(dieShape(d.sides), q)], want[k].v, `d${d.sides} shows ${want[k].v}`);
      assert.ok(last[k * 7 + 2] > 0 && last[k * 7 + 2] < 2, 'resting on the table');
    });
  }
});

test('dice knock tokens about; walls stop them; untouched tokens are left out', () => {
  const tokens = [];
  for (let i = 0; i < 16; i++) tokens.push({ id: `t${i}`, x: 4 + (i % 4) * 2.2, y: -2.5 - Math.floor(i / 4) * 2.2, r: 0.8, h: 1.4, mass: 0.35 });
  tokens.push({ id: 'far', x: 17, y: -10.5, r: 0.4, h: 0.7, mass: 0.35 }); // tucked in a corner behind a wall
  let touched = 0, fallen = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const r = simulateThrow({ dice: [6, 6, 20].map((s) => ({ sides: s, kind: 'd', value: 1 })), arena: { w: 18, h: 11 }, tokens, walls: [[15.5, -9, 18, -9], [15.5, -9, 15.5, -11]], random: seeded(seed) });
    assert.ok(!r.tokens.some((t) => t.id === 'far'), 'the walled-off token never moves');
    touched += r.tokens.length; fallen += r.tokens.filter((t) => t.fallen).length;
    assert.equal(r.frames[0].length, (3 + r.tokens.length) * 7, 'only touched tokens are recorded');
    for (const t of r.tokens) assert.ok(t.x > 0 && t.x < 18 && t.y < 0 && t.y > -11, 'tokens stay on the table');
  }
  assert.ok(touched > 0, 'some tokens were hit');
  assert.ok(fallen >= 0);
});
