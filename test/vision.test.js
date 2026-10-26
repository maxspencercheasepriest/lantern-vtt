import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../shared/vision.js';

// a 1000×1000 map split by a wall at x=500 with a door from y=400 to 600
const scene = (doorOpen) => ({
  map: { width: 1000, height: 1000, gridSize: 100 },
  walls: [
    { id: 'w1', a: [500, 0], b: [500, 400], kind: 'wall' },
    { id: 'd1', a: [500, 400], b: [500, 600], kind: 'door', open: doorOpen },
    { id: 'w2', a: [500, 600], b: [500, 1000], kind: 'wall' },
  ],
});

test('walls and closed doors block sight; open doors do not', () => {
  const closed = V.visibilityPolygon([250, 500], V.blockingSegments(scene(false)));
  assert.ok(V.pointInPolygon(100, 100, closed));
  assert.ok(!V.pointInPolygon(750, 500, closed));
  const open = V.visibilityPolygon([250, 500], V.blockingSegments(scene(true)));
  assert.ok(V.pointInPolygon(750, 500, open), 'straight through the open door');
  assert.ok(!V.pointInPolygon(750, 100, open), 'but not round the corner');
});

test('moves through walls are caught', () => {
  assert.ok(V.crossesWall([250, 500], [750, 500], scene(false)));
  assert.ok(!V.crossesWall([250, 500], [750, 500], scene(true)));
  assert.ok(V.crossesWall([250, 100], [750, 100], scene(true)));
  assert.ok(!V.crossesWall([100, 100], [400, 900], scene(false)));
});

test('explored grid marks what was seen and survives saving', () => {
  const s = scene(false);
  const g = V.exploredGrid(s);
  const view = { origin: [250, 500], poly: V.visibilityPolygon([250, 500], V.blockingSegments(s)) };
  assert.ok(V.markExplored(g, view));
  assert.ok(V.isExplored(g, 2, 2));
  assert.ok(!V.isExplored(g, g.cols - 2, 2));
  s.fog = { explored: V.packExplored(g) };
  const again = V.exploredGrid(s);
  assert.equal(V.isExplored(again, 2, 2), 1);
  assert.equal(V.isExplored(again, again.cols - 2, 2), 0);
  // a radius limits it
  const g2 = V.exploredGrid({ map: s.map });
  V.markExplored(g2, view, 100);
  assert.ok(V.isExplored(g2, Math.floor(250 / g2.cell), Math.floor(500 / g2.cell)));
  assert.ok(!V.isExplored(g2, 0, 0));
});

test('base64 round trip', () => {
  const b = new Uint8Array([0, 1, 2, 250, 255, 128, 7]);
  for (let n = 0; n <= b.length; n++) assert.deepEqual([...V.fromBase64(V.toBase64(b.subarray(0, n)))], [...b.subarray(0, n)]);
  assert.equal(V.toBase64(new Uint8Array([1, 2, 3, 4])), Buffer.from([1, 2, 3, 4]).toString('base64'));
});
