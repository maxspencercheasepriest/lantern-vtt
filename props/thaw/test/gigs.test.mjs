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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type()==='error' && !/404/.test(m.text())) errors.push(m.text()); }); };

const g = await ctx.newPage(); watch(g);
await g.goto(BASE + 'gigs.html');
await g.waitForSelector('.gig');

check('board renders open gigs', (await g.$$('.gig')).length === 9, (await g.$$('.gig')).length + ' shown');
check('GM-only gigs are hidden', !(await g.textContent('#list')).includes('Depository 7'));
check('briefings are hidden from players', (await g.$$('.gmnote')).length === 0);
check('payout and heat shown', (await g.textContent('.gig .pay')).includes('eb') && (await g.$$('.gig .heat i.on')).length > 0);
await g.screenshot({ path: 'shots/g1-board.png' });

// take a gig
const first = g.locator('.gig', { hasText: 'Cold storage salvage' });
await first.locator('button:has-text("Take it")').click();
await g.waitForTimeout(200);
await g.click('.filters button:has-text("Taken")');
await g.waitForTimeout(150);
check('taking a gig moves it to Taken', (await g.textContent('#list')).includes('Cold storage salvage'));
check('taken gig is styled differently', (await g.$$('.gig.accepted')).length === 1);

// complete it and check payment
const balBefore = Number((await g.textContent('#t-bal')).replace(/,/g,''));
await g.locator('.gig button:has-text("Paid")').click();
await g.waitForTimeout(200);
const balAfter = Number((await g.textContent('#t-bal')).replace(/,/g,''));
check('completing a gig pays the crew', balAfter === balBefore + 1200, balBefore + ' → ' + balAfter);
await g.click('.filters button:has-text("Completed")');
await g.waitForTimeout(150);
check('completed gigs move to Completed', (await g.$$('.gig.done')).length === 1);

// reopen reverses payment
await g.locator('.gig button:has-text("Reopen")').click();
await g.waitForTimeout(200);
check('reopening reverses the payment', Number((await g.textContent('#t-bal')).replace(/,/g,'')) === balBefore);

// GM view
await g.evaluate(() => document.activeElement.blur());
await g.keyboard.type('gmgm');
await g.waitForSelector('#gm:not([hidden])');
await g.check('#g-gmview');
await g.waitForTimeout(150);
await g.click('#gm-close');
await g.click('.filters button:has-text("All")');
await g.waitForTimeout(200);
check('GM view reveals briefings', (await g.$$('.gmnote')).length > 5);
check('GM view reveals hidden gigs', (await g.textContent('#list')).includes('Depository 7'));
await g.screenshot({ path: 'shots/g2-gmview.png' });

// post a gig
await g.evaluate(() => document.activeElement.blur());
await g.keyboard.type('gmgm');
await g.waitForSelector('#gm:not([hidden])');
await g.fill('#a-ttl', 'Burn a screamsheet office');
await g.fill('#a-fix', 'Anonymous');
await g.fill('#a-dis', 'Heywood');
await g.fill('#a-pay', '900');
await g.fill('#a-brief', 'A certain outlet needs to stop printing. No casualties required.');
await g.fill('#a-needs', 'muscle, transport');
await g.fill('#a-note', 'This is Militech leaning on Dead Channel. Taking it burns Vesna as a contact.');
await g.click('#a-add');
await g.waitForTimeout(200);
await g.click('#gm-close');
await g.waitForTimeout(150);
check('a posted gig appears on the board', (await g.textContent('#list')).includes('Burn a screamsheet office'));
check('its requirements render as tags', (await g.textContent('#list')).includes('transport'));

// persistence
await g.reload();
await g.waitForSelector('.gig');
check('board state survives a reload', (await g.textContent('#list')).includes('Burn a screamsheet'));

// ── shared balance with the market ──
const m = await ctx.newPage(); watch(m);
await m.goto(BASE + 'market.html');
await m.waitForSelector('.item');
const mBal = Number((await m.textContent('#t-bal')).replace(/,/g,''));
const gBal = Number((await g.textContent('#t-bal')).replace(/,/g,''));
check('market reads the same crew balance as the board', mBal === gBal, gBal + ' / ' + mBal);

// earn on the board, then check the market sees it
await g.click('.filters button:has-text("Open")');
await g.waitForTimeout(150);
const gig2 = g.locator('.gig', { hasText: 'Convoy escort' });
await gig2.locator('button:has-text("Take it")').click();
await g.waitForTimeout(150);
await g.click('.filters button:has-text("Taken")');
await g.waitForTimeout(150);
await g.locator('.gig button:has-text("Paid")').click();
await g.waitForTimeout(200);
await m.reload();
await m.waitForSelector('.item');
check('money earned on the board reaches the market', Number((await m.textContent('#t-bal')).replace(/,/g,'')) === gBal + 600);

// ── through the deck ──
const dk = await ctx.newPage(); watch(dk);
await dk.goto(BASE);
await dk.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
await dk.fill('#cmd', 'ls /net'); await dk.press('#cmd', 'Enter');
await dk.waitForTimeout(150);
check('gig board is mounted on the deck', (await dk.textContent('#out')).includes('GIGS.HTML'));
await dk.fill('#cmd', 'open /net/GIGS.HTML'); await dk.press('#cmd', 'Enter');
await dk.waitForSelector('#appwrap:not([hidden])');
await dk.frameLocator('#frame').locator('.gig').first().waitFor({ timeout: 20000 });
check('gig board launches inside the deck', true);
await dk.screenshot({ path: 'shots/g3-in-deck.png' });

// ── narrow ──
const mob = await browser.newContext({ viewport: { width: 400, height: 880 } });
const mp = await mob.newPage(); watch(mp);
await mp.goto(BASE + 'gigs.html');
await mp.waitForSelector('.gig');
const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 400px', ov <= 1, 'overflow ' + ov + 'px');

check('no console/page errors', errors.length === 0, errors.slice(0,3).join(' // '));

await browser.close(); server.close();
const failed = results.filter(r => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
