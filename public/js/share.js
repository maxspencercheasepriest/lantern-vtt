// Scene → "Players outside your network": the host's Share online switch (desktop app only).
// The tunnel itself runs in the desktop app (electron/main.js + tunnel.js); this is just its panel.
import { $, toast } from './util.js';

const TEXT = {
  off: 'Not shared. Players outside your network can\'t reach this table yet.',
  downloading: 'Downloading Cloudflare\'s tunnel program (first time only, takes a moment)…',
  starting: 'Asking Cloudflare for a link…',
  on: 'Shared. Anyone with this link can join as a player, so only send it to your group.',
};

export async function initShare() {
  const api = window.lanternDesktop?.share;
  const box = $('#share-box');
  if (!api || !box) return;
  const first = await api.status().catch(() => ({ state: 'unavailable' }));
  if (first.state === 'unavailable') return; // joined someone else's game
  box.hidden = false;
  const btn = $('#share-btn');
  const render = (s) => {
    const busy = s.state === 'downloading' || s.state === 'starting';
    btn.disabled = busy;
    btn.textContent = s.state === 'on' ? 'Stop sharing' : busy ? 'Working…' : 'Share online';
    btn.classList.toggle('primary', s.state !== 'on');
    $('#share-state').textContent = s.state === 'error' ? s.error : TEXT[s.state] || '';
    $('#share-state').classList.toggle('bad', s.state === 'error');
    $('#share-link-row').hidden = s.state !== 'on';
    if (s.invite) $('#share-link').value = s.invite;
  };
  render(first);
  api.onStatus(render);
  btn.onclick = async () => {
    const on = btn.textContent === 'Stop sharing';
    try { render(on ? await api.stop() : await api.start()); } catch (e) { toast(e.message, true); }
  };
  $('#share-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#share-link').value); toast('Invite link copied'); } catch { $('#share-link').select(); }
  };
}
