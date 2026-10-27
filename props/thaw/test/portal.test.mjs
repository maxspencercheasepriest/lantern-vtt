import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../../../public/handouts/thaw/lindqvist-portal.html', import.meta.url));
const serve = body => createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}).listen(0);
const server = serve(html);
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, pass, extra = '') => {
  results.push({ name, pass, extra });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 940 } });
const errors = [];
const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };

const type = async (p, text) => { await p.fill('#cmd', text); await p.press('#cmd', 'Enter'); };
const logText = p => p.textContent('#termlog');
const waitPrompt = p => p.waitForSelector('#promptrow:not([hidden])', { timeout: 15000 });
const ps = async p => (await p.textContent('#ps')).trim();
const waitPs = (p, want) => p.waitForFunction(
  w => document.querySelector('#ps').textContent.trim() === w, want, { timeout: 20000 });
const waitLog = (p, s) => p.waitForFunction(
  t => document.querySelector('#termlog').textContent.includes(t), s, { timeout: 20000 });

// connect + sign in the normal way: login: then password:
const connect = async p => { await type(p, 'connect'); await waitPs(p, 'login:'); };
const signIn = async (p, user, pass) => {
  await type(p, user); await waitPs(p, 'password:');
  await type(p, pass);
};

const page = await ctx.newPage(); watch(page);
await page.goto(URL_);

// ── boot ──
await waitPrompt(page);
check('shell boots to a prompt', (await logText(page)).includes('NETLINK DECK SHELL'));
check('prompt reads deck $', await ps(page) === 'deck $');

await type(page, 'frobnicate');
check('unknown command nudges toward help', (await logText(page)).includes('unknown command'));
await type(page, 'help');
check('help lists commands', (await logText(page)).includes('connect <host>'));
await type(page, 'login');
check('login refused with no link', (await logText(page)).includes('no link. connect to a host first'));

// ── scan ──
await type(page, 'scan');
await waitLog(page, 'ROUTE OUT');
await waitPrompt(page);
const scanTxt = await logText(page);
check('scan finds the host', scanTxt.includes('2023.LC-NC1') && scanTxt.includes('LINDQVIST CRYONICS AS'));
check('scan shows live uptime', /UPTIME\s+[\d,]{4,} days/.test(scanTxt));
await type(page, 'connect arasaka.net');
check('unknown host refused', (await logText(page)).includes("no route to 'arasaka.net'"));

// ── connect drops straight to login: ──
await type(page, 'connect 2023.lc-nc1');
await waitLog(page, 'authentication required');
await waitPs(page, 'login:');
check('connect prints the host banner', (await logText(page)).includes('L I N D Q V I S T'));
check('connect goes straight to a login: prompt', await ps(page) === 'login:');
check('deck bar shows the link', await page.textContent('#dk-state') === 'linked');
await page.screenshot({ path: 'shots/2-connected.png' });

// ── username is checked on its own ──
await type(page, 'root');
await waitPs(page, 'login:');
check('wrong username says no such user', (await logText(page)).includes('no such user on this host'));
check('wrong username does NOT ask for a password', await ps(page) === 'login:');
await type(page, 'admin'); await waitPs(page, 'login:');
await type(page, 'p.vance'); await waitPs(page, 'login:');
check('hint appears after 3 wrong usernames', (await logText(page)).includes('initial.surname'));
check('wrong usernames do not count toward the trace', await page.isHidden('#trace'));

// escape hatch back to the shell
await type(page, 'exit');
await waitPs(page, 'lc-nc1 $');
check('exit at login: returns to the shell', (await logText(page)).includes('back to shell'));
await type(page, 'ls');
check('ls denied before auth', (await logText(page)).includes('access denied'));

// ── correct username, wrong password ──
await type(page, 'login');
await waitPs(page, 'login:');
await type(page, 'A.Brandt  ');
await waitPs(page, 'password:');
check('correct username advances to password:', await ps(page) === 'password:');
check('username check tolerates case and spaces', true);
await type(page, 'hunter2');
await waitPs(page, 'login:');
const t1 = await logText(page);
check('wrong password refused', t1.includes('credentials refused'));
check('password echo is masked', t1.includes('•••••••') && !t1.includes('hunter2'));
check('failure re-prompts from login:', await ps(page) === 'login:');
await page.screenshot({ path: 'shots/3-login.png' });

await signIn(page, 'a.brandt', 'wrongagain');
await waitPs(page, 'login:');
check('second failure logged as 2 of 3', (await logText(page)).includes('attempt 2 of 3'));

