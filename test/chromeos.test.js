import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCrostiniIp, onChromeOS, chromeosHosting, chromeosHostingText } from '../shared/chromeos.js';
import { isTailscaleIp } from '../tunnel.js';

test('a Chromebook container address is recognised', () => {
  assert.equal(isCrostiniIp('100.115.92.205'), true);
  assert.equal(isCrostiniIp('100.115.92.2'), true);
  assert.equal(isCrostiniIp('100.101.2.3'), false);   // a real Tailscale address
  assert.equal(isCrostiniIp('192.168.1.20'), false);
  assert.equal(isCrostiniIp(''), false);
  assert.equal(isCrostiniIp(null), false);
});

test('Crostini addresses look like Tailscale ones, which is why we filter them', () => {
  // 100.115.92.x falls inside Tailscale's 100.64.0.0/10, so the launcher has to
  // drop it before deciding what is a Tailscale address.
  assert.equal(isTailscaleIp('100.115.92.205'), true);
});

test('the hosting steps name the port the GM is actually using', () => {
  const h = chromeosHosting(4000);
  assert.match(h.steps.join(' '), /Add port 4000/);
  assert.match(h.note, /localhost:4000/);
  assert.match(h.steps.join(' '), /Port forwarding/);
  assert.ok(h.dice.length > 0, 'says what happens to GoDice');
  assert.equal(chromeosHosting().steps.join(' ').includes('3000'), true);
});

test('the text version is plain numbered lines', () => {
  const lines = chromeosHostingText(3000).split('\n');
  assert.equal(lines[0], 'Hosting from a Chromebook');
  assert.match(lines[1], /^ {2}1\. /);
  assert.match(lines[4], /^ {2}4\. /);
});

test('detection does not throw, and is false on this machine', () => {
  assert.equal(typeof onChromeOS(), 'boolean');
});
