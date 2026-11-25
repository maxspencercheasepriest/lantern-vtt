import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { applyPurchase } from '../../../shared/purchase.js';

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
// inputs get their text as a property, not an attribute, so find the row by value
const shardIdx = await m.$$eval('#g-rows tr', rows => rows.findIndex(r => [...r.querySelectorAll('input')].some(i => i.value === 'Unlabelled Shard')));
const shardRow = m.locator('#g-rows tr').nth(shardIdx);
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

// ── shopping against a character sheet ──
// Inside Lantern the page is handed a window.lantern by the server (props.js). Here
// that's stubbed with a fake Cyberpunk sheet and the real rules from shared/purchase.js,
// so the whole path is exercised without a campaign. Each case gets its own context:
// the market saves to localStorage, and two cases sharing one would inherit each
// other's balance and GM settings.
const cprSheet = (name, eddies) => ({
  system: 'cpr',
  data: {
    name, eddies,
    weapons: [{ name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 }],
    cyberware: '', gear: '', notes: '',
  },
});
async function shopper(sheet, extraItems) {
  const c = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await c.newPage(); watch(page);
  await page.exposeFunction('__apply', (data, items, system) => applyPurchase(data, items, system));
  if (extraItems) await page.addInitScript(([key, items]) => {
    // a GM who has added their own stock, saved from an earlier session
    try {
      const d = JSON.parse(localStorage.getItem(key) || '{}');
      d.items = (d.items || []).concat(items);
      localStorage.setItem(key, JSON.stringify(d));
    } catch (e) { /* no storage */ }
  }, ['nightmarket.v1', extraItems]);
  await page.addInitScript(([s]) => {
    window.__bought = [];
    let sheet = s ? JSON.parse(JSON.stringify(s)) : null;
    window.lantern = {
      version: 1,
      me: { name: 'Rook', isGM: false },
      sheet: async () => (sheet ? { system: sheet.system, data: sheet.data } : null),
      buy: async (items) => {
        window.__bought.push(items);
        if (!sheet) return { ok: false, reason: 'nosheet' };
        const r = await window.__apply(sheet.data, items, sheet.system);
        sheet.data = r.data;
        return { ok: true, name: sheet.data.name, money: sheet.data.eddies, currency: r.currency, short: r.short };
      },
      sheetNow: () => sheet,
    };
  }, [sheet]);
  await page.goto(BASE + 'market.html');
  await page.waitForSelector('.item');
  await page.waitForTimeout(350);                 // let it ask who's shopping
  return page;
}
const pick = async (page, term) => {
  await page.fill('#q', term);
  await page.waitForTimeout(150);
  await page.click('.item .add');
};

{
  const sh = await shopper(cprSheet('Rook', 1000));
  check('the header names the shopper', (await sh.textContent('#t-who')).toUpperCase() === 'ROOK');
  check('and shows their own eddies', (await sh.textContent('#t-bal')) === '1,000');

  await pick(sh, 'heavy pistol');
  await pick(sh, 'kerenzikov');
  await pick(sh, 'anti-smog');
  check('the order counts against their money', (await sh.textContent('#totals')).includes('Rook after'),
    (await sh.textContent('#totals')).replace(/\n/g, ' / '));

  await sh.click('#place');
  await sh.waitForSelector('#receipt:not([hidden])');
  await sh.waitForTimeout(250);

  const items = (await sh.evaluate(() => window.__bought))[0] || [];
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  check('the order is sent to the table', items.length === 3, items.length + ' items');
  check('a gun goes as a weapon, with its numbers',
    byName['Heavy Pistol']?.kind === 'weapon' && byName['Heavy Pistol'].skill === 'Handgun'
      && byName['Heavy Pistol'].damage === '3d6' && byName['Heavy Pistol'].rof === 2);
  check('chrome goes as cyberware', byName['Kerenzikov']?.kind === 'cyberware');
  check('everything else goes as gear', byName['Anti-Smog Mask']?.kind === 'gear');

  const d = (await sh.evaluate(() => window.lantern.sheetNow())).data;
  check('the sheet has the new gun', d.weapons.filter((w) => w.name === 'Heavy Pistol').length === 2);
  check('the chrome is under cyberware', d.cyberware.includes('Kerenzikov'));
  check('the mask is under gear', d.gear.includes('Anti-Smog Mask'));
  check('and the eddies came off', d.eddies === 1000 - 140 - 600 - 25, String(d.eddies));
  check('the receipt says where it went', (await sh.textContent('#r-note')).includes('Added to Rook'));
  check('and what they have left', (await sh.textContent('#r-bal')) === '235eb', await sh.textContent('#r-bal'));
  check('the header follows', (await sh.textContent('#t-bal')) === '235');
  await sh.screenshot({ path: 'shots/m6-on-the-sheet.png' });
  await sh.context().close();
}

