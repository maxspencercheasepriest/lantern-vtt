// The campaign page (like a Roll20 game's page): a picture, the title, which game, when the next session is,
// a description, everyone who has played (and how often), and write-ups of each session with replies.
// Everyone can read it and write up a session; the GM edits the rest. Opened from the "Campaign" button
// next to the campaign's name. The server keeps it in room.page / room.played (see pageFor in server.js).
import { $, esc, store, call, toast, openWindow, uploadImage } from './util.js';
import { renderMarkdown } from './markdown.js';
import { serverUrl } from './net.js';

let socket;
let page = null;
let editing = false;     // the GM's edit mode for the top of the page
let writing = null;      // { id? } while writing or editing a session write-up
const openReplies = new Set();

const RULESET_NAMES = { dnd5e: 'D&D 5e', coc7: 'Call of Cthulhu', traveller: 'Traveller', tftl: 'Tales from the Loop', cpr: 'Cyberpunk RED', swade: 'Savage Worlds', generic: 'Generic' };
const titleOf = (p) => p.title || p.id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function initCampaign(s) {
  socket = s;
  socket.on('page', (p) => { page = p; if (isOpen()) render(); });
  const btn = $('#campaign-btn');
  if (btn) btn.onclick = openCampaignPage;
}

const isOpen = () => !!document.querySelector('.window .cp');

export function openCampaignPage() {
  const w = openWindow('campaign', { title: 'Campaign', width: 820, height: 860, onClose: () => { editing = false; writing = null; } });
  if (w.existed) return;
  w.body.classList.add('cp-win');
  w.body.innerHTML = '<div class="cp"></div>';
  render();
}

// ---------- dates ----------
const dayName = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function fromNow(ms) {
  const mins = Math.round((ms - Date.now()) / 60000);
  const days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (mins < -180) return days >= -1 ? 'yesterday' : `${-days} days ago`;
  if (mins < 0) return 'happening now';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  if (days === 0) return `today, in ${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}`;
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}
const localInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** A calendar file for the next session, so everyone can put it in their own calendar. */
function icsFor(p) {
  const start = new Date(p.nextSession);
  const end = new Date(start.getTime() + 3 * 3600e3);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lantern VTT//EN', 'BEGIN:VEVENT', `UID:${p.id}-${f(start)}@lantern`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${titleOf(p).replace(/[,;\\]/g, ' ')}`, `DESCRIPTION:Next game of ${titleOf(p).replace(/[,;\\]/g, ' ')} (Lantern)`, `URL:${location.origin}`,
    'END:VEVENT', 'END:VCALENDAR'];
  return URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
}

