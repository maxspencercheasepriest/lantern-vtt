// "Share online": puts a Lantern server on the internet without touching the router, using a free
// Cloudflare quick tunnel (https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
// Cloudflare's small open-source `cloudflared` program (Apache-2.0) makes an outgoing connection to
// Cloudflare, which hands back a random https://….trycloudflare.com address that forwards to this server.
// No account, no port forwarding, and because the link is https, players' GoDice work in Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

/** The cloudflared download for this computer, and what the program is called once saved. */
export function cloudflaredAsset(platform = process.platform, arch = process.arch) {
  const a = arch === 'arm64' ? 'arm64' : 'amd64';
  if (platform === 'win32') return { file: 'cloudflared-windows-amd64.exe', bin: 'cloudflared.exe' }; // runs on Windows on Arm too
  if (platform === 'darwin') return { file: `cloudflared-darwin-${a}.tgz`, bin: 'cloudflared', tgz: true };
  if (platform === 'linux') return { file: `cloudflared-linux-${a}`, bin: 'cloudflared' };
  return null;
}

export const cloudflaredPath = (dir) => path.join(dir, cloudflaredAsset()?.bin || 'cloudflared');

/** Find cloudflared: our downloaded copy first, then one installed on the system. */
export function findCloudflared(dir) {
  const own = dir && cloudflaredPath(dir);
  if (own && fs.existsSync(own)) return own;
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  for (const p of (process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(p, exe);
    if (p && fs.existsSync(f)) return f;
  }
  for (const f of ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']) if (fs.existsSync(f)) return f;
  return null;
}

/** Download cloudflared from Cloudflare's GitHub releases into `dir`. */
export async function downloadCloudflared(dir, fetchImpl = fetch) {
  const asset = cloudflaredAsset();
  if (!asset) throw new Error(`Sharing online isn't available on ${process.platform}`);
  const res = await fetchImpl(RELEASES + asset.file);
  if (!res.ok) throw new Error(`Couldn't download Cloudflare's tunnel program (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000_000) throw new Error("The tunnel program download looks incomplete — try again");
  fs.mkdirSync(dir, { recursive: true });
  const target = cloudflaredPath(dir);
  if (asset.tgz) {
    const tmp = path.join(dir, asset.file);
    fs.writeFileSync(tmp, buf);
    try { execFileSync('tar', ['-xzf', tmp, '-C', dir]); } finally { fs.rmSync(tmp, { force: true }); }
    if (!fs.existsSync(target)) throw new Error("Couldn't unpack the tunnel program");
  } else {
    fs.writeFileSync(target + '.part', buf);
    fs.renameSync(target + '.part', target);
  }
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  return target;
}

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Start a quick tunnel to http://127.0.0.1:port. Resolves once Cloudflare has given us an address and the
 * tunnel is connected: { url, stop(), onExit(fn) }.
 */
export function startTunnel(bin, port, { timeoutMs = 60000, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let url = null;
    let settled = false;
    let tail = '';
    const exitFns = [];
    const stop = () => { if (child.exitCode === null) child.kill(); };
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(grace);
      if (err) { stop(); reject(err); } else resolve({ url, stop, onExit: (fn) => exitFns.push(fn), pid: child.pid });
    };
    const timer = setTimeout(() => done(new Error(url
      ? 'Cloudflare gave us a link but the tunnel never connected — check your internet connection'
      : "Cloudflare didn't answer — check your internet connection, or try again in a minute")), timeoutMs);
    let grace = null;
    const read = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000);
      onLog?.(text);
      if (!url) {
        const m = text.match(URL_RE);
        if (m) {
          url = m[0].toLowerCase();
          // the link appears just before the connection is up; don't wait forever for the confirmation line
          grace = setTimeout(() => done(), 15000);
        }
      }
      if (url && /Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(tail)) done();
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (e) => done(new Error(`Couldn't run the tunnel program: ${e.message}`)));
    child.on('exit', (code) => {
      if (!settled) done(new Error(explain(tail, code)));
      for (const fn of exitFns) fn(code);
    });
  });
}

/** Turn cloudflared's last complaint into something a GM can act on. */
export function explain(output, code) {
  const lines = String(output || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bad = lines.filter((l) => /failed|error|\bERR\b/i.test(l)).pop() || '';
  if (/no such host|lookup|dial tcp|i\/o timeout|network is unreachable|connection refused/i.test(bad)) {
    return "Couldn't reach Cloudflare — check this computer is online, and that a firewall or VPN isn't blocking cloudflared";
  }
  if (/429|too many requests|rate/i.test(bad)) return 'Cloudflare is busy handing out links right now — try again in a minute';
  const msg = bad.replace(/^\S+Z\s+(ERR|INF|WRN)\s*/, '');
  return `The tunnel stopped${msg ? `: ${msg}` : code != null ? ` (code ${code})` : ''}`;
}

/** Tailscale gives each device an address in 100.64.0.0/10. */
export function isTailscaleIp(ip) {
  const m = /^100\.(\d+)\./.exec(ip || '');
  return !!m && +m[1] >= 64 && +m[1] <= 127;
}
