// The public Looking for group page: anyone can see the listings; asking to join makes an account if need be.
import { listingHtml, wireListings } from './lfgview.js';

const $ = (s) => document.querySelector(s);
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}
async function api(url, body) {
  const r = await fetch(url, body === undefined ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(data.error || `Something went wrong (${r.status})`);
  return data;
}

async function load() {
  let d;
  try { d = await api('/api/lfg'); } catch (e) {
    $('#lfg').innerHTML = `<p class="error">${e.message.includes('404') ? 'This Lantern has no Looking for group page.' : 'Can’t reach the server: try again in a moment.'}</p>`;
    return;
  }
  $('#lfg-home').textContent = d.signedIn ? 'My games' : 'Log in';
  $('#lfg-empty').hidden = d.listings.length > 0;
  $('#lfg').innerHTML = d.listings.map((l) => listingHtml(l, d.signedIn)).join('');
  wireListings($('#lfg'), { api, reload: load, toast, signedIn: d.signedIn });
}
load();
