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
const ctx = await browser.newContext({ viewport: { width: 1380, height: 950 } });
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type()==='error' && !/404/.test(m.text())) errors.push(m.text()); }); };
const num = s => Number(String(s).replace(/,/g,''));

/* ───────── CONTACTS ───────── */
const c = await ctx.newPage(); watch(c);
await c.goto(BASE + 'contacts.html');
await c.waitForSelector('.p');
check('rolodex shows only people the crew has met', (await c.$$('.p')).length === 6, (await c.$$('.p')).length + ' shown');
check('unmet people are hidden', !(await c.textContent('#list')).includes('Delphine'));
check('GM notes hidden from players', (await c.$$('.gmnote')).length === 0);
check('standing renders as a bar with a label', (await c.textContent('.replabel')).length > 0);
await c.screenshot({ path: 'shots/c1-contacts.png' });

await c.evaluate(() => document.activeElement.blur());
await c.keyboard.type('gmgm');
await c.waitForSelector('#gm:not([hidden])');
check('GM panel opens', true);
await c.click('#gm-close');
await c.waitForTimeout(150);
check('GM view reveals notes', (await c.$$('.gmnote')).length > 3);
const kestrel = c.locator('.p', { hasText: 'Nadia Kestrel' });
check('standing adjusters appear in GM view', await kestrel.locator('.adj button').first().isVisible());
await c.screenshot({ path: 'shots/c2-contacts-gm.png' });

/* ───────── GIG GATING ───────── */
const g = await ctx.newPage(); watch(g);
await g.goto(BASE + 'gigs.html');
await g.waitForSelector('.gig');
const kestrelGig = g.locator('.gig', { hasText: 'Long haul' });
check('a gated gig shows on the board', await kestrelGig.count() === 1);
check('it is locked at low standing', (await kestrelGig.getAttribute('class')).includes('locked'));
check('the lock explains why', (await kestrelGig.locator('.lockmsg').textContent()).includes("doesn't trust you"));
check('locked gigs cannot be taken', await kestrelGig.locator('button:has-text("Take it")').count() === 0);
await g.screenshot({ path: 'shots/c3-gig-locked.png' });

// raise Kestrel to 5 in the contacts app, then re-check the board
for (let i = 0; i < 3; i++) { await kestrel.locator('.adj button').nth(1).click(); await c.waitForTimeout(80); }
const repNow = await c.evaluate(() => JSON.parse(localStorage.getItem('contacts.v1')).people.find(p => p.name.includes('Kestrel')).rep);
check('standing raised in the contacts app', repNow === 5, 'rep ' + repNow);
await g.reload();
await g.waitForSelector('.gig');
const kestrelGig2 = g.locator('.gig', { hasText: 'Long haul' });
check('the gig unlocks once standing is high enough', !(await kestrelGig2.getAttribute('class')).includes('locked'));
check('and can now be taken', await kestrelGig2.locator('button:has-text("Take it")').count() === 1);

// completing it raises standing again
await kestrelGig2.locator('button:has-text("Take it")').click();
await g.waitForTimeout(150);
await g.click('.filters button:has-text("Taken")');
await g.waitForTimeout(150);
await g.locator('.gig button:has-text("Paid")').click();
await g.waitForTimeout(400);
check('completing a gig shows a standing toast', (await g.textContent('#toast')).includes('Nadia Kestrel'));
const repAfter = await g.evaluate(() => JSON.parse(localStorage.getItem('contacts.v1')).people.find(p => p.name.includes('Kestrel')).rep);
check('completing a gig raises that fixer standing', repAfter === 6, 'rep ' + repAfter);
await g.screenshot({ path: 'shots/c4-gig-unlocked.png' });

// burning a contact closes their work
await c.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('contacts.v1'));
  s.people.find(p => p.name.includes('Vesna')).burned = true;
  localStorage.setItem('contacts.v1', JSON.stringify(s));
});
await g.reload(); await g.waitForSelector('.gig');
const vesnaGig = g.locator('.gig', { hasText: 'What Militech buried' });
check('burning a contact locks their gated work', (await vesnaGig.locator('.lockmsg').textContent()).includes('finished with you'));

/* ───────── RIPPERDOC ───────── */
const r = await ctx.newPage(); watch(r);
await r.goto(BASE + 'ripper.html');
await r.waitForSelector('.item');
check('chrome catalogue renders', (await r.$$('.item')).length > 30, (await r.$$('.item')).length + ' items');
check('two placeholder characters present', (await r.$$('.ch')).length === 2);
check('fitting is disabled until a character is picked', await r.isDisabled('.item .fit'));
await r.screenshot({ path: 'shots/c5-ripper.png' });

await r.click('.ch >> nth=0');
await r.waitForTimeout(150);
check('picking a character enables fitting', !(await r.isDisabled('.item .fit')));
check('header shows who is being fitted', (await r.textContent('#t-who')).includes('Character 1'));

