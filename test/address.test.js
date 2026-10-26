import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { toOrigin, roomFromLink } from '../shared/address.js';
import { isTailscaleIp, explain, cloudflaredAsset } from '../tunnel.js';

const CASES = [
  ['192.168.1.20:3000', 'http://192.168.1.20:3000'],
  ['192.168.1.20', 'http://192.168.1.20:3000'],
  ['100.101.2.3:4000', 'http://100.101.2.3:4000'],
  ['localhost', 'http://localhost:3000'],
  ['gm-pc', 'http://gm-pc:3000'],
  ['gm-pc.tail1234.ts.net', 'http://gm-pc.tail1234.ts.net:3000'],
  ['brave-otter.trycloudflare.com', 'https://brave-otter.trycloudflare.com'],
  ['https://brave-otter.trycloudflare.com/?room=thaw', 'https://brave-otter.trycloudflare.com'],
  ['lantern.example.com:8080', 'http://lantern.example.com:8080'],
  ['http://86.12.34.56', 'http://86.12.34.56:3000'],
  ['', null],
];

test('addresses and invite links become the right origin', () => {
  for (const [input, want] of CASES) assert.equal(toOrigin(input), want, input);
  assert.equal(roomFromLink('https://x.trycloudflare.com/?room=Thaw'), 'thaw');
  assert.equal(roomFromLink('192.168.1.2:3000'), null);
});

test('the Android app shell follows the same address rules', () => {
  const ctx = { window: {}, document: { documentElement: { classList: { add() {} } } }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: {}, URL };
  vm.runInNewContext(readFileSync(new URL('../mobile/app-shell.js', import.meta.url), 'utf8'), ctx);
  for (const [input, want] of CASES) assert.equal(ctx.window.lanternApp.normalise(input), want, input);
});

test('tunnel helpers', () => {
  assert.ok(isTailscaleIp('100.64.0.1') && isTailscaleIp('100.127.255.1'));
  assert.ok(!isTailscaleIp('100.63.0.1') && !isTailscaleIp('10.0.0.5'));
  assert.match(explain('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host', 1), /Couldn't reach Cloudflare/);
  assert.match(explain('ERR something odd happened', 2), /something odd/);
  assert.equal(cloudflaredAsset('win32', 'x64').file, 'cloudflared-windows-amd64.exe');
  assert.equal(cloudflaredAsset('darwin', 'arm64').file, 'cloudflared-darwin-arm64.tgz');
  assert.equal(cloudflaredAsset('linux', 'x64').bin, 'cloudflared');
});
