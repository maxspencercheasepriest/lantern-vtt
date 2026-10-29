// The GM's table quietly saves a small picture of the map now and then, so the desktop launcher can show
// each campaign with the screen you last used.
import { store, $ } from './util.js';

const W = 480, H = 300;
let socket, timer = null, lastSent = 0;

export function initThumb(s) {
  socket = s;
  store.on('joined', () => { if (store.isGM) soon(6000); });
  store.on('scene', () => { if (store.isGM) soon(15000); });
  setInterval(() => { if (store.isGM && Date.now() - lastSent > 170000) capture(); }, 60000);
  addEventListener('pagehide', () => { if (store.isGM) capture(); });
}

function soon(ms) { clearTimeout(timer); timer = setTimeout(capture, ms); }

function capture() {
  const map = $('#map');
  if (!socket?.connected || !map || !map.width || !store.scene || document.hidden) return;
  try {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#121214';
    g.fillRect(0, 0, W, H);
    // fill the frame from the middle of the map view
    const k = Math.max(W / map.width, H / map.height);
    const sw = W / k, sh = H / k;
    g.drawImage(map, (map.width - sw) / 2, (map.height - sh) / 2, sw, sh, 0, 0, W, H);
    socket.emit('campaign:thumb', { image: c.toDataURL('image/jpeg', 0.72) }, () => {});
    lastSent = Date.now();
  } catch { /* a map from another site can't be copied: no thumbnail, no harm */ }
}
