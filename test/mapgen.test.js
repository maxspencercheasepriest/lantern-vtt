// The battlemap generator: every kind and size makes a sound, playable map, the same one for the same seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_KINDS, MAP_SIZES, generateMap as cyberMap } from '../shared/mapgen.js';
import { MAP_KINDS_1920, generateMap1920 } from '../shared/mapgen1920.js';

// both sets: the cyberpunk one and the 1920s one (whose kinds don't clash)
const ALL = { ...MAP_KINDS, ...MAP_KINDS_1920 };
const generateMap = (o) => (MAP_KINDS_1920[o.kind] ? generateMap1920(o) : cyberMap(o));
const kinds = Object.keys(ALL), sizes = Object.keys(MAP_SIZES);

test('same seed, same map; different seed, different map', () => {
  for (const kind of kinds) {
    assert.deepEqual(generateMap({ kind, seed: 99 }), generateMap({ kind, seed: 99 }), kind);
    assert.notDeepEqual(generateMap({ kind, seed: 99 }).walls, generateMap({ kind, seed: 100 }).walls, kind);
  }
});

test('everything stays on the map, and locks sit on doors', () => {
  for (const kind of kinds) for (const size of sizes) for (let seed = 1; seed <= 15; seed++) {
    const L = generateMap({ kind, size, seed });
    const on = ([x, y]) => x >= 0 && y >= 0 && x <= L.cols && y <= L.rows;
    for (const w of L.walls) assert.ok(on(w.a) && on(w.b), `${kind}/${size}/${seed} wall off the map`);
    for (const d of L.devices) {
      assert.ok(on([d.x, d.y]), `${kind} device off the map`);
      if (d.type === 'lock') assert.equal(L.walls[d.door]?.kind, 'door', `${kind} lock not on a door`);
      if (d.type === 'camera') assert.ok(Number.isFinite(d.dir));
    }
    for (const o of L.objects) assert.ok(o.x >= -3 && o.y >= -3 && o.x <= L.cols + 1 && o.y <= L.rows + 1, `${kind} ${o.type} off the map`);
  }
});

test('interiors: every room can be reached through doors, with a way in from outside', () => {
  for (const kind of kinds.filter((k) => ALL[k].interior)) for (const size of sizes) for (let seed = 1; seed <= 25; seed++) {
    const L = generateMap({ kind, size, seed });
    // flood fill across squares, crossing walls only through doors
    const blocked = new Set();
    for (const w of L.walls) {
      if (w.kind === 'door') continue;
      const [x1, y1] = w.a, [x2, y2] = w.b;
      if (x1 === x2) for (let y = Math.min(y1, y2); y < Math.max(y1, y2); y++) blocked.add(`v${x1},${y}`);
      else for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x++) blocked.add(`h${x},${y1}`);
    }
    const seen = new Set(['0,0']), queue = [[0, 0]];
    while (queue.length) {
      const [x, y] = queue.pop();
      const go = (nx, ny, edge) => { if (nx < 0 || ny < 0 || nx >= L.cols || ny >= L.rows || blocked.has(edge) || seen.has(`${nx},${ny}`)) return; seen.add(`${nx},${ny}`); queue.push([nx, ny]); };
      go(x + 1, y, `v${x + 1},${y}`); go(x - 1, y, `v${x},${y}`); go(x, y + 1, `h${x},${y + 1}`); go(x, y - 1, `h${x},${y}`);
    }
    for (const rm of L.rooms) assert.ok(seen.has(`${rm.x},${rm.y}`), `${kind}/${size}/${seed}: can't reach ${rm.name}`);
    if (!L.era) {
      assert.ok(L.devices.some((d) => d.type === 'alarm'), `${kind} has an alarm`);
      assert.ok(L.devices.some((d) => d.type === 'camera'), `${kind} has cameras`);
    }
    // nothing blocks a doorway
    for (const w of L.walls.filter((x) => x.kind === 'door')) {
      const [x1, y1] = w.a, vert = w.a[0] === w.b[0];
      const cells = vert ? [[x1 - 1, y1], [x1, y1]] : [[x1, y1 - 1], [x1, y1]];
      for (const [cx, cy] of cells) {
        const hit = L.objects.find((o) => o.room && cx >= Math.floor(o.x) && cx < Math.floor(o.x) + Math.ceil(o.w) && cy >= Math.floor(o.y) && cy < Math.floor(o.y) + Math.ceil(o.h));
        assert.ok(!hit, `${kind}/${size}/${seed}: ${hit?.type} in the doorway of ${w.name}`);
      }
    }
  }
});

