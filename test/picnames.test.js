import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyNames, imageKind } from '../shared/picnames.js';

test('tidying the names of a zip of pictures', () => {
  const top = 'Pack - Handouts/';
  const got = tidyNames([
    `${top}Call of Old - The Big Campaign Companion - Bloody Garden (Shanghai) - Handout #2.jpg`,
    `${top}Call of Old - The Big Campaign Companion - Case of Cat_s Cradle (Transit) - Handout #1.jpg`,
    `${top}Call of Old - The Big Campaign Companion - Elias Notes - 03.jpg`,
    `${top}Dark sects.png`,
  ]);
  assert.deepEqual(got, [
    { name: 'Bloody Garden - Handout #2', group: 'Shanghai' },
    { name: 'Case of Cat’s Cradle - Handout #1', group: 'Transit' },
    { name: 'Elias Notes - 03', group: '' },
    { name: 'Dark sects', group: '' },
  ]);
  assert.deepEqual(tidyNames(['maps/Appartments-02-1st-Floor.jpg', 'maps/london/Road-Small-01.jpg']),
    [{ name: 'Appartments 02 1st Floor', group: '' }, { name: 'Road Small 01', group: 'london' }]);
});

test('pictures are known by their bytes, not their names', () => {
  assert.equal(imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageKind(Buffer.from('GIF89a......')), 'gif');
  assert.equal(imageKind(Buffer.from('RIFF....WEBPVP8 ')), 'webp');
  assert.equal(imageKind(Buffer.from('<html>not a picture</html>')), null);
});
