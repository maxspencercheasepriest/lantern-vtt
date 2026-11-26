// Publishing a campaign to this server's marketplace (Lantern Server with logins): the GM picks what goes in,
// public or private, and a cover. The server takes a snapshot (community.js moduleSnapshot) of what the GM set up.
import { $, esc, store, toast, openWindow, uploadImage } from './util.js';

async function api(url, body) {
  const r = await fetch(url, body === undefined ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(data.error || `Something went wrong (${r.status})`);
  return data;
}
const sizeOf = (n) => (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export async function openPublish() {
  if (!store.account) return toast('Publishing needs Lantern Server with logins', true);
  const w = openWindow('publish', { title: 'Publish to the marketplace', width: 580, height: 820 });
  if (w.existed) return;
  w.body.innerHTML = '<p class="muted pad">Looking at what this campaign holds…</p>';
  let info;
  try { info = await api(`/api/games/${encodeURIComponent(store.room)}/publish`); } catch (e) { w.body.innerHTML = `<p class="error pad">${esc(e.message)}</p>`; return; }
  const m = info.module;
  const c = info.contents;
  const part = (k, label, n) => `<label class="check"><input type="checkbox" name="inc-${k}" checked ${n ? '' : 'disabled'}> ${label} <span class="muted small">(${n})</span></label>`;
  w.body.innerHTML = `<form class="pub">
    ${m ? `<div class="pub-was">Published as <b>version ${m.version}</b> (${m.visibility}) on ${esc(day(m.updated))}${m.withdrawn ? ', <b>withdrawn</b>' : ''}.
      Publishing again makes version ${m.version + 1}: people with it in their library are told there's an update, and games already started from it stay as they are.</div>` : ''}
    <label>Title <input name="title" required maxlength="80" value="${esc(m?.title || info.title)}"></label>
    <label>Description <span class="muted small">(what it is, how long, how many players; Markdown works)</span>
      <textarea name="description" rows="6" maxlength="4000">${esc(m?.description ?? info.description)}</textarea></label>
    <fieldset class="pub-vis">
      <legend>Who can have it</legend>
      <label class="check"><input type="radio" name="visibility" value="private" ${m?.visibility === 'public' ? '' : 'checked'}> <span><b>Private</b>: in this server's marketplace only, and it can't be exported. For things you own a copy of but can't hand out, such as a published adventure.</span></label>
      <label class="check"><input type="radio" name="visibility" value="public" ${m?.visibility === 'public' ? 'checked' : ''}> <span><b>Public</b>: in this server's marketplace, and anyone who adds it can export it as a file for another Lantern server.</span></label>
      <label class="check pub-ok" hidden><input type="checkbox" name="shareOk" ${m?.shareOk ? 'checked' : ''}> This is all mine to share, or I have permission, including any maps, pictures, music and PDFs in it.</label>
    </fieldset>
    <fieldset>
      <legend>What goes in</legend>
      ${part('scenes', 'Scenes, maps, walls, doors and tokens', c.scenes)}
      ${part('notes', 'Your notes', c.notes)}
      ${part('handouts', 'Handouts', c.handouts)}
      ${part('sheets', 'NPC sheets', c.npcs)}
      ${part('audio', 'Music and sound', c.tracks)}
      <p class="muted small">Always left out: chat, players' characters, session write-ups, fog players have uncovered, secret doors they've found, and who's played.</p>
    </fieldset>
    <fieldset>
      <legend>PDFs</legend>
      ${info.pdfs.length ? info.pdfs.map((p) => `<label class="check"><input type="checkbox" name="pdf" value="${esc(p.id)}" ${(m ? m.pdfs?.some((x) => x.id === p.id) : p.shared) ? 'checked' : ''}> ${esc(p.title)} <span class="muted small">(${sizeOf(p.size || 0)})</span></label>`).join('')
        : '<p class="muted small">No PDFs in the library. Add the adventure\'s PDF under Library → PDFs first if it should come with it.</p>'}
    </fieldset>
    <fieldset>
      <legend>Cover picture</legend>
      <div class="pub-cover" style="${m?.cover ? `background-image:url('${esc(m.cover)}')` : ''}">${m?.cover ? '' : '<span class="muted small">The map you\'re on is used if you don\'t pick one</span>'}</div>
      <input type="file" name="cover" accept="image/*">
    </fieldset>
    <div class="pub-actions">
      ${m ? `<button type="button" class="btn" data-a="withdraw">${m.withdrawn ? 'Offer it again' : 'Withdraw'}</button>` : ''}
      <span class="grow"></span>
      <button class="btn primary" type="submit">${m ? 'Publish new version' : 'Publish'}</button>
    </div>
    <p class="error" role="alert"></p>
  </form>`;
  const f = $('form', w.body);
  const err = $('.error', f);
  let cover = '';
  const vis = () => { $('.pub-ok', f).hidden = f.visibility.value !== 'public'; };
  f.querySelectorAll('[name=visibility]').forEach((r) => (r.onchange = vis));
  vis();
  f.cover.onchange = async () => {
    const file = f.cover.files[0];
    if (!file) return;
    try {
      cover = await uploadImage(file);
      Object.assign($('.pub-cover', f).style, { backgroundImage: `url('${cover}')` });
      $('.pub-cover', f).innerHTML = '';
    } catch (e) { err.textContent = e.message; }
  };
  $('[data-a="withdraw"]', f)?.addEventListener('click', async () => {
    try {
      const r = await api(`/api/modules/${m.id}/withdraw`, { on: !m.withdrawn });
      toast(r.module.withdrawn ? 'Withdrawn: it’s gone from the marketplace, and anyone who added it keeps it' : 'It’s back in the marketplace');
      w.close();
    } catch (e) { err.textContent = e.message; }
  });
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const include = {};
    for (const k of ['scenes', 'notes', 'handouts', 'sheets', 'audio']) include[k] = f[`inc-${k}`].checked;
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      const r = await api(`/api/games/${encodeURIComponent(store.room)}/publish`, {
        title: f.title.value, description: f.description.value, visibility: f.visibility.value, shareOk: f.shareOk.checked,
        include, pdfs: [...f.querySelectorAll('[name=pdf]:checked')].map((x) => x.value), cover,
      });
      toast(`Published “${r.module.title}” (version ${r.module.version}). It’s in the marketplace on My games.`);
      w.close();
    } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
  };
}
