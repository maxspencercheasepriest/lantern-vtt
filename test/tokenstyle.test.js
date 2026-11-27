import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTokenDesign, cleanTokenLib, tokenMaterials, DEFAULT_TOKEN, MAX_TOKENS } from '../shared/tokenstyle.js';

test('token designer: designs are made safe, libraries are capped, materials are listed for unlocks', () => {
  const d = cleanTokenDesign({ photo: '/uploads/0123456789abcdef0123.png', zoom: 99, ox: -9, rim: 'royal', c1: '#ABCDEF', trim: 'laser', glow: 'red', plate: 'A very long name plate indeed, far too long', width: 0 });
  assert.equal(d.zoom, 5);
  assert.equal(d.ox, -1.5);
  assert.equal(d.c1, '#abcdef');
  assert.equal(d.trim, 'double', 'an unknown trim gets the usual one');
  assert.equal(d.glow, null);
  assert.equal(d.plate.length, 24);
  assert.equal(d.width, 0.04);
  assert.equal(cleanTokenDesign({ photo: 'https://evil.example/x.png' }).photo, null, 'only pictures on this server');
  assert.deepEqual(cleanTokenDesign(null), { ...DEFAULT_TOKEN });
  assert.deepEqual(tokenMaterials(d), ['royal']);
  assert.deepEqual(tokenMaterials(cleanTokenDesign({ rim: 'gloss' })), []);
  const img = '/uploads/0123456789abcdef0123.png';
  const lib = cleanTokenLib([{ id: 'abcd1234', name: 'Hale', image: img, design: d }, { id: 'abcd1234', name: 'Dup', image: img }, { id: 'zz', image: img }, { id: 'nopic123', image: 'x' },
    ...Array.from({ length: 50 }, (_, i) => ({ id: `tok${i}xxxx`, name: '', image: img }))]);
  assert.equal(lib.length, MAX_TOKENS);
  assert.equal(lib[0].name, 'Hale');
  assert.equal(lib[1].name, 'Token', 'a token always has a name');
});