const humBefore = await r.evaluate(() => JSON.parse(localStorage.getItem('ripperdoc.v1')).crew[0].hum);
const balBefore = num(await r.textContent('#t-bal'));
const linkRow = r.locator('.item', { hasText: 'Neural Link' });
await linkRow.locator('.fit').click();
await r.waitForSelector('#op:not([hidden])');
check('surgery panel itemises cost, fee and humanity', (await r.textContent('#op-lines')).includes('surgery'));
await r.click('#op-acts button:has-text("Roll and install")');
await r.waitForTimeout(300);
check('the roll is shown', (await r.textContent('#op-rollbox')).includes('humanity'));
check('EMP is recalculated on the confirm button', (await r.textContent('#op-acts')).includes('EMP now'));
await r.screenshot({ path: 'shots/c6-surgery.png' });
await r.click('#op-acts button');
await r.waitForTimeout(200);

const humAfter = await r.evaluate(() => JSON.parse(localStorage.getItem('ripperdoc.v1')).crew[0].hum);
check('humanity is deducted', humAfter < humBefore, humBefore + ' → ' + humAfter);
check('eddies deducted with the surgery fee', num(await r.textContent('#t-bal')) === balBefore - 600, 'was ' + balBefore);
check('installed chrome is listed on the character', (await r.textContent('.ch')).includes('Neural Link'));

// drive humanity down to trigger the warnings
await r.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('ripperdoc.v1'));
  s.crew[0].hum = 18; localStorage.setItem('ripperdoc.v1', JSON.stringify(s));
});
await r.reload(); await r.waitForSelector('.ch');
check('low humanity warns about the crew member', (await r.textContent('.ch.warn')).includes('hard to be around'));
await r.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('ripperdoc.v1'));
  s.crew[0].hum = 6; localStorage.setItem('ripperdoc.v1', JSON.stringify(s));
});
await r.reload(); await r.waitForSelector('.ch');
check('very low humanity flags cyberpsychosis', (await r.textContent('.ch.danger')).includes('Cyberpsychosis'));
check('EMP drops with humanity', (await r.textContent('.ch .emp')).includes('0'));
await r.screenshot({ path: 'shots/c7-ripper-danger.png' });

// removing chrome refunds humanity
const humLow = await r.evaluate(() => JSON.parse(localStorage.getItem('ripperdoc.v1')).crew[0].hum);
await r.click('.ch .chip button');
await r.waitForTimeout(200);
check('removing an implant gives the humanity back',
  (await r.evaluate(() => JSON.parse(localStorage.getItem('ripperdoc.v1')).crew[0].hum)) > humLow);

// shared purse with the market
const m = await ctx.newPage(); watch(m);
await m.goto(BASE + 'market.html');
await m.waitForSelector('.item');
check('ripperdoc spending reaches the market purse',
  num(await m.textContent('#t-bal')) === num(await r.textContent('#t-bal')),
  num(await r.textContent('#t-bal')) + ' / ' + num(await m.textContent('#t-bal')));

/* ───────── DECK ───────── */
const dk = await ctx.newPage(); watch(dk);
await dk.goto(BASE);
await dk.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
await dk.fill('#cmd', 'tree /'); await dk.press('#cmd', 'Enter');
await dk.waitForTimeout(200);
const tree = await dk.textContent('#out');
check('both new props mounted on the deck', tree.includes('CONTACTS.HTML') && tree.includes('RIPPER.HTML'));
await dk.fill('#cmd', 'open /crew/CONTACTS.HTML'); await dk.press('#cmd', 'Enter');
await dk.waitForSelector('#appwrap:not([hidden])');
await dk.frameLocator('#frame').locator('.p').first().waitFor({ timeout: 20000 });
check('contacts launches inside the deck', true);
await dk.click('#fb-eject'); await dk.waitForTimeout(150);
await dk.fill('#cmd', 'open /net/RIPPER.HTML'); await dk.press('#cmd', 'Enter');
await dk.waitForSelector('#appwrap:not([hidden])');
await dk.frameLocator('#frame').locator('.item').first().waitFor({ timeout: 20000 });
check('ripperdoc launches inside the deck', true);
await dk.screenshot({ path: 'shots/c8-in-deck.png' });

/* ───────── narrow ───────── */
const mob = await browser.newContext({ viewport: { width: 400, height: 880 } });
for (const [name, file] of [['contacts','contacts.html'], ['ripperdoc','ripper.html']]) {
  const mp = await mob.newPage(); watch(mp);
  await mp.goto(BASE + file);
  await mp.waitForSelector(file === 'contacts.html' ? '.p' : '.item');
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at 400px — ' + name, ov <= 1, 'overflow ' + ov + 'px');
}

check('no console/page errors', errors.length === 0, errors.slice(0,3).join(' // '));

await browser.close(); server.close();
const failed = results.filter(x => !x.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