// ── third failure → trace ──
await signIn(page, 'a.brandt', 'nope');
await page.waitForSelector('#trace:not([hidden])', { timeout: 15000 });
await page.waitForTimeout(5200);
check('third failure triggers trace', (await page.textContent('#tracelog')).includes('RETAINED LOCALLY'));
await page.screenshot({ path: 'shots/4-trace.png' });
await page.click('#tracereset');
await waitPrompt(page);
check('trace from shell drops the link', (await logText(page)).includes('LINK DROPPED BY HOST'));
check('deck bar back to idle', await page.textContent('#dk-state') === 'idle');

// ── reconnect and get in ──
await connect(page);
await signIn(page, 'a.brandt', 'Kaskelot71');
await page.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
check('correct credentials open the portal', await page.isVisible('#navlist'));
check('user card populated', (await page.textContent('#uc-nm')).includes('Brandt'));
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots/5-portal.png' });

const nav = await page.$$eval('#navlist button', b => b.map(x => x.textContent.trim()));
check('4 staff sections + locked director', nav.length === 5 && nav[4].includes('Director'), nav.join(' | '));
await page.click('#navlist button[data-id=registry]');
await page.waitForTimeout(150);
check('registry renders bay 09 sealed', (await page.textContent('tr.sealed')).includes('2023-08-17'));
await page.click('#navlist button[data-id=mail]');
await page.waitForTimeout(150);
check('mail thread renders', (await page.$$('#sec-body details')).length === 7);
await page.click('#navlist button[data-id=status]');
await page.waitForTimeout(150);
check('status computes days since seal', /[\d,]{4,} days ago/.test(await page.textContent('.status')));

// ── shell round trip + elevate ──
await page.click('#toshell');
await waitPrompt(page);
check('shell button drops back with session intact', (await logText(page)).includes('session still open'));
await type(page, 'whoami');
check('whoami reports the session', (await logText(page)).includes('LC-0447'));
await type(page, 'ls');
check('ls lists sections + sealed tier3', (await logText(page)).includes('[sealed — director authorisation required]'));
await type(page, 'date');
check('date shows an in-world year', /20(4[4-9]|5\d)/.test(await logText(page)));
await page.screenshot({ path: 'shots/6-shell-authed.png' });

await type(page, 'elevate');
await waitPs(page, 'password:');
check('elevate asks for a code', true);
await type(page, 'PERSEPHONE-19');
await page.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
await page.waitForTimeout(400);
const nav2 = await page.$$eval('#navlist button', b => b.map(x => x.textContent.trim()));
check('elevate unlocks 3 director sections', nav2.length === 7, nav2.join(' | '));
check('director identity swaps in', (await page.textContent('#uc-nm')).includes('Vance'));
check('Persephone brief decrypts', (await page.textContent('#sec-body')).includes('cannot be copied'));
await page.screenshot({ path: 'shots/7-director.png', fullPage: true });

// ── the one-line form still works from the $ prompt ──
const pq = await ctx.newPage(); watch(pq);
await pq.goto(URL_); await waitPrompt(pq);
await connect(pq);
await type(pq, 'exit'); await waitPs(pq, 'lc-nc1 $');
await type(pq, 'login a.brandt Kaskelot71');
await pq.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
check('login <user> <pass> one-liner still works', await pq.isVisible('#navlist'));
await type(pq, 'x').catch(() => {});

// ── in-portal director gate ──
const pg = await ctx.newPage(); watch(pg);
await pg.goto(URL_); await waitPrompt(pg);
await connect(pg);
await signIn(pg, 'a.brandt', 'Kaskelot71');
await pg.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
await pg.click('#navlist button.lock');
await pg.waitForSelector('#gate:not([hidden])');
await pg.fill('#dp', 'wrong'); await pg.click('#gateform button[type=submit]');
await pg.waitForSelector('#gateerr:not([hidden])');
check('in-portal gate rejects wrong code', true);
await pg.fill('#dp', 'PERSEPHONE-19'); await pg.click('#gateform button[type=submit]');
await pg.waitForSelector('#gate[hidden]', { state: 'attached' });
check('in-portal gate unlocks tier 3', (await pg.$$eval('#navlist button', b => b.length)) === 7);

// gate trace keeps the session
const pg2 = await ctx.newPage(); watch(pg2);
await pg2.goto(URL_); await waitPrompt(pg2);
await connect(pg2);
await signIn(pg2, 'a.brandt', 'Kaskelot71');
await pg2.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
for (const bad of ['a', 'b', 'c']) {
  await pg2.click('#navlist button.lock').catch(() => {});
  await pg2.waitForSelector('#gate:not([hidden])').catch(() => {});
  await pg2.fill('#dp', bad); await pg2.click('#gateform button[type=submit]');
  await pg2.waitForTimeout(500);
}
await pg2.waitForSelector('#trace:not([hidden])', { timeout: 10000 });
await pg2.waitForTimeout(5200);
await pg2.click('#tracereset');
await pg2.waitForTimeout(300);
check('trace from the in-portal gate keeps the session', await pg2.isVisible('#navlist'));

