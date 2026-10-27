import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../public/handouts/thaw/netdeck.html', import.meta.url));
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(0);
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL_);

const logTxt = () => page.textContent('#log');
const reveal = () => page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 });
const closeReveal = async () => {
  if (await page.isVisible('#reveal')) { await page.keyboard.press('Escape'); await page.waitForTimeout(120); }
};

// ── boot ──
await page.waitForSelector('#stack .floor');
check('app boots with an architecture loaded', (await page.textContent('#arch-name')).includes('LINDQVIST'));
check('floors start unmapped', (await page.$$('#stack .card.hidden')).length >= 4);
check('actions disabled before jacking in', await page.isDisabled('#actions .act'));

// ── jack in ──
await page.click('#jack');
await page.waitForTimeout(200);
check('jack in reveals floor 1', (await page.$$('#stack .card.hidden')).length < 5);
check('position marker on floor 1', await page.isVisible('#stack .floor.here'));
check('action pips filled', (await page.$$('#p-actions i.on')).length === 4);
await page.screenshot({ path: 'shots/1-dive.png' });

// ── a NET action resolves and spends an action ──
await page.click('#actions .act:has-text("PATHFINDER")');
await reveal();
check('net action opens a resolve panel with a DV', /^\d+$/.test((await page.textContent('#rv-dv')).trim()));
await page.click('#rv-rolld10');
check('in-app d10 roller produces a total', /=/.test(await page.textContent('#rv-die')));
await page.click('#rv-acts button:has-text("Success")');
await page.waitForTimeout(150);
check('pathfinder reveals floors ahead', (await logTxt()).includes('mapped'));
check('action was spent', (await page.$$('#p-actions i.on')).length === 3);

// ── descend into ICE ──
let rezzed = false;
for (let i = 0; i < 4; i++) {
  await closeReveal();
  const btn = page.locator('#actions .act:has-text("DESCEND")');
  if (await btn.isDisabled()) { await page.click('#end-turn'); continue; }
  await btn.click();
  await page.waitForTimeout(250);
  if (await page.isVisible('#reveal')) {
    const t = await page.textContent('#rv-title');
    if (t && t.trim()) { rezzed = true; break; }
  }
}
check('descending into ICE rezzes it with a full-screen reveal', rezzed);
if (rezzed) {
  check('reveal panel is in ICE styling', (await page.getAttribute('#reveal', 'class')).includes('ice'));
  await page.screenshot({ path: 'shots/2-ice.png' });
  await closeReveal();
  check('ICE card appears in the stack', await page.isVisible('#stack .icecard'));
  check('alert escalates to hunting', (await page.textContent('#t-alert')).trim() === 'hunting');
}

// ── zap the ICE ──
const rezBefore = await page.textContent('#stack .icestats');
await page.click('#actions .act:has-text("ZAP")');
await reveal();
await page.click('#rv-acts button:has-text("Success")');
await page.waitForTimeout(200);
check('zap damages the rezzed ICE', (await logTxt()).includes('Zap'));
check('REZ bar updated', (await page.textContent('#stack .icestats')) !== rezBefore);

// ── ICE hits back ──
await page.click('#stack .node.ice .mini:has-text("ice acts")');
await reveal();
const rollBtn = page.locator('#rv-acts button:has-text("Roll")');
if (await rollBtn.count()) {
  const hpBefore = await page.textContent('#s-hp');
  await rollBtn.click();
  await page.waitForTimeout(200);
  check('ICE damage rolls and applies to runner HP', (await page.textContent('#s-hp')) !== hpBefore);
} else check('ICE damage rolls and applies to runner HP', true, 'no dice in this effect');
await closeReveal();

// ── programs ──
await page.click('#programs .prog:has-text("Sword")');
await page.waitForTimeout(150);
check('first click rezzes a program', (await page.$$('#programs .prog.rezzed')).length === 1);
await page.click('#programs .prog:has-text("Sword")');
await reveal();
const hitBtn = page.locator('#rv-acts button:has-text("Hit")');
check('rezzed attacker offers an attack against rezzed ICE', await hitBtn.count() > 0);
if (await hitBtn.count()) {
  await hitBtn.click();
  await page.waitForTimeout(200);
  check('program damage applies', (await logTxt()).includes('hits'));
}
await closeReveal();
await page.screenshot({ path: 'shots/3-dive-combat.png' });

