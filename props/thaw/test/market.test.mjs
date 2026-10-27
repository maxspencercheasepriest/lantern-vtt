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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type()==='error' && !/404/.test(m.text())) errors.push(m.text()); }); };

// ── market on its own ──
const m = await ctx.newPage(); watch(m);
await m.goto(BASE + 'market.html');
await m.waitForSelector('.item');
const count = await m.$$eval('.item', n => n.length);
check('catalogue renders', count > 60, count + ' listings');
check('GM-only plot stock is hidden from players', !(await m.textContent('#list')).includes('Unlabelled Shard'));
check('opening balance shown', (await m.textContent('#t-bal')).replace(/,/g,'') === '1500');
await m.screenshot({ path: 'shots/m1-market.png' });

// filter + search
await m.click('.filters button:has-text("Cyberware")');
await m.waitForTimeout(150);
const cats = await m.$$eval('.item .cat', n => [...new Set(n.map(x => x.textContent))]);
check('category filter narrows the list', cats.length === 1 && cats[0] === 'Cyberware', cats.join('/'));
await m.click('.filters button:has-text("All")');
await m.fill('#q', 'kraken');
await m.waitForTimeout(200);
check('search finds a listing', (await m.$$('.item')).length === 1);
await m.click('#clear-q');
await m.waitForTimeout(150);

// hot flagging
check('hot items are flagged', (await m.$$('.item.hot')).length > 10);

// cart maths
await m.click('.item:has-text("Medium Pistol") .add');
await m.click('.item:has-text("Medium Pistol") .add');
await m.click('.item:has-text("Kevlar Vest") .add');
await m.waitForTimeout(150);
check('cart counts items', (await m.textContent('#t-cart')) === '3');
check('cart total is right', (await m.textContent('#totals')).includes('150eb'), '60×2 + 30');
check('balance-after shown', (await m.textContent('#totals')).includes('1,350eb'));

// stock limit
const left = await m.textContent('.item:has-text("Medium Pistol") .stock');
check('stock decreases as you add to cart', left.includes('2 left'), left);

// overspend guard
await m.fill('#q', 'metalgear');
await m.waitForTimeout(200);
await m.click('.item .add');
await m.waitForTimeout(150);
check('overspending disables the order button', await m.isDisabled('#place'));
check('button explains why', (await m.textContent('#place')).includes('Not enough'));
await m.screenshot({ path: 'shots/m2-cart.png' });
await m.click('.item .add + *').catch(()=>{});
// remove the metalgear line
await m.click('#cart .line:has-text("Metalgear") .qty button');
await m.waitForTimeout(150);
check('removing a line re-enables ordering', !(await m.isDisabled('#place')));

// place the order
await m.click('#clear-q');
await m.click('#place');
await m.waitForSelector('#receipt:not([hidden])');
check('receipt lists what was bought', (await m.textContent('#r-rows')).includes('Medium Pistol'));
check('receipt shows the new balance', (await m.textContent('#r-bal')).includes('1,350'));
await m.screenshot({ path: 'shots/m3-receipt.png' });
await m.click('#r-close');
await m.waitForTimeout(150);
check('balance is deducted', (await m.textContent('#t-bal')) === '1,350');
check('stock is consumed', (await m.textContent('.item:has-text("Medium Pistol") .stock')).includes('2 left'));
check('cart empties after ordering', (await m.textContent('#t-cart')) === '0');

// GM: reveal a plot item + restock
await m.keyboard.press('Escape');
await m.evaluate(() => document.activeElement.blur());
await m.keyboard.type('gmgm');
await m.waitForSelector('#gm:not([hidden])');
check('gmgm opens the GM panel', true);
const shardRow = m.locator('#g-rows tr', { has: m.locator('input[value="Unlabelled Shard"]') });
await shardRow.locator('td.chk input').nth(1).check();
await m.waitForTimeout(150);
await m.click('#g-restock');
await m.click('#gm-close');
await m.waitForTimeout(200);
check('revealed plot item appears in the listings', (await m.textContent('#list')).includes('Unlabelled Shard'));
check('restock refills stock', (await m.textContent('.item:has-text("Medium Pistol") .stock')).includes('4 left'));
await m.screenshot({ path: 'shots/m4-gm.png' });

// persistence
await m.reload();
await m.waitForSelector('.item');
check('balance and reveals survive a reload', (await m.textContent('#t-bal')) === '1,350' && (await m.textContent('#list')).includes('Unlabelled Shard'));

// ── through the deck ──
const dk = await ctx.newPage(); watch(dk);
await dk.goto(BASE);
await dk.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
await dk.fill('#cmd', 'ls /net'); await dk.press('#cmd', 'Enter');
await dk.waitForTimeout(150);
check('market is mounted under /net', (await dk.textContent('#out')).includes('MARKET.HTML'));
await dk.fill('#cmd', 'mount'); await dk.press('#cmd', 'Enter');
await dk.waitForTimeout(150);
check('mount lists three props now', (await dk.textContent('#out')).includes('market.html'));
await dk.fill('#cmd', 'open /net/MARKET.HTML'); await dk.press('#cmd', 'Enter');
await dk.waitForSelector('#appwrap:not([hidden])');
await dk.frameLocator('#frame').locator('.item').first().waitFor({ timeout: 20000 });
check('market launches inside the deck frame', true);
await dk.screenshot({ path: 'shots/m5-in-deck.png' });
await dk.click('#fb-eject');

// ── narrow ──
const mob = await browser.newContext({ viewport: { width: 400, height: 880 } });
const mp = await mob.newPage(); watch(mp);
await mp.goto(BASE + 'market.html');
await mp.waitForSelector('.item');
const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 400px', ov <= 1, 'overflow ' + ov + 'px');

check('no console/page errors', errors.length === 0, errors.slice(0,3).join(' // '));

await browser.close(); server.close();
const failed = results.filter(r => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
