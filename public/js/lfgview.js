// A looking-for-group listing, drawn the same way on the public page (lfg.html) and on My games.
import { RULESET_INFO } from '/rules/references.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rulesetName = (id) => RULESET_INFO[id]?.name || id || 'Game system to be decided';
const nextGame = (iso) => {
  const t = Date.parse(iso || '');
  if (!t || t < Date.now() - 3 * 3600e3) return '';
  return new Date(t).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
};
const paras = (text) => esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

/** One listing. who: null (not logged in) or { signedIn: true }; the listing says whether you're in or have asked. */
export function listingHtml(l, signedIn) {
  const full = l.seatsLeft <= 0;
  let action;
  if (signedIn && l.member) action = `<a class="btn" href="/?room=${encodeURIComponent(l.room)}">You're in: open the game</a>`;
  else if (signedIn && l.request?.status === 'pending') action = `<span class="badge">Asked to join</span> <button class="btn ghost" data-withdraw="${esc(l.request.id)}">Take back</button>`;
  else if (signedIn && l.request?.status === 'declined') action = '<span class="badge">The GM said no this time</span>';
  else action = `<button class="btn primary" data-ask="${esc(l.room)}">${full ? 'Ask to join the waiting list' : 'Ask to join'}</button>`;
  const when = nextGame(l.nextSession);
  return `<article class="lfg-card" data-room="${esc(l.room)}">
    <div class="lfg-pic" ${l.thumb ? `style="background-image:url('/api/lfg/${encodeURIComponent(l.room)}/thumb')"` : ''}></div>
    <div class="lfg-text">
      <h3>${esc(l.title)}</h3>
      <div class="lfg-meta">
        <span class="chip">${esc(rulesetName(l.ruleset))}</span>
        ${l.schedule ? `<span class="chip">🗓 ${esc(l.schedule)}</span>` : ''}
        <span class="chip ${full ? 'full' : ''}">${full ? 'Full' : `${l.seatsLeft} of ${l.seats} seat${l.seats === 1 ? '' : 's'} free`}</span>
        ${l.newPlayers ? '<span class="chip welcome">New players welcome</span>' : ''}
        ${l.howWePlay ? `<span class="chip">${esc(l.howWePlay)}</span>` : ''}
      </div>
      <div class="lfg-blurb">${paras(l.blurb || '')}</div>
      <div class="lfg-foot"><span class="muted small">GM: <b>${esc(l.gm)}</b>${when ? ` · next game ${esc(when)}` : ''}</span><span class="grow"></span>${action}</div>
      <form class="lfg-ask" hidden>
        <textarea name="message" rows="3" maxlength="1000" placeholder="Say hello: a bit about you, and what you like in a game"></textarea>
        <div class="lfg-signup" hidden>
          <p class="muted small">Make an account on this Lantern to ask. Once the GM says yes, the game is waiting on your page.</p>
          <div class="inline"><label class="grow">Your name <input name="name" minlength="2" maxlength="32" autocomplete="username"></label>
          <label class="grow">Choose a password <input name="password" type="password" minlength="8" autocomplete="new-password"></label></div>
          <p class="small">Already have an account? <a href="/home.html?next=${encodeURIComponent('/lfg.html')}">Log in</a> first.</p>
        </div>
        <div class="inline"><span class="grow"></span><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Send</button></div>
        <p class="error" role="alert"></p>
      </form>
    </div>
  </article>`;
}

/**
 * Draw the listings into box and handle asking, signing up and taking a request back.
 * api(url, body) → JSON; reload() redraws; toast(msg, bad).
 */
export function wireListings(box, { api, reload, toast, signedIn }) {
  box.onclick = async (e) => {
    const card = e.target.closest('.lfg-card');
    if (!card) return;
    const form = card.querySelector('.lfg-ask');
    if (e.target.dataset.ask) {
      form.hidden = false;
      form.querySelector('.lfg-signup').hidden = signedIn;
      for (const i of form.querySelectorAll('.lfg-signup input')) i.required = !signedIn;
      form.message.focus();
    } else if ('cancel' in e.target.dataset) {
      form.hidden = true;
    } else if (e.target.dataset.withdraw) {
      try { await api(`/api/lfg/requests/${encodeURIComponent(e.target.dataset.withdraw)}/withdraw`, {}); toast('Taken back'); reload(); } catch (er) { toast(er.message, true); }
    }
  };
  box.onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const room = form.closest('.lfg-card').dataset.room;
    const err = form.querySelector('.error');
    err.textContent = '';
    try {
      if (signedIn) await api(`/api/lfg/${encodeURIComponent(room)}/request`, { message: form.message.value });
      else await api('/api/auth/register', { name: form.name.value, password: form.password.value, lfg: room, message: form.message.value, remember: true });
      toast(signedIn ? 'Sent: the GM will say yes or no' : 'Your account is made and the GM has your message. Once they say yes, the game is on your page.');
      reload();
    } catch (er) { err.textContent = er.message; }
  };
}
