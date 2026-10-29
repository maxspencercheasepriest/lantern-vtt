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
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
await page.goto(URL_);

const type = async t => { await page.fill('#cmd', t); await page.press('#cmd', 'Enter'); };
const outTxt = () => page.textContent('#out');
const psTxt = async () => (await page.textContent('#ps')).trim();
const waitPrompt = () => page.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });

// ── boot ──
await waitPrompt();
check('boots to a shell prompt', (await outTxt()).includes('DECK/OS 4.4.1'));
check('prompt shows user@host and path', await psTxt() === 'runner@deck:~$');
check('deck bar counts mounted props', (await page.textContent('#dk-mounts')).includes('7 mounted'));

// ── navigation ──
await type('ls');
check('ls lists the home folder', (await outTxt()).includes('README'));
await type('cd /mnt');
check('cd changes the prompt path', await psTxt() === 'runner@deck:/mnt$');
await type('ls');
check('mnt contains the clinic dump', (await outTxt()).includes('lc-nc1'));
await type('cd lc-nc1');
await type('ls');
check('dump folder lists PORTAL.HTML', (await outTxt()).includes('PORTAL.HTML'));
await type('cd ..');
check('cd .. goes up', await psTxt() === 'runner@deck:/mnt$');
await type('cd -');
check('cd - returns to the previous folder', await psTxt() === 'runner@deck:/mnt/lc-nc1$');
await type('cd ~');
check('cd ~ goes home', await psTxt() === 'runner@deck:~$');
await type('cd /nowhere');
check('bad path is refused', (await outTxt()).includes('no such file or directory'));
await page.screenshot({ path: 'shots/1-shell.png' });

// ── reading ──
await type('cat README');
check('cat prints a text doc', (await outTxt()).includes('what\'s here'));
await type('cat /mnt/lc-nc1/PORTAL.HTML');
check('cat refuses an app and suggests open', (await outTxt()).includes('binary — use'));
await type('tree /');
const tree = await outTxt();
check('tree draws the whole deck', tree.includes('└──') && tree.includes('NETDECK.HTML'));
await type('find cryonics');
check('find searches names and descriptions', (await outTxt()).includes('/mnt/lc-nc1'));
await type('mount');
check('mount lists launchable props with their paths', (await outTxt()).includes('lindqvist-portal.html'));
await type('sysinfo');
check('sysinfo renders', (await outTxt()).includes('DECK/OS 4.4.1'));
await page.screenshot({ path: 'shots/2-tree.png' });

// ── tab completion ──
await page.fill('#cmd', 'cd /mnt/lc');
await page.press('#cmd', 'Tab');
await page.waitForTimeout(100);
check('tab completes a folder name', (await page.inputValue('#cmd')) === 'cd /mnt/lc-nc1/');
await page.fill('#cmd', 'op');
await page.press('#cmd', 'Tab');
await page.waitForTimeout(100);
check('tab completes a command', (await page.inputValue('#cmd')) === 'open ');
await page.fill('#cmd', 'cd /');
await page.press('#cmd', 'Tab');
await page.waitForTimeout(100);
check('ambiguous tab lists the options', (await outTxt()).includes('home/'));
await page.fill('#cmd', '');

// ── history ──
await page.press('#cmd', 'ArrowUp');
check('up-arrow recalls the last command', (await page.inputValue('#cmd')).length > 0);
await page.fill('#cmd', '');

// ── launching the real portal ──
await type('open /mnt/lc-nc1/PORTAL.HTML');
await page.waitForSelector('#appwrap:not([hidden])');
check('open launches the prop full-screen', await page.isVisible('#frame'));
check('frame bar shows the path', (await page.textContent('#fb-path')).includes('/mnt/lc-nc1'));
const f = page.frameLocator('#frame');
await f.locator('#cmd').waitFor({ timeout: 20000 });
check('the real Lindqvist portal boots inside the frame', true);
// drive the portal from inside the frame to prove it fully works
await f.locator('#cmd').fill('connect');
await f.locator('#cmd').press('Enter');
await page.waitForTimeout(2600);
await f.locator('#cmd').fill('a.brandt');
await f.locator('#cmd').press('Enter');
await page.waitForTimeout(700);
await f.locator('#cmd').fill('Kaskelot71');
await f.locator('#cmd').press('Enter');
await page.waitForTimeout(1800);
const inner = await f.locator('#termlog').textContent();
check('crypto works inside the frame (login succeeds)', inner.includes('credentials accepted'));
await page.screenshot({ path: 'shots/3-launched.png' });