// ---------- the page ----------
function render() {
  const root = document.querySelector('.window .cp');
  if (!root) return;
  if (!page) { root.innerHTML = '<p class="muted pad">Loading…</p>'; return; }
  const p = page, gm = store.isGM;
  const banner = p.banner ? serverUrl(p.banner) : p.thumb ? serverUrl(`/api/campaign-thumb?t=${encodeURIComponent(store.uploadToken)}&v=${Date.now() >> 16}`) : '';
  const next = p.nextSession ? new Date(p.nextSession) : null;
  const upcoming = next && next.getTime() > Date.now() - 3 * 3600e3;
  const log = [...p.log].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  root.innerHTML = `
    <div class="cp-banner" ${banner ? `style="background-image:url('${esc(banner)}')"` : ''}>
      ${banner ? '' : '<div class="cp-noban">No picture yet</div>'}
      <h1 class="cp-title">${esc(titleOf(p))}</h1>
    </div>
    ${editing ? editForm(p) : ''}
    <div class="cp-cols">
      <div class="cp-main">
        <div class="cp-meta">
          ${p.ruleset ? `<span class="cp-chip">${esc(RULESET_NAMES[p.ruleset] || p.ruleset)}</span>` : ''}
          ${p.lookingForPlayers ? '<span class="cp-chip lfp">Looking for players</span>' : ''}
          <span class="muted small">${p.sessions ? `${p.sessions} session${p.sessions === 1 ? '' : 's'} played` : 'No sessions played yet'}${p.log.length ? ` · ${p.log.length} write-up${p.log.length === 1 ? '' : 's'}` : ''}</span>
          <span class="grow"></span>
          ${gm && !editing ? '<button class="btn" data-a="edit">Edit page</button>' : ''}
        </div>
        <div class="cp-next">
          ${upcoming ? `
            <div class="cp-cal"><span class="m">${next.toLocaleDateString('en-GB', { month: 'short' })}</span><b>${next.getDate()}</b><span class="d">${next.toLocaleDateString('en-GB', { weekday: 'long' })}</span></div>
            <div class="cp-when"><div class="muted small">Next game will be</div>
              <div class="big">${esc(next.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}, ${esc(next.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }))}</div>
              <div class="muted small">${esc(fromNow(next.getTime()))} · <a href="${icsFor(p)}" download="${esc(p.id)}-next-game.ics">Add to my calendar</a></div></div>`
            : `<div class="cp-when muted">${gm ? 'No next game set. <button class="linkish" data-a="edit">Pick a date</button>' : 'No date set for the next game yet.'}</div>`}
        </div>
        <section class="cp-desc">
          ${p.description ? `<div class="md">${renderMarkdown(p.description)}</div>` : `<p class="muted">${gm ? 'No description yet. <button class="linkish" data-a="edit">Write one</button>: what the campaign is about, the house rules, where you meet.' : 'The GM hasn’t written a description yet.'}</p>`}
        </section>
        <section class="cp-log">
          <div class="cp-log-head"><h2>Session write-ups</h2><span class="grow"></span>${writing && !writing.id ? '' : '<button class="btn primary" data-a="write">＋ Write up a session</button>'}</div>
          ${writing && !writing.id ? writeForm(null) : ''}
          ${log.length ? log.map((e) => entryHtml(e)).join('') : (writing ? '' : '<p class="muted">Nothing written up yet. After a game, anyone can write what happened, so you’ll all remember next time.</p>')}
        </section>
      </div>
      <aside class="cp-side">
        <h2>${p.players.length} ${p.players.length === 1 ? 'player' : 'players'}</h2>
        ${p.players.length ? `<ul class="cp-players">${p.players.map((u) => `
          <li><span class="cp-av" style="background:${esc(u.color || '#888')}">${esc((u.name[0] || '?').toUpperCase())}</span>
            <span><b>${esc(u.name)}</b>${u.gm ? ' <span class="cp-gm">GM</span>' : ''}<br>
            <span class="muted small">${u.sessions} session${u.sessions === 1 ? '' : 's'} · last ${esc(dayName(u.last))}</span></span></li>`).join('')}</ul>`
          : '<p class="muted small">Everyone who plays shows up here, with how many sessions they’ve been to. A day counts once at least two of you are in the game.</p>'}
      </aside>
    </div>`;
  wire(root);
}

function editForm(p) {
  return `<form class="cp-edit">
    <label>Title <input name="title" maxlength="80" value="${esc(p.title)}" placeholder="${esc(titleOf({ ...p, title: '' }))}"></label>
    <div class="cp-row">
      <label>Next game <input name="next" type="datetime-local" value="${esc(localInput(p.nextSession))}"></label>
      <label class="check"><input name="lfp" type="checkbox" ${p.lookingForPlayers ? 'checked' : ''}> Looking for players</label>
    </div>
    <label>Description <span class="muted small">(Markdown: **bold**, *italic*, # headings, - lists, [[links]] to notes)</span>
      <textarea name="desc" rows="8" maxlength="20000">${esc(p.description)}</textarea></label>
    <div class="cp-row">
      <label class="btn file">Choose a picture…<input name="pic" type="file" accept="image/*" hidden></label>
      ${p.banner ? '<button type="button" class="linkish" data-a="nopic">Use the last scene instead</button>' : '<span class="muted small">Until you choose one, the picture is where you left off.</span>'}
      <span class="grow"></span>
      <button type="button" class="btn" data-a="cancel">Cancel</button>
      <button class="btn primary">Save</button>
    </div>
  </form>`;
}

function writeForm(e) {
  const n = page.log.length + 1;
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `<form class="cp-write" data-id="${e ? e.id : ''}">
    <div class="cp-row"><input name="title" maxlength="100" placeholder="Title" value="${esc(e ? e.title : `Session ${n}: plot summary`)}"><input name="date" type="date" value="${esc(e ? e.date : iso)}"></div>
    <textarea name="text" rows="8" maxlength="20000" placeholder="What happened? Who did they meet, what did they find, what's still unanswered…">${esc(e ? e.text : '')}</textarea>
    <div class="cp-row"><span class="muted small">Markdown works: **bold**, *italic*, - lists.</span><span class="grow"></span><button type="button" class="btn" data-a="unwrite">Cancel</button><button class="btn primary">${e ? 'Save' : 'Post'}</button></div>
  </form>`;
}

