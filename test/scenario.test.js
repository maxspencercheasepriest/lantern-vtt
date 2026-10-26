import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../library.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-scenario-'));
const lib = new Library(dir);
async function analyse(name) {
  const tmp = path.join(dir, `${name}.upload`);
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', name), tmp);
  const d = lib.add(tmp, name, fs.statSync(tmp).size);
  await lib.queue;
  return lib.analyse(d.id);
}

for (const [name, method] of [['scenario-bookmarks.pdf', 'bookmarks'], ['scenario-plain.pdf', 'headings']]) {
  test(`scenario prep: ${method}`, async () => {
    const r = await analyse(name);
    assert.equal(r.method, method);
    const titles = r.sections.map((s) => s.title);
    for (const t of ['Introduction', 'Keeper Background', 'Part One: The Commission', 'The Newspaper Archive', 'Part Two: The Corbitt House', 'The Cellar']) {
      assert.ok(titles.includes(t), `found section "${t}" (got ${titles.join(' | ')})`);
    }
    // in the right order, with the right levels
    assert.ok(titles.indexOf('Part Two: The Corbitt House') < titles.indexOf('The Cellar'));
    const lv = (t) => r.sections.find((s) => s.title === t).level;
    assert.equal(lv('Part One: The Commission'), 1);
    assert.equal(lv('The Newspaper Archive'), 2);
    // read-aloud text becomes a quote in the note, and is listed
    const p1 = r.sections.find((s) => s.title === 'Part One: The Commission');
    assert.match(p1.text, /^> The landlord leans close/m);
    assert.equal(r.readAloud.length, 2);
    assert.ok(!r.readAloud.some((x) => /scenario for Call of Cthulhu/.test(x.text)), 'subtitles are not read-aloud text');
    // handouts with their pictures, and links to them from the text
    assert.deepEqual(r.handouts.map((h) => [h.page, !!h.rect]), [[4, true], [5, true]]);
    assert.match(r.sections.find((s) => s.title === 'The Newspaper Archive').text, /\[\[pdf:scenario-\w+#4\|Handout 1\]\]/);
    // the full-page map
    assert.equal(r.maps.length, 1);
    assert.equal(r.maps[0].page, 6);
    assert.ok(r.maps[0].rect.w > 0.8 && r.maps[0].rect.h > 0.8);
    // cached for next time
    assert.equal(lib.scenario(r.docId).sections.length, r.sections.length);
  });
}