// ── eject ──
await page.click('#fb-eject');
await page.waitForSelector('#appwrap[hidden]', { state: 'attached' });
check('eject returns to the shell', (await outTxt()).includes('ejected'));

// ── the other prop ──
await type('open /opt/NETDECK.HTML');
await page.waitForSelector('#appwrap:not([hidden])');
await page.frameLocator('#frame').locator('#stack .floor').first().waitFor({ timeout: 20000 });
check('netdeck also launches in the frame', true);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape ejects', await page.isHidden('#appwrap'));

// ── bare path shortcut ──
await type('/opt/NETDECK.HTML');
await page.waitForSelector('#appwrap:not([hidden])');
check('typing a bare path launches it', true);
await page.click('#fb-eject');
await page.waitForTimeout(200);

// ── prop manager ──
await type('gmgm');
await page.waitForSelector('#gm:not([hidden])');
check('gmgm opens the prop manager', true);
await page.fill('#a-dir', '/mnt');
await page.fill('#a-name', 'DEAD-CHANNEL.HTML');
await page.selectOption('#a-type', 'app');
await page.fill('#a-src', 'netdeck.html');
await page.fill('#a-desc', 'Dead Channel — pirate news archive');
await page.click('#a-add');
await page.waitForTimeout(200);
check('a new prop can be added', (await page.textContent('#gm-list')).includes('DEAD-CHANNEL.HTML'));
check('deck bar count updates', (await page.textContent('#dk-mounts')).includes('8 mounted'));
// add a text doc too
await page.fill('#a-dir', '/home/runner/notes');
await page.fill('#a-name', 'delphine.txt');
await page.selectOption('#a-type', 'doc');
await page.waitForTimeout(100);
await page.fill('#a-body', 'She thinks it is Thursday.');
await page.fill('#a-desc', 'recovered fragment');
await page.click('#a-add');
await page.waitForTimeout(150);
await page.click('#gm-close');
await page.waitForTimeout(150);
await type('cat ~/notes/delphine.txt');
check('an added doc is readable with cat', (await outTxt()).includes('She thinks it is Thursday'));
await type('open /mnt/DEAD-CHANNEL.HTML');
await page.waitForSelector('#appwrap:not([hidden])');
check('an added prop launches', await page.isVisible('#frame'));
await page.click('#fb-eject');
await page.screenshot({ path: 'shots/4-gm.png' });

// ── identity ──
await type('gmgm');
await page.waitForSelector('#gm:not([hidden])');
await page.fill('#g-user', 'flick');
await page.dispatchEvent('#g-user', 'change');
await page.fill('#g-host', 'sprawl');
await page.dispatchEvent('#g-host', 'change');
await page.click('#gm-close');
await page.waitForTimeout(150);
check('user and hostname are editable', await psTxt() === 'flick@sprawl:~$', await psTxt());

// ── persistence ──
await page.reload();
await waitPrompt();
check('props survive a reload', await psTxt() === 'flick@sprawl:~$');
await type('mount');
check('added props survive a reload', (await outTxt()).includes('DEAD-CHANNEL.HTML'));

// ── narrow screen ──
const mob = await browser.newContext({ viewport: { width: 400, height: 860 } });
const mp = await mob.newPage();
mp.on('pageerror', e => errors.push(String(e)));
await mp.goto(URL_);
await mp.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
await mp.fill('#cmd', 'tree /'); await mp.press('#cmd', 'Enter');
await mp.waitForTimeout(200);
const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 400px', ov <= 1, 'overflow ' + ov + 'px');

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' // '));

await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