function entryHtml(e) {
  if (writing?.id === e.id) return `<article class="cp-entry">${writeForm(e)}</article>`;
  const mine = store.isGM || e.by === store.me;
  const open = openReplies.has(e.id);
  return `<article class="cp-entry" data-id="${e.id}">
    <header><h3>${esc(e.title)}</h3><span class="muted small">${esc(dayName(e.date))} · by ${esc(e.by)}${e.edited ? ' · edited' : ''}</span>
      <span class="grow"></span>${mine ? '<button class="iconbtn" data-a="editlog" title="Edit">✎</button><button class="iconbtn" data-a="dellog" title="Delete (click twice)">✕</button>' : ''}</header>
    <div class="md">${renderMarkdown(e.text)}</div>
    <footer><button class="linkish" data-a="replies">${e.replies.length ? `${e.replies.length} repl${e.replies.length === 1 ? 'y' : 'ies'}` : 'Reply'} ${open ? '▾' : '▸'}</button></footer>
    ${open ? `<div class="cp-replies">
      ${e.replies.map((r) => `<div class="cp-reply" data-reply="${r.id}"><b>${esc(r.by)}</b> <span class="muted small">${esc(new Date(r.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>
        ${store.isGM || r.by === store.me ? '<button class="iconbtn" data-a="delreply" title="Delete">✕</button>' : ''}<div class="md">${renderMarkdown(r.text)}</div></div>`).join('')}
      <form class="cp-replyform"><textarea name="text" rows="2" maxlength="4000" placeholder="Add a reply…"></textarea><button class="btn">Reply</button></form>
    </div>` : ''}
  </article>`;
}

function wire(root) {
  const fail = (e) => toast(e.message, true);
  root.querySelectorAll('[data-a="edit"]').forEach((b) => (b.onclick = () => { editing = true; render(); }));
  const ef = root.querySelector('.cp-edit');
  if (ef) {
    let picture;
    ef.querySelector('[data-a="cancel"]').onclick = () => { editing = false; render(); };
    ef.querySelector('[data-a="nopic"]')?.addEventListener('click', () => { picture = null; call(socket, 'page:update', { banner: null }).catch(fail); });
    ef.pic.onchange = async () => {
      const f = ef.pic.files[0];
      if (!f) return;
      try { picture = await uploadImage(f); toast('Picture ready: press Save'); } catch (e) { fail(e); }
    };
    ef.onsubmit = (ev) => {
      ev.preventDefault();
      const patch = { title: ef.title.value, description: ef.desc.value, lookingForPlayers: ef.lfp.checked, nextSession: ef.next.value ? new Date(ef.next.value).toISOString() : null };
      if (picture) patch.banner = picture;
      call(socket, 'page:update', patch).then(() => { editing = false; render(); toast('Campaign page saved'); }).catch(fail);
    };
  }
  root.querySelector('[data-a="write"]')?.addEventListener('click', () => { writing = {}; render(); root.querySelector('.cp-write textarea')?.focus(); });
  root.querySelectorAll('.cp-write').forEach((f) => {
    f.querySelector('[data-a="unwrite"]').onclick = () => { writing = null; render(); };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const body = { title: f.title.value, date: f.date.value, text: f.text.value };
      const id = f.dataset.id;
      call(socket, id ? 'page:log:edit' : 'page:log:add', id ? { id, ...body } : body)
        .then(() => { writing = null; render(); toast(id ? 'Saved' : 'Thanks: it’s on the page for everyone'); }).catch(fail);
    };
  });
  root.querySelectorAll('.cp-entry[data-id]').forEach((a) => {
    const id = a.dataset.id;
    a.querySelector('[data-a="editlog"]')?.addEventListener('click', () => { writing = { id }; render(); });
    const del = a.querySelector('[data-a="dellog"]');
    if (del) del.onclick = () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Delete?'; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '✕'; } }, 4000); return; }
      call(socket, 'page:log:delete', { id }).catch(fail);
    };
    a.querySelector('[data-a="replies"]').onclick = () => { openReplies.has(id) ? openReplies.delete(id) : openReplies.add(id); render(); };
    a.querySelectorAll('[data-a="delreply"]').forEach((b) => (b.onclick = () => call(socket, 'page:reply:delete', { id, reply: b.closest('[data-reply]').dataset.reply }).catch(fail)));
    const rf = a.querySelector('.cp-replyform');
    if (rf) rf.onsubmit = (ev) => { ev.preventDefault(); call(socket, 'page:reply', { id, text: rf.text.value }).catch(fail); };
  });
}
