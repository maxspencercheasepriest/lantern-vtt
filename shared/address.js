// What a player typed or pasted as the GM's address → a full origin.
//   192.168.1.20:3000, 100.101.2.3, localhost, gm-pc.tail1234.ts.net  → http://…:3000 (home network, Tailscale)
//   brave-otter.trycloudflare.com, lantern.example.com                → https://… (an online link)
//   anything starting http:// or https:// is kept as typed; a full invite link's path and ?room= are ignored.
// A copy of this lives in mobile/app-shell.js, which can't load modules; keep the two the same.
export function toOrigin(input) {
  let a = String(input || '').trim();
  if (!a) return null;
  if (!/^https?:\/\//i.test(a)) {
    const hostPort = a.split('/')[0];
    const host = hostPort.replace(/:\d+$/, '').toLowerCase();
    const hasPort = /:\d+$/.test(hostPort);
    const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || !host.includes('.') || /\.(local|lan|home|internal|ts\.net)$/.test(host);
    a = `${hasPort || local ? 'http' : 'https'}://${a}`;
  }
  try {
    const u = new URL(a);
    if (u.protocol === 'http:' && !u.port) u.port = '3000';
    return u.origin;
  } catch { return null; }
}

/** The room from a pasted invite link (…/?room=thaw), if there is one. */
export function roomFromLink(input) {
  const m = /[?&]room=([a-z0-9-]{1,40})/i.exec(String(input || ''));
  return m ? m[1].toLowerCase() : null;
}