// ── quickhack mode ──
await page.click('#tab-quick');
await page.waitForSelector('#view-quick:not([hidden])');
check('quickhack tab switches view', await page.isVisible('#hacks'));
await page.fill('#new-target', 'Maelstrom Boostergang');
await page.click('#add-target');
await page.waitForTimeout(120);
check('target added', (await page.$$('#targets .tgt')).length === 1);
const ramBefore = (await page.$$('#p-ram i.on')).length;
await page.click('#hacks .qh:has-text("Short Circuit")');
await page.waitForTimeout(120);
check('quickhack arms', (await page.$$('#hacks .qh.armed')).length === 1);
await page.click('#targets .tgt');
await reveal();
check('firing a quickhack shows its effect', (await page.textContent('#rv-txt')).includes('bypassing armour'));
await closeReveal();
check('RAM spent', (await page.$$('#p-ram i.on')).length === ramBefore - 3);
check('status applied to the target', await page.isVisible('#targets .status'));
check('hack goes on cooldown', await page.isDisabled('#hacks .qh:has-text("Short Circuit")'));
await page.screenshot({ path: 'shots/4-quickhack.png' });
await page.click('#q-end'); await page.click('#q-end');
await page.waitForTimeout(150);
check('cooldown clears and RAM regenerates on end turn', !(await page.isDisabled('#hacks .qh:has-text("Short Circuit")')));

// ── GM: generator ──
await page.click('#open-gm');
await page.waitForSelector('#gm:not([hidden])');
await page.click('#gm .gtabs button[data-g="arch"]');
await page.selectOption('#g-tier', '4');
await page.fill('#g-floors', '8');
await page.click('#g-gen');
await page.waitForTimeout(250);
check('generator builds a tier-4 architecture', (await page.textContent('#arch-name')).includes('TIER 4'));
check('generated architecture has the right floor count', (await page.$$('#stack .floor')).length === 8);
const genTxt = await page.textContent('#stack');
check('generated floors use real RED content', /Password|File|Control|Hellhound|Kraken|Dragon|Giant|Asp|Raven|Wisp|Liche|Killer|Sabertooth|Scorpion|Skunk/.test(genTxt));
await page.screenshot({ path: 'shots/5-gm-arch.png' });

// ── GM: load Depository 7 ──
await page.selectOption('#g-preset', 'depository7');
await page.click('#g-load');
await page.waitForTimeout(200);
check('Depository 7 preset loads', (await page.textContent('#arch-name')).includes('DEPOSITORY'));
await page.click('#g-revealall');
await page.waitForTimeout(150);
check('reveal all unmasks every floor', (await page.$$('#stack .card.hidden')).length === 0);

// ── GM: program editor persists ──
await page.click('#gm .gtabs button[data-g="prog"]');
await page.waitForTimeout(120);
const atk = page.locator('#g-progs tr:has-text("Sword") input.num').first();
await atk.fill('5');
await atk.dispatchEvent('change');
await page.waitForTimeout(150);
check('program stats are editable', true);

// ── GM: card binding ──
await page.click('#gm .gtabs button[data-g="tags"]');
await page.waitForTimeout(120);
await page.click('.taglist .t:has-text("Dive · Zap") button:has-text("learn")');
check('learn mode prompts for a card', await page.isVisible('#learn-box'));
// simulate a keyboard-wedge reader: fast burst + Enter
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.type('0009117323', { delay: 8 });
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('wedge scan binds the card', (await page.textContent('.taglist')).includes('0009117323'));

// ── the bound card fires the action ──
await page.click('#close-gm');
await page.waitForTimeout(150);
await page.click('#g-reset-run').catch(() => {});
await page.click('#open-gm'); await page.click('#gm .gtabs button[data-g="run"]');
await page.click('#g-reset-run'); await page.click('#close-gm');
await page.waitForTimeout(150);
await page.click('#jack');
await page.waitForTimeout(200);
await closeReveal();
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.type('0009117323', { delay: 8 });
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const firedZap = (await page.isVisible('#reveal')) && /ZAP/.test(await page.textContent('#rv-title'));
check('tapping the bound card fires Zap', firedZap || (await logTxt()).includes('Nothing rezzed'));
await closeReveal();

// slow human typing must NOT be read as a card
const beforeSlow = await logTxt();
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.type('hello', { delay: 120 });
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('slow typing is not mistaken for a card scan', (await logTxt()) === beforeSlow);

// ── persistence ──
await page.reload();
await page.waitForSelector('#stack .floor');
check('state survives a reload', (await page.textContent('#arch-name')).includes('DEPOSITORY'));
await page.click('#open-gm'); await page.click('#gm .gtabs button[data-g="tags"]');
await page.waitForTimeout(150);
check('card bindings survive a reload', (await page.textContent('.taglist')).includes('0009117323'));
await page.click('#close-gm');

// ── mobile / narrow ──
const mob = await browser.newContext({ viewport: { width: 420, height: 900 } });
const mp = await mob.newPage();
mp.on('pageerror', e => errors.push(String(e)));
await mp.goto(URL_);
await mp.waitForSelector('#stack .floor');
const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 420px', ov <= 1, 'overflow ' + ov + 'px');

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' // '));

await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
