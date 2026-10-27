import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('../../../public/handouts/thaw/', import.meta.url).pathname;
const TYPES = { '.html':'text/html; charset=utf-8', '.json':'application/json' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  try {
    const file = p === '/' ? 'deck.html' : p;
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (n, p, x = '') => { results.push({ n, p }); console.log(`${p ? '  ok  ' : ' FAIL '} ${n}${x ? '  — ' + x : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 980 } });
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type()==='error' && !/404/.test(m.text())) errors.push(m.text()); }); };

const b = await ctx.newPage(); watch(b);
// click the timeline at a fraction of its width
const seekPct = async (page, pct) => {
  const box = await page.locator('#track').boundingBox();
  await page.mouse.click(box.x + Math.min(box.width - 2, box.width * pct), box.y + box.height / 2);
  await page.waitForTimeout(180);
};
await b.goto(BASE + 'bd.html');
await b.waitForSelector('#reels button');

// ── player view ──
check('only available reels are on the picker', (await b.$$('#reels button')).length === 1,
  (await b.textContent('#reels')).trim());
check('held reel is hidden', !(await b.textContent('#reels')).includes('FARE'));
check('opens on the visual layer', (await b.getAttribute('.layers button.visual', 'aria-pressed')) === 'true');
check('viewport shows the first moment', (await b.textContent('#v-txt')).includes('noodle bar'));
check('duration is shown', (await b.textContent('#t-dur')) === '03:10', await b.textContent('#t-dur'));
check('findings start empty', (await b.textContent('#findings')).includes('Nothing yet'));
check('progress meter reads 0 of 4', (await b.textContent('#t-prog')) === '0 of 4', await b.textContent('#t-prog'));
await b.screenshot({ path: 'shots/bd1-open.png' });

// ── scrubbing a non-clue layer finds nothing ──
await b.click('#b-next');            // → 35s
await b.waitForTimeout(100);
check('next moment jumps the playhead', (await b.textContent('#t-cur')) === '00:35', await b.textContent('#t-cur'));
check('visual at 35s is not a clue', (await b.textContent('#findings')).includes('Nothing yet'));

// ── audio at 35s is a clue ──
await b.click('.layers button.audio');
await b.waitForTimeout(150);
check('layer switch changes the viewport text', (await b.textContent('#v-txt')).includes('advisory'));
check('landing on a clue logs it', (await b.textContent('#findings')).includes('advisory'));
check('and says so in the viewport', (await b.textContent('#v-new')).includes('logged'));
check('progress ticks up', (await b.textContent('#t-prog')) === '1 of 4', await b.textContent('#t-prog'));
check('the header count updates', (await b.textContent('#t-found')) === '1');
check('a found clue lights its timeline marker', (await b.$$('#tk-marks .mk.clue')).length === 1);
await b.screenshot({ path: 'shots/bd2-clue.png' });

// re-landing doesn't double-log
await b.click('#b-prev'); await b.waitForTimeout(100);
await b.click('#b-next'); await b.waitForTimeout(150);
check('re-watching a clue does not log it twice', (await b.textContent('#t-found')) === '1');
check('and the "logged" flash is gone on a revisit', !(await b.textContent('#v-new')).includes('logged'));

// ── thermal ──
await b.click('.layers button.thermal');
await b.waitForTimeout(150);
check('thermal at 35s is empty', (await b.textContent('#v-txt')).includes('Nothing on this layer'));
await b.click('#b-next'); await b.waitForTimeout(150);   // 72s
check('thermal at 72s reveals the chassis', (await b.textContent('#findings')).includes('chassis'));
check('progress is 2 of 4', (await b.textContent('#t-prog')) === '2 of 4');

// ── transport ──
await b.click('#b-back'); await b.waitForTimeout(100);
check('back 5s moves the playhead', (await b.textContent('#t-cur')) === '01:07', await b.textContent('#t-cur'));
await b.click('#b-fwd'); await b.waitForTimeout(100);
check('forward 5s returns it', (await b.textContent('#t-cur')) === '01:12');
await seekPct(b, 0.004);
check('clicking the track seeks', Number((await b.textContent('#t-cur')).slice(3)) < 10, await b.textContent('#t-cur'));
await b.click('#b-play');
check('play button toggles to pause', (await b.textContent('#b-play')) === 'Pause');
await b.waitForTimeout(700);
await b.click('#b-play');
check('playback advances the reel', (await b.textContent('#t-cur')) !== '00:00', await b.textContent('#t-cur'));
check('and stops again', (await b.textContent('#b-play')) === 'Play');

// keyboard
await b.evaluate(() => document.activeElement.blur());
await b.keyboard.press('1');
await b.waitForTimeout(100);
check('key 1 switches to visual', (await b.getAttribute('.layers button.visual','aria-pressed')) === 'true');
await b.keyboard.press('3');
await b.waitForTimeout(100);
check('key 3 switches to thermal', (await b.getAttribute('.layers button.thermal','aria-pressed')) === 'true');

// corrupt tail
await seekPct(b, 1);
check('the corrupt tail reads as corrupt', (await b.textContent('#v-txt')).includes('corrupt'));
check('corrupt moments log nothing', (await b.textContent('#t-found')) === '2');

// persistence
await b.reload();
await b.waitForSelector('#reels button');
check('findings survive a reload', (await b.textContent('#t-found')) === '2');
check('GM view does not survive a reload', await b.isHidden('#t-gmview'));
check('and held reels are hidden again', !(await b.textContent('#reels')).includes('FARE'));

// ── GM ──
await b.evaluate(() => document.activeElement.blur());
await b.keyboard.type('gmgm');
await b.waitForSelector('#gm:not([hidden])');
check('gmgm opens the GM panel', true);
check('both reels are listed for editing', (await b.$$('#g-reels tr')).length === 2);
await b.check('#g-gmview');
await b.waitForTimeout(150);
await b.click('#gm-close');
await b.waitForTimeout(200);
check('GM view badge appears', await b.isVisible('#t-gmview'));
check('GM view reveals the held reel', (await b.textContent('#reels')).includes('FARE'));
check('GM note shows on the findings pane', (await b.textContent('#gm-hint')).includes('gig board'));
await b.screenshot({ path: 'shots/bd3-gmview.png' });

// release the held reel
await b.evaluate(() => document.activeElement.blur());
await b.keyboard.type('gmgm');
await b.waitForSelector('#gm:not([hidden])');
const fareRow = b.locator('#g-reels tr', { has: b.locator('input[value*="FARE"]') });
await fareRow.locator('td.chk input').check();
await b.waitForTimeout(150);
await b.click('#gm-close');
await b.waitForTimeout(150);
await b.reload();
await b.waitForSelector('#reels button');
check('releasing a reel makes it permanent for the player',
  (await b.textContent('#reels')).includes('FARE') && await b.isHidden('#t-gmview'));

// play the released reel
await b.locator('#reels button', { hasText: 'FARE' }).click();
await b.waitForTimeout(150);
check('switching reel resets the playhead', (await b.textContent('#t-cur')) === '00:00');
check('findings pane is per-reel', (await b.textContent('#findings')).includes('Nothing yet'));
check('it has seven clues', (await b.textContent('#t-prog')) === '0 of 7', await b.textContent('#t-prog'));
await b.click('.layers button.audio');
await b.click('#b-next'); await b.waitForTimeout(150);   // 45s
check('the eighteen-months line logs', (await b.textContent('#findings')).includes('Eighteen months'));
await b.screenshot({ path: 'shots/bd4-fare.png' });

// ── GM authoring ──
await b.evaluate(() => document.activeElement.blur());
await b.keyboard.type('gmgm');
await b.waitForSelector('#gm:not([hidden])');
await b.fill('#ar-t', 'STAIRWELL — 04:11');
await b.fill('#ar-s', 'recovered from a dead scav');
await b.fill('#ar-d', '90');
await b.click('#ar-add');
await b.waitForTimeout(200);
check('a new reel is added', (await b.$$('#g-reels tr')).length === 3);
await b.selectOption('#m-sel', { label: 'STAIRWELL — 04:11' });
await b.waitForTimeout(150);
await b.fill('#am-t', '20');
await b.click('#am-add');
await b.waitForTimeout(200);
check('a moment can be added to it', (await b.$$('#g-moments tr')).length === 1);
const row = b.locator('#g-moments tr').first();
await row.locator('textarea').nth(2).fill('Someone waited here in the dark for a long time.');
await row.locator('textarea').nth(2).dispatchEvent('change');
await row.locator('td.chk input').nth(2).check();
await b.waitForTimeout(150);
await b.click('#gm-close');
await b.waitForTimeout(150);
await b.locator('#reels button', { hasText: 'STAIRWELL' }).click();
await b.waitForTimeout(150);
await b.click('.layers button.thermal');
await seekPct(b, 0.31);
check('an authored clue logs like the built-in ones',
  (await b.textContent('#findings')).includes('waited here in the dark'));

// clear findings for one reel only
await b.evaluate(() => document.activeElement.blur());
await b.keyboard.type('gmgm');
await b.waitForSelector('#gm:not([hidden])');
await b.selectOption('#m-sel', { label: 'STAIRWELL — 04:11' });
await b.click('#g-clear');
await b.waitForTimeout(200);
await b.click('#gm-close');
await b.waitForTimeout(150);
check('clearing wipes only that reel', (await b.textContent('#findings')).includes('Nothing yet'));
await b.locator('#reels button', { hasText: 'FARE' }).click();
await b.waitForTimeout(150);
check('other reels keep their findings', (await b.textContent('#findings')).includes('Eighteen months'));

// export
await b.evaluate(() => document.activeElement.blur());
await b.keyboard.type('gmgm');
await b.waitForSelector('#gm:not([hidden])');
await b.click('#g-export');
await b.waitForTimeout(150);
const json = await b.inputValue('#g-json');
check('export produces valid JSON', (() => { try { return JSON.parse(json).reels.length === 3; } catch { return false; } })());
check('export carries no gmview flag', !json.includes('"gmview"'));
await b.click('#gm-close');

// ── through the deck ──
const dk = await ctx.newPage(); watch(dk);
await dk.goto(BASE + 'deck.html');
await dk.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
await dk.fill('#cmd', 'scan'); await dk.press('#cmd', 'Enter');
await dk.waitForFunction(()=>/mounted|nothing new/.test(document.querySelector('#out').textContent), null, { timeout: 15000 });
check('scan picks up the braindance editor', (await dk.textContent('#out')).includes('BD.HTML'));
check('and titles it from the page', (await dk.textContent('#out')).includes('BRAINDANCE'));
await dk.fill('#cmd', 'open /mnt/BD.HTML'); await dk.press('#cmd', 'Enter');
await dk.waitForSelector('#appwrap:not([hidden])');
await dk.frameLocator('#frame').locator('#reels button').first().waitFor({ timeout: 20000 });
check('it launches inside the deck', true);
await dk.screenshot({ path: 'shots/bd5-in-deck.png' });

// ── narrow ──
const mob = await browser.newContext({ viewport: { width: 400, height: 880 } });
const mp = await mob.newPage(); watch(mp);
await mp.goto(BASE + 'bd.html');
await mp.waitForSelector('#reels button');
const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 400px', ov <= 1, 'overflow ' + ov + 'px');
await mp.screenshot({ path: 'shots/bd6-narrow.png' });

check('no console/page errors', errors.length === 0, errors.slice(0,3).join(' // '));

await browser.close(); server.close();
const failed = results.filter(r => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