test('a jail has cells on a corridor; a street has a road and shopfronts; the wilds have cover', () => {
  const jail = generateMap({ kind: 'jail', seed: 3 });
  assert.ok(jail.rooms.filter((r) => /^Cell /.test(r.name)).length >= 6);
  const street = generateMap({ kind: 'street', seed: 3 });
  assert.ok(street.objects.some((o) => o.type === 'lanes') && street.objects.filter((o) => o.type === 'car').length >= 4);
  assert.ok(street.walls.some((w) => w.kind === 'door'));
  const bad = generateMap({ kind: 'badlands', seed: 3 });
  assert.ok(bad.objects.filter((o) => o.type === 'rock').length >= 5, 'rocks to hide behind');
  assert.ok(bad.walls.length > 20, 'rocks block sight');
  const hot = generateMap({ kind: 'hotzone', seed: 3 });
  assert.ok(hot.objects.some((o) => o.type === 'crater' || o.type === 'rubble'));
});

test('1920s: secret doors are inside the building, never the way in, and the speakeasy hides behind its front shop', () => {
  assert.equal(Object.keys(MAP_KINDS_1920).filter((k) => MAP_KINDS[k]).length, 0, 'no clash with the cyberpunk kinds');
  for (const kind of ['manor', 'speakeasy', 'archive', 'church']) for (const size of sizes) for (let seed = 1; seed <= 25; seed++) {
    const L = generateMap1920({ kind, size, seed });
    assert.equal(L.era, '1920s');
    assert.deepEqual(L.devices, [], 'no security systems in the 1920s');
    const secret = L.walls.filter((w) => w.secret);
    assert.ok(secret.length >= 1, `${kind}/${size}/${seed} has a secret door`);
    for (const w of secret) {
      assert.equal(w.kind, 'door'); assert.equal(w.locked, false);
      assert.equal(w.rooms.length, 2, `${kind}/${size}/${seed}: ${w.name} leads outside`);
      assert.ok(w.name && w.name !== 'Front door');
    }
    if (kind === 'speakeasy') {
      const shop = L.rooms.find((rm) => rm.role === 'front');
      assert.ok(secret.every((w) => w.rooms.includes(shop.id)), 'the hidden door is in the barber shop');
    } else {
      assert.ok(L.rooms.some((rm) => rm.role === 'hidden'), `${kind} has a hidden room`);
    }
  }
  const asylum = generateMap1920({ kind: 'asylum', seed: 4 });
  assert.ok(asylum.rooms.filter((r) => /^Room /.test(r.name)).length >= 6, 'patient rooms');
  const woods = generateMap1920({ kind: 'woods', seed: 4 });
  assert.ok(woods.objects.filter((o) => o.type === 'standingstone').length >= 5, 'a stone circle');
  assert.ok(woods.walls.length > 100, 'tree trunks block sight');
  const docks = generateMap1920({ kind: 'docks', seed: 4 });
  assert.ok(docks.floors.some((f) => f.mat === 'water') && docks.walls.some((w) => w.kind === 'door'));
  const yard = generateMap1920({ kind: 'graveyard', seed: 4 });
  assert.ok(yard.objects.filter((o) => o.type === 'headstone').length >= 10);
  assert.ok(yard.walls.some((w) => w.kind === 'door' && w.locked), 'a locked tomb');
  const town = generateMap1920({ kind: 'town', seed: 4 });
  assert.ok(town.objects.some((o) => o.type === 'oldcar') && town.objects.some((o) => o.type === 'gaslamp'));
});
