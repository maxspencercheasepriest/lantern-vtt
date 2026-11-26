// My games' other pages (Lantern Server with logins): the marketplace, your library of modules, your character
// vault and looking for group. home.js hands over its helpers; the server side is in community.js.
import { renderMarkdown } from './markdown.js';
import { listingHtml, wireListings } from './lfgview.js';

export function initPages(k) {
  const { $, esc, api, toast, ago, rulesetName, RULESET_INFO } = k;
  const PAGES = ['games', 'market', 'library', 'characters', 'lfg'];
  let current = 'games';
  let market = [];

  const sizeOf = (n) => (!n ? '' : n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const stars = (n) => `<span class="stars" title="${n ? `${n} out of 5` : 'No reviews yet'}">${[1, 2, 3, 4, 5].map((i) => `<i class="${n >= i - 0.25 ? 'on' : n >= i - 0.75 ? 'half' : ''}">★</i>`).join('')}</span>`;
  const contentsLine = (c = {}) => [c.scenes && `${c.scenes} scene${c.scenes === 1 ? '' : 's'}`, c.notes && `${c.notes} notes`, c.handouts && `${c.handouts} handouts`, c.npcs && `${c.npcs} NPCs`, c.tracks && `${c.tracks} tracks`].filter(Boolean).join(' · ');
  const byLine = (m) => (m.origin ? `by ${esc(m.author)}, brought in by ${esc(m.importedBy)}` : `by ${esc(m.author)}`);

  // ---------- pages ----------
  function show(page) {
    if (!PAGES.includes(page)) page = 'games';
    current = page;
    for (const a of document.querySelectorAll('#dash-nav a')) a.classList.toggle('active', a.dataset.page === page);
    for (const box of document.querySelectorAll('[data-pagebox]')) box.hidden = box.dataset.pagebox !== page;
    ({ market: loadMarket, library: loadLibrary, characters: loadVault, lfg: loadLfg, games: () => {} })[page]();
  }
  addEventListener('hashchange', () => show(location.hash.slice(1)));
  for (const id of Object.keys(RULESET_INFO)) $('#market-system').insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(RULESET_INFO[id].name)}</option>`);

  // ---------- a module, as a card ----------
  function card(m, where) {
    return `<article class="game module" data-module="${esc(m.id)}">
      <div class="game-thumb">
        ${m.cover ? `<img src="${esc(m.cover)}" alt="" loading="lazy">` : '<span class="flame big"></span>'}
        <span class="badge corner ${m.visibility === 'public' ? 'pub' : ''}">${m.visibility === 'public' ? 'Public' : 'Private'}</span>
        ${where === 'library' && m.update ? '<span class="badge corner-left hot">Updated</span>' : ''}
        ${m.withdrawn ? '<span class="badge corner-left">Withdrawn</span>' : ''}
      </div>
      <div class="game-body">
        <h2 class="game-name">${esc(m.title)}</h2>
        <p class="muted small">${esc(rulesetName(m.ruleset))} · ${byLine(m)}</p>
        <p class="small">${stars(m.stars)} <span class="muted">${m.reviews ? `${m.stars} (${m.reviews})` : 'No reviews yet'}</span></p>
        <p class="muted small">${esc(contentsLine(m.contents))}${m.size ? ` · ${sizeOf(m.size)}` : ''}</p>
        <div class="game-actions">
          ${where === 'library' ? `<button class="btn primary" data-start="${esc(m.id)}">Start a game</button>` : m.inLibrary ? '<span class="badge">In your library</span>' : `<button class="btn primary" data-add="${esc(m.id)}">Add to library</button>`}
          <button class="btn ghost" data-open="${esc(m.id)}">Details</button>
        </div>
      </div>
    </article>`;
  }

  // ---------- marketplace ----------
  async function loadMarket() {
    try { market = (await api('/api/modules')).modules; } catch (e) { return toast(e.message, true); }
    drawMarket();
  }
  function drawMarket() {
    const q = $('#market-search').value.trim().toLowerCase();
    const sys = $('#market-system').value;
    const list = market.filter((m) => (!sys || m.ruleset === sys) && (!q || `${m.title} ${m.description} ${m.author}`.toLowerCase().includes(q)));
    $('#market').innerHTML = list.map((m) => card(m, 'market')).join('');
    $('#market-empty').hidden = market.length > 0;
    if (market.length && !list.length) $('#market').innerHTML = '<p class="muted">Nothing matches that.</p>';
  }
  $('#market-search').oninput = drawMarket;
  $('#market-system').onchange = drawMarket;

  // ---------- library ----------
  async function loadLibrary() {
    let list;
    try { list = (await api('/api/my-library')).modules; } catch (e) { return toast(e.message, true); }
    $('#library').innerHTML = list.map((m) => card(m, 'library')).join('');
    $('#library-empty').hidden = list.length > 0;
    $('#lib-dot').hidden = !list.some((m) => m.update);
  }

  // clicks on module cards, wherever they are
  for (const box of [$('#market'), $('#library')]) {
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) { const c = e.target.closest('[data-module]'); if (c) openModule(c.dataset.module); return; }
      try {
        if (b.dataset.add) { await api(`/api/modules/${b.dataset.add}/library`, { on: true }); toast('Added to your library: start a game from it there, or from Create new game'); loadMarket(); }
        else if (b.dataset.start) k.openNewGame(b.dataset.start);
        else if (b.dataset.open) openModule(b.dataset.open);
      } catch (er) { toast(er.message, true); }
    });
  }

  // ---------- one module: everything about it, and the reviews ----------
  async function openModule(id) {
    let m;
    try { m = (await api(`/api/modules/${id}`)).module; } catch (e) { return toast(e.message, true); }
    if (m.update) api(`/api/modules/${id}/seen`, {}).then(() => current === 'library' && loadLibrary()).catch(() => {});
    const me = k.me();
    const myReview = m.reviews.find((r) => r.by === me.name);
    const canReview = !m.canEdit || m.origin;
    $('#mod-title').textContent = m.title;
    $('#mod-body').innerHTML = `
      <div class="mod-cover" ${m.cover ? `style="background-image:url('${esc(m.cover)}')"` : ''}></div>
      <div class="mod-meta">
        <span class="chip">${esc(rulesetName(m.ruleset))}</span>
        <span class="chip ${m.visibility === 'public' ? 'pub' : ''}">${m.visibility === 'public' ? 'Public: can be exported' : 'Private: stays on this server'}</span>
        <span class="chip">Version ${m.version} · ${esc(new Date(m.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</span>
        ${m.size ? `<span class="chip">${sizeOf(m.size)}</span>` : ''}
      </div>
      <p class="muted small">${byLine(m)}${m.origin?.server ? ` (from ${esc(m.origin.server)})` : ''} · ${stars(m.stars)} ${m.reviews.length ? `${m.stars} from ${m.reviews.length} review${m.reviews.length === 1 ? '' : 's'}` : 'no reviews yet'}</p>
      ${m.update ? `<p class="note">There's a newer version than the one you added. New games you start get version ${m.version}; games you've already started stay as they are.</p>` : ''}
      <div class="md mod-desc">${m.description ? renderMarkdown(m.description) : '<p class="muted">No description.</p>'}</div>
      <h3>What's in it</h3>
      <p>${esc(contentsLine(m.contents) || 'Nothing listed')}</p>
      ${m.pdfs?.length ? `<p class="small">PDFs: ${m.pdfs.map((p) => esc(p.title)).join(', ')}</p>` : ''}
      <div class="mod-actions">
        ${m.inLibrary ? `<button class="btn primary" data-m="start">Start a game from it</button><button class="btn ghost" data-m="unlib">Remove from my library</button>`
          : `<button class="btn primary" data-m="lib">Add to library</button>`}
        ${m.canExport ? '<a class="btn" data-m="export" download>Export .lantern file</a>' : ''}
        <span class="grow"></span>
        ${m.canEdit && !m.origin ? `<button class="btn ghost" data-m="withdraw">${m.withdrawn ? 'Offer it again' : 'Withdraw'}</button>` : ''}
        ${me.admin ? '<button class="btn ghost danger" data-m="takedown" title="Remove it from this server: gone from the marketplace and every library">Take down</button>' : ''}
      </div>
      <h3>Reviews</h3>
      ${canReview ? `<form class="mod-review">
        <div class="inline"><span>Your review</span><select name="stars">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${myReview?.stars === n ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)}</option>`).join('')}</select>
        ${myReview ? '<button type="button" class="btn ghost" data-m="unreview">Delete mine</button>' : ''}</div>
        <textarea name="text" rows="3" maxlength="1500" placeholder="How did it play? What should a GM know?">${esc(myReview?.text || '')}</textarea>
        <div class="inline"><span class="grow"></span><button class="btn">${myReview ? 'Update review' : 'Post review'}</button></div>
      </form>` : '<p class="muted small">You published this one, so you can’t review it.</p>'}
      <ul class="reviews">${m.reviews.map((r) => `<li><div>${stars(r.stars)} <b>${esc(r.by)}</b> <span class="muted small">${esc(ago(r.at))}${r.version !== m.version ? ` · on version ${r.version}` : ''}</span>
        ${me.admin && r.by !== me.name ? `<button class="iconbtn" data-unreview-by="${esc(r.by)}" title="Remove this review">✕</button>` : ''}</div>${r.text ? `<p>${esc(r.text)}</p>` : ''}</li>`).join('') || '<li class="muted small">Nobody has reviewed it yet.</li>'}</ul>
      <p class="error" role="alert"></p>`;
    const body = $('#mod-body');
    const err = $('.error', body);
    const exp = $('[data-m="export"]', body);
    if (exp) exp.href = `/api/modules/${id}/export`;
    body.onclick = async (e) => {
      const a = e.target.closest('[data-m], [data-unreview-by]')?.dataset;
      if (!a) return;
      try {
        if (a.m === 'lib') { await api(`/api/modules/${id}/library`, { on: true }); toast('Added to your library'); }
        else if (a.m === 'unlib') { if (!confirm(`Take ${m.title} out of your library? Games you started from it stay.`)) return; await api(`/api/modules/${id}/library`, { on: false }); }
        else if (a.m === 'start') { $('#dlg-module').close(); return k.openNewGame(id); }
        else if (a.m === 'export') { toast('Getting the file ready: big modules take a minute'); return; }
        else if (a.m === 'withdraw') { await api(`/api/modules/${id}/withdraw`, { on: !m.withdrawn }); toast(m.withdrawn ? 'Back in the marketplace' : 'Withdrawn: anyone who added it keeps it'); }
        else if (a.m === 'takedown') { if (!confirm(`Take ${m.title} down? It goes from the marketplace and everyone's library. Games already started from it stay.`)) return; await api(`/api/modules/${id}/takedown`, {}); $('#dlg-module').close(); toast('Taken down'); return refresh(); }
        else if (a.m === 'unreview') await api(`/api/modules/${id}/review`, { remove: true });
        else if (a.unreviewBy) await api(`/api/modules/${id}/review`, { remove: true, by: a.unreviewBy });
        refresh();
        openModule(id);
      } catch (er) { err.textContent = er.message; }
    };
    const rf = $('.mod-review', body);
    if (rf) rf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/api/modules/${id}/review`, { stars: Number(rf.stars.value), text: rf.text.value }); toast('Thanks for the review'); refresh(); openModule(id); } catch (er) { err.textContent = er.message; }
    };
    if (!$('#dlg-module').open) $('#dlg-module').showModal();
  }
  const refresh = () => { if (current === 'market') loadMarket(); else if (current === 'library') loadLibrary(); };

  // ---------- importing a .lantern file ----------
  for (const input of document.querySelectorAll('.import-module')) {
    input.onchange = () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/modules/import');
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) toast(`Uploading ${file.name}… ${Math.round((ev.loaded / ev.total) * 100)}%`); };
      xhr.upload.onload = () => toast('Unpacking…');
      xhr.onload = () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status !== 200) return toast(d.error || `That didn't work (${xhr.status})`, true);
        toast(`${d.module.title} is in the marketplace and your library`);
        location.hash = 'library';
        loadLibrary();
      };
      xhr.onerror = () => toast('The upload stopped. Try again', true);
      xhr.send(fd);
    };
  }

  // ---------- characters: the vault ----------
  async function loadVault() {
    let list;
    try { list = (await api('/api/vault')).characters; } catch (e) { return toast(e.message, true); }
    $('#vault-empty').hidden = list.length > 0;
    $('#vault').innerHTML = list.map((c) => `<article class="vault-card" data-char="${esc(c.id)}">
      <div class="vault-pic" ${c.portrait ? `style="background-image:url('${esc(c.portrait)}')"` : ''}>${c.portrait ? '' : esc((c.name[0] || '?').toUpperCase())}</div>
      <div class="grow">
        <h3>${esc(c.name)}</h3>
        <p class="muted small">${esc(rulesetName(c.system))}${c.from?.title ? ` · from ${esc(c.from.title)}` : ''} · saved ${esc(ago(c.saved))}</p>
      </div>
      <button class="btn ghost" data-rename>Rename</button>
      <button class="btn ghost danger" data-delete>Delete</button>
    </article>`).join('');
  }
  $('#vault').onclick = async (e) => {
    const c = e.target.closest('[data-char]');
    if (!c) return;
    const name = c.querySelector('h3').textContent;
    try {
      if ('rename' in e.target.dataset) {
        const n = prompt('New name', name);
        if (n && n.trim() !== name) await api(`/api/vault/${c.dataset.char}/rename`, { name: n });
      } else if ('delete' in e.target.dataset) {
        if (!confirm(`Delete ${name} from your vault? Copies already in games stay.`)) return;
        await api(`/api/vault/${c.dataset.char}/delete`, {});
      } else return;
      loadVault();
    } catch (er) { toast(er.message, true); }
  };

  // ---------- looking for group ----------
  async function loadLfg() {
    let d;
    try { d = await api('/api/lfg'); } catch (e) { return toast(e.message, true); }
    $('#lfg').innerHTML = d.listings.length ? d.listings.map((l) => listingHtml(l, true)).join('')
      : '<p class="empty muted">No games are looking for players just now. GMs: list yours from its card’s <b>Players &amp; invites</b>.</p>';
  }
  wireListings($('#lfg'), { api, reload: () => { loadLfg(); k.loadGames(); }, toast, signedIn: true });

  return {
    start() {
      show(location.hash.slice(1) || 'games');
      // the dot on Library when something there has been updated
      api('/api/my-library').then((d) => { $('#lib-dot').hidden = !d.modules.some((m) => m.update); }).catch(() => {});
    },
    show,
  };
}