{
  const sh = await shopper(null);
  check('with no character it shows the crew balance', (await sh.textContent('#t-who')).toLowerCase() === 'balance');
  await pick(sh, 'road flare');
  await sh.click('#place');
  await sh.waitForSelector('#receipt:not([hidden])');
  await sh.waitForTimeout(200);
  check('the order still goes through', (await sh.textContent('#r-tot')) === '15eb');
  check('and comes off the crew balance', (await sh.textContent('#r-bal')) === '1,485eb', await sh.textContent('#r-bal'));
  await sh.context().close();
}

{
  const sh = await shopper(cprSheet('Juno', 500));
  await sh.click('#open-gm');
  await sh.uncheck('#g-usesheet');
  await sh.click('#gm-close');
  await sh.waitForTimeout(150);
  check('the GM can put it back on one crew balance',
    (await sh.textContent('#t-who')).toLowerCase() === 'balance' && (await sh.textContent('#t-bal')) === '1,500');
  await pick(sh, 'combat knife');
  await sh.click('#place');
  await sh.waitForSelector('#receipt:not([hidden])');
  await sh.waitForTimeout(200);
  check('nothing is written to a sheet', (await sh.evaluate(() => window.__bought)).length === 0);
  check('the crew balance pays', (await sh.textContent('#r-bal')) === '1,450eb');
  check('and the sheet is untouched', (await sh.evaluate(() => window.lantern.sheetNow())).data.eddies === 500);
  await sh.context().close();
}

{
  // The GM's own guns aren't in the prop's stats table; they must still become rows.
  const sh = await shopper(cprSheet('Tam', 2000), [
    { id: 'gm1', name: 'Militech Crusher', cat: 'Weapons', price: 500, stock: 1, max: 1,
      desc: 'Shoulder cannon, 5d6 and a shoulder to match. Ground serials.', hot: true, gmonly: false },
    { id: 'gm2', name: 'Smoke Grenade', cat: 'Weapons', price: 60, stock: 4, max: 4,
      desc: 'Covers a doorway. No damage.', hot: false, gmonly: false },
  ]);
  await pick(sh, 'crusher');
  await pick(sh, 'smoke grenade');
  await sh.click('#place');
  await sh.waitForSelector('#receipt:not([hidden])');
  await sh.waitForTimeout(250);
  const got = Object.fromEntries(((await sh.evaluate(() => window.__bought))[0] || []).map((i) => [i.name, i]));
  check("a GM's own gun is still a weapon", got['Militech Crusher']?.kind === 'weapon');
  check('with the damage read off its blurb', got['Militech Crusher']?.damage === '5d6', got['Militech Crusher']?.damage);
  check('and the skill guessed from its name', got['Militech Crusher']?.skill === 'Shoulder Arms');
  check('but smoke is just kit', got['Smoke Grenade']?.kind === 'gear');
  const d = (await sh.evaluate(() => window.lantern.sheetNow())).data;
  check('the gun lands on the sheet', d.weapons.some((w) => w.name === 'Militech Crusher'));
  check('and the smoke in the gear box', d.gear.includes('Smoke Grenade'));
  await sh.context().close();
}

// ── through the deck ──
const dk = await ctx.newPage(); watch(dk);
await dk.goto(BASE);
await dk.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
await dk.fill('#cmd', 'ls ~/apps'); await dk.press('#cmd', 'Enter');
await dk.waitForTimeout(150);
check('market is in ~/apps', (await dk.textContent('#out')).includes('MARKET.HTML'));
await dk.fill('#cmd', 'mount'); await dk.press('#cmd', 'Enter');
await dk.waitForTimeout(150);
check('mount lists three props now', (await dk.textContent('#out')).includes('market.html'));
await dk.fill('#cmd', 'open ~/apps/MARKET.HTML'); await dk.press('#cmd', 'Enter');
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
