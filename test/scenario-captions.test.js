// Scenario prep on the kind of layout big campaign books use (worked out against a real one): decorated
// pages, handouts captioned "<Name> Papers <Place> #N" beside their picture, captioned maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysePages } from '../scenario.js';

const W = 612, H = 792;
const line = (text, y, extra = {}) => ({ text, x: 60, y, size: 10, bold: false, italic: false, ...extra });
const body = (n) => Array.from({ length: 12 }, (_, i) => line(`Ordinary paragraph text on page ${n} that runs across the column, line ${i}.`, 120 + i * 14));
const bg = { x: 0, y: 0, w: 1, h: 1, area: 1, px: '2550x3300' };          // the parchment on every page
const border = { x: 0.02, y: 0.1, w: 0.05, h: 0.8, area: 0.04, px: '60x900' }; // the strip down the side

function book() {
  const pages = Array.from({ length: 40 }, (_, i) => ({ n: i + 1, W, H, lines: body(i + 1), images: [bg, border] }));
  // chapter page: the section heading is found before the chapter's own (unfound) heading
  pages[1].lines.unshift(line('Arriving in Ohio', 60, { bold: true, size: 14 }));
  // body text mentions a handout in running text
  pages[2].lines.push(line('The clerk hands over a letter ( Bryce Papers Ohio #1 ) and a card ( Bryce Papers Ohio #2 ).', 400));
  // the handout page: two pictures, each with its caption beside it
  pages[4].images.push({ x: 0.1, y: 0.1, w: 0.5, h: 0.4, area: 0.2, px: '800x640' }, { x: 0.6, y: 0.6, w: 0.3, h: 0.2, area: 0.06, px: '500x300' });
  pages[4].lines.push(line('Bryce Papers Ohio #1', 0.06 * H, { x: 0.1 * W, italic: true, size: 8 }), line('Bryce Papers Ohio #2', 0.82 * H, { x: 0.6 * W, italic: true, size: 8 }));
  // a sentence that happens to end like a caption is not one
  pages[6].lines.push(line('They should read it again. See Bryce Papers Ohio #3', 500));
  // a map with its caption, drawn twice (the picture and its frame)
  pages[8].images.push({ x: 0.1, y: 0.1, w: 0.8, h: 0.5, area: 0.4, px: '2000x1250' }, { x: 0.11, y: 0.11, w: 0.78, h: 0.48, area: 0.37, px: '1900x1200' });
  pages[8].lines.push(line('Above: Map of the Mill', 0.62 * H));
  // a page whose text talks about a plan isn't a map
  pages[10].images.push({ x: 0.1, y: 0.1, w: 0.5, h: 0.5, area: 0.25, px: '900x900' });
  pages[10].lines.push(line('Their plan is simple, and they follow it.', 520));
  return pages;
}

test('scenario prep: decoration, captioned handouts, captioned maps, bookmark order', () => {
  const r = analysePages(book(), {
    title: 'Ohio',
    outline: [{ title: 'Chapter One: Ohio', level: 1, page: 2 }, { title: 'Arriving in Ohio', level: 2, page: 2 }, { title: 'The Mill', level: 2, page: 8 }],
  });
  // page backgrounds and borders are never handouts or maps
  assert.ok(!r.maps.some((m) => m.rect.w > 0.95), 'no full-page background');
  // both captions found, each with its own picture
  assert.deepEqual(r.handouts.map((h) => [h.label, h.page]), [['Bryce Papers Ohio #1', 5], ['Bryce Papers Ohio #2', 5]]);
  const [h1, h2] = r.handouts;
  assert.ok(h1.rect.w > 0.45 && h1.rect.y < 0.15, 'the big picture by caption 1');
  assert.ok(h2.rect.x > 0.55, 'the small picture by caption 2');
  // running text links to them
  const all = r.sections.map((s) => s.text).join('\n');
  assert.match(all, /\[\[pdf:Ohio#5\|Bryce Papers Ohio #1\]\]/);
  assert.match(all, /\[\[pdf:Ohio#5\|Bryce Papers Ohio #2\]\]/);
  // one map for the picture-and-frame, named from its caption
  assert.deepEqual(r.maps.map((m) => [m.page, m.label]), [[9, 'Map of the Mill']]);
  // the chapter comes before its first section
  const titles = r.sections.map((s) => s.title);
  assert.ok(titles.indexOf('Chapter One: Ohio') < titles.indexOf('Arriving in Ohio'));
});