// ── leak checks ──
const raw = html.toString();
check('no plaintext secrets in the served file',
  !raw.includes('PERSEPHONE-19') && !raw.includes('Kaskelot71') && !raw.includes('Achebe') && !raw.includes('Depository'));
check('username is hashed, not stored in the clear', !raw.includes('a.brandt') && /"userHash":"[0-9a-f]{64}"/.test(raw));
const sneak = await ctx.newPage(); await sneak.goto(URL_);
check('no plaintext secrets in pre-auth DOM', !(await sneak.content()).includes('Achebe'));

// ── GM panel ──
const p2 = await ctx.newPage(); watch(p2);
await p2.goto(URL_); await waitPrompt(p2);
await type(p2, 'gmgm');
await p2.waitForSelector('#gm:not([hidden])');
check('gmgm at the shell prompt opens the GM panel', true);
await p2.fill('#gm-u', 'a.brandt'); await p2.fill('#gm-p', 'Kaskelot71'); await p2.fill('#gm-d', 'PERSEPHONE-19');
await p2.click('#gm-unlock');
await p2.waitForSelector('#gm-edit:not([hidden])');
check('GM unlock decrypts both tiers', (await p2.inputValue('#gm-dir')).includes('PERSEPHONE'));
await p2.screenshot({ path: 'shots/8-gm.png' });

// change BOTH username and password, plus content, then rebuild
await p2.fill('#gm-u', 'y.adeyemi');
await p2.fill('#gm-p', 'NewPass99');
const dj = JSON.parse(await p2.inputValue('#gm-dir'));
dj.sections[0].items[0].title = 'EDITED BY GM PANEL';
await p2.fill('#gm-dir', JSON.stringify(dj, null, 2));
const dl = p2.waitForEvent('download');
await p2.click('#gm-build');
const tmp = new URL('./.tmp/rebuilt.html', import.meta.url).pathname;
await (await dl).saveAs(tmp);
const rebuilt = await readFile(tmp, 'utf8');
check('rebuilt file has no plaintext secrets',
  !rebuilt.includes('NewPass99') && !rebuilt.includes('y.adeyemi') &&
  !rebuilt.includes('EDITED BY GM PANEL') && !rebuilt.includes('PERSEPHONE-19'));
check('rebuilt file is a complete page',
  rebuilt.startsWith('<!DOCTYPE html>') && rebuilt.trim().endsWith('</html>'), (rebuilt.length / 1024).toFixed(1) + ' KB');

const server2 = serve(rebuilt);
const p3 = await ctx.newPage(); watch(p3);
await p3.goto(`http://127.0.0.1:${server2.address().port}/`);
await waitPrompt(p3);
await connect(p3);
await type(p3, 'a.brandt');
await waitPs(p3, 'login:');
check('rebuilt file rejects the OLD username', (await logText(p3)).includes('no such user'));
await type(p3, 'y.adeyemi');
await waitPs(p3, 'password:');
check('rebuilt file accepts the NEW username', true);
await type(p3, 'Kaskelot71');
await waitPs(p3, 'login:');
check('rebuilt file rejects the OLD password', (await logText(p3)).includes('credentials refused'));
await signIn(p3, 'y.adeyemi', 'NewPass99');
await p3.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
check('rebuilt file accepts the NEW password', true);
await p3.click('#navlist button.lock');
await p3.fill('#dp', 'PERSEPHONE-19'); await p3.click('#gateform button[type=submit]');
await p3.waitForSelector('#gate[hidden]', { state: 'attached' });
check('rebuilt file carries the GM content edit', (await p3.textContent('#sec-body')).includes('EDITED BY GM PANEL'));

// ── mobile ──
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const mp = await mob.newPage(); watch(mp);
await mp.goto(URL_); await waitPrompt(mp);
await type(mp, 'scan');
await waitLog(mp, 'ROUTE OUT');
await mp.screenshot({ path: 'shots/9-mobile-shell.png' });
const ovShell = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow in the shell at 390px', ovShell <= 1, 'overflow ' + ovShell + 'px');
await connect(mp);
await signIn(mp, 'a.brandt', 'Kaskelot71');
await mp.waitForSelector('#screen:not([hidden])', { timeout: 20000 });
await mp.click('#navlist button[data-id=mail]');
await mp.waitForTimeout(200);
const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow in the portal at 390px', ov <= 1, 'overflow ' + ov + 'px');
await mp.screenshot({ path: 'shots/10-mobile-portal.png' });

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' // '));

await browser.close(); server.close(); server2.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
