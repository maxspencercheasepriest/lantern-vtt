// Loaded first in the Android app. Lantern's interface ships inside the app (served from http://localhost,
// which Android's web view treats as a secure page, so the camera is allowed) and talks to the GM's server
// over the home network. This remembers which server. (On the web and desktop this file isn't used.)
(function () {
  'use strict';
  const read = (k, store = localStorage) => { try { return store.getItem(k); } catch { return null; } };
  const write = (k, v, store = localStorage) => { try { store.setItem(k, v); } catch {} };

  /** Same rules as shared/address.js: home-network and Tailscale addresses → http (port 3000), domains → https. */
  function normalise(input) {
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

  let pendingJoin = null;
  try { pendingJoin = JSON.parse(read('lantern.pendingJoin', sessionStorage) || 'null'); } catch {}
  try { sessionStorage.removeItem('lantern.pendingJoin'); } catch {}

  window.lanternApp = {
    version: '__VERSION__',
    platform: 'android',
    server: read('lantern.server') || '',
    pendingJoin,
    normalise,
    setServer(addr, joinPayload) {
      write('lantern.server', addr);
      if (joinPayload) write('lantern.pendingJoin', JSON.stringify(joinPayload), sessionStorage);
      location.reload();
    },
  };
  document.documentElement.classList.add('in-app');
})();
