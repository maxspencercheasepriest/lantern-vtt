// The dice designer: the whole set on show, each die able to have its own look, and any look mixed from the
// materials you've unlocked — the body of one, another's pattern painted over it, a rim from a third. Sets you like
// can be saved by name. At the table it's a window (Dice tab ▸ Your dice ▸ Dice designer…) that changes your dice in
// that game, with sets kept by the server's add-on (Lantern Plus: your login) or in this browser; Lantern Plus also
// mounts it on its account pages (mountDiceDesigner) with its own ctx.
import { openWindow, getWindow, call, toast, $, $$, esc, uploadImage } from './util.js';
import { FINISHES, PATTERNS, FONTS, DIE_SLOTS, cleanDiceStyle, cleanDiceSets, inkFor, groupOf, MAX_SETS } from '/shared/dicestyle.js';
import { previewDice } from './dicepaint.js';
import { THEMES } from '/shared/themes.js';

const KEY = 'lantern.diceSets';
const localSets = () => { try { return cleanDiceSets(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } };
const keepLocal = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* private mode */ } };
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const SLOT_NAMES = { d4: 'd4', d6: 'd6', d8: 'd8', d10: 'd10', d100: 'd100 (tens)', d12: 'd12', d20: 'd20' };
const GROUPS = [['finish', 'Finishes'], ['material', 'Materials'], ['gm', 'Game master materials'], ['season', 'Seasonal materials'], ['creator', 'Creator materials']];

let ctx = null;          // see mountDiceDesigner
let root = null;         // the element the designer's in
let slot = 'set';        // what's being edited: the whole set, or one die
let sets = [];
let onServer = false;    // true when sets are kept with your login

/** At the table: open the designer in a window. `c` = { get, apply, unlocks, socket } from mydice.js. */
export function openDesigner(c) {
  const w = openWindow('dice-designer', { title: 'Dice designer', width: 900, height: 700, onClose: () => { if (root === w.body) root = null; } });
  if (w.existed) return;
  w.el.classList.add('dd-window');
  mountDiceDesigner(w.body, {
    ...c,
    upload: uploadImage,
    loadSets: async () => { try { const r = await call(c.socket, 'dice:sets', {}); return r.sets; } catch { return null; } },
    saveSets: async (list) => (await call(c.socket, 'dice:sets:save', { sets: list })).sets,
    usedText: (name) => `Rolling with “${name}” in this game`,
    whereText: (server) => (server ? 'Your sets go with your login, into any game on this server.' : 'Your sets are kept in this browser, for any game you play here.'),
  });
}

/**
 * Put the designer in `el`. `c`: get() → your dice now; apply(style) uses (and saves) a new look; unlocks() →
 * { locked: { material: 'how to earn it' } } or null; upload(file) → '/uploads/…'; loadSets() → a list, or null to
 * keep sets in this browser; saveSets(list) → the saved list; usedText(name) and whereText(onServer) for the words.
 */
export function mountDiceDesigner(el, c) {
  ctx = c;
  root = el;
  slot = 'set';
  el.innerHTML = `
    <div class="dd">
      <canvas class="dd-preview" aria-label="Your dice set"></canvas>
      <div class="dd-slots" role="tablist">
        <button type="button" data-slot="set" class="active">Whole set</button>
        ${DIE_SLOTS.map((k) => `<button type="button" data-slot="${k}">${k}</button>`).join('')}
      </div>
      <div class="dd-cols">
        <div class="dd-edit">
          <div class="dd-themes"><span class="muted small">Dice to match a theme:</span>${Object.entries(THEMES).filter(([, t]) => t.dice).map(([k, t]) => `<button type="button" data-theme-dice="${k}" title="${esc(t.name)}">${t.icon}</button>`).join('')}</div>
          <label class="dd-own" hidden><input type="checkbox" id="dd-own"> <span></span></label>
          <div class="dd-fields">
            <label class="wide">Material <select data-f="finish"></select></label>
            <label>Colour <input type="color" data-f="body"></label>
            <label>Second colour <input type="color" data-f="body2"></label>
            <label>Numbers <input type="color" data-f="ink"></label>
            <label>Pattern <select data-f="pattern"></select></label>
            <label>Painted over it <select data-f="overlay"></select></label>
            <label>Its colour <input type="color" data-f="overlayColor"></label>
            <label>Rim round the faces <select data-f="rim"></select></label>
            <label>Number style <select data-f="font"></select></label>
            <label class="wide">Picture on the highest face
              <span class="row"><label class="btn ghost file small-btn">Choose…<input type="file" accept="image/*" hidden id="dd-pic"></label>
              <button type="button" class="btn ghost small-btn" id="dd-pic-clear" hidden>Remove</button></span>
            </label>
          </div>
          <p class="muted small" id="dd-hint"></p>
        </div>
        <div class="dd-sets">
          <h4>Your sets</h4>
          <form class="dd-save" autocomplete="off"><input id="dd-name" maxlength="40" placeholder="Name this set"><button class="btn primary small-btn" type="submit">Save set</button></form>
          <ul id="dd-list"></ul>
          <p class="muted small" id="dd-where"></p>
        </div>
      </div>
    </div>`;
  const body = el;
  $$('.dd-slots button', body).forEach((b) => { b.onclick = () => { slot = b.dataset.slot; render(); }; });
  $('[data-f="pattern"]', body).innerHTML = Object.entries(PATTERNS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('[data-f="font"]', body).innerHTML = Object.entries(FONTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  fillSelects();
  for (const el of $$('[data-f]', body)) {
    el.addEventListener(el.type === 'color' ? 'input' : 'change', () => change(el.dataset.f, el.value));
  }
  $('#dd-own', body).onchange = (e) => {
    const s = structuredClone(ctx.get());
    const { dice, ...base } = s;
    s.dice = { ...(dice || {}) };
    if (e.target.checked) s.dice[slot] = base; else delete s.dice[slot];
    ctx.apply(s);
    render();
  };
  $('#dd-pic', body).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { change('picture', await ctx.upload(file)); } catch (err) { toast(err.message || "That picture didn't upload", true); }
  };
  $('#dd-pic-clear', body).onclick = () => change('picture', null);
  // a theme's matching dice, for the whole set or the die being edited (keeping its picture)
  $('.dd-themes', body).onclick = (e) => {
    const b = e.target.closest('[data-theme-dice]');
    if (!b) return;
    const s = structuredClone(ctx.get());
    const look = { ...THEMES[b.dataset.themeDice].dice };
    if (slot === 'set') { const { dice } = s; ctx.apply({ ...look, picture: s.picture || null, ...(dice ? { dice } : {}) }); }
    else { s.dice = { ...(s.dice || {}), [slot]: { ...look, picture: s.dice?.[slot]?.picture || null } }; ctx.apply(s); }
    render();
  };
  $('.dd-save', body).onsubmit = (e) => { e.preventDefault(); saveAs($('#dd-name', body).value); };
  $('#dd-list', body).onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = sets.findIndex((x) => x.id === b.closest('li').dataset.id);
    if (i < 0) return;
    if (b.dataset.act === 'use') { useSet(sets[i]); return; }
    if (b.dataset.act === 'update') { sets[i] = { ...sets[i], style: ctx.get() }; storeSets(`Updated “${sets[i].name}”`); return; }
    if (b.dataset.act === 'delete') { const [gone] = sets.splice(i, 1); storeSets(`Deleted “${gone.name}”`); }
  };
  loadSets();
  render();
}

/** The materials you've unlocked changed (Lantern Plus): refresh the lists if the designer's open. */
export function designerUnlocks() { if (root?.isConnected) { fillSelects(); render(); } }
/** Your dice changed somewhere else (the Dice tab): show them. */
export function designerRefresh() { if (root?.isConnected) render(); }

const el = (f) => $(`.dd [data-f="${f}"]`, root);
const locked = () => ctx.unlocks()?.locked || {};

function fillSelects() {
  const lock = locked();
  const opt = (k, v) => `<option value="${k}"${lock[k] ? ' disabled' : ''}>${lock[k] ? `🔒 ${esc(v.label)} — ${esc(lock[k])}` : esc(v.label)}</option>`;
  const all = Object.entries(FINISHES);
  el('finish').innerHTML = GROUPS.map(([g, label]) => `<optgroup label="${label}">${all.filter(([k]) => groupOf(k) === g).map(([k, v]) => opt(k, v)).join('')}</optgroup>`).join('');
  const mats = GROUPS.slice(1).map(([g, label]) => `<optgroup label="${label}">${all.filter(([k]) => groupOf(k) === g).map(([k, v]) => opt(k, v)).join('')}</optgroup>`).join('');
  el('overlay').innerHTML = `<option value="">Nothing</option>${mats}`;
  el('rim').innerHTML = `<option value="">As the material has it</option>${mats}`;
}

/** The look being edited: the set's own, or one die's. */
function editing() {
  const s = ctx.get();
  if (slot === 'set') { const { dice, ...base } = s; return base; }
  return s.dice?.[slot] || null;
}

function change(f, v) {
  const s = structuredClone(ctx.get());
  let look = slot === 'set' ? s : s.dice?.[slot];
  if (!look) return;
  if (f === 'overlay' || f === 'rim' || f === 'picture') look[f] = v || null;
  else if (f === 'font') look.font = v === 'auto' ? undefined : v;
  else look[f] = v;
  if (f === 'body' && look.ink === inkFor(editing().body)) look.ink = inkFor(v); // keep automatic numbers readable
  if (f === 'finish' && FINISHES[v]?.colors) {
    // a material starts in its own colours; change them after if you like
    const [body, body2, ink] = FINISHES[v].colors;
    Object.assign(look, { body, body2, ink, pattern: 'plain' });
    if (look.overlay === v) look.overlay = null;
  }
  if (f === 'overlay' && v) look.overlayColor = FINISHES[v].colors[1];
  ctx.apply(s);
  render();
}

function render() {
  if (!root?.isConnected) return;
  const body = root, s = ctx.get();
  $$('.dd-slots button', body).forEach((b) => {
    b.classList.toggle('active', b.dataset.slot === slot);
    b.classList.toggle('own', b.dataset.slot !== 'set' && !!s.dice?.[b.dataset.slot]);
  });
  const own = $('.dd-own', body);
  own.hidden = slot === 'set';
  const mine = slot !== 'set' && !!s.dice?.[slot];
  $('#dd-own', body).checked = mine;
  $('span', own).textContent = `Give the ${SLOT_NAMES[slot] || slot} a look of its own`;
  const look = editing() || (() => { const { dice, ...base } = s; return base; })();
  const off = slot !== 'set' && !mine;
  $('.dd-fields', body).classList.toggle('off', off);
  for (const f of ['finish', 'body', 'body2', 'ink', 'pattern', 'overlayColor']) el(f).value = look[f] || (f === 'overlayColor' ? '#ffffff' : '');
  el('overlay').value = look.overlay || '';
  el('rim').value = look.rim || '';
  el('font').value = look.font || 'auto';
  for (const x of $$('[data-f], #dd-pic', body)) x.disabled = off || (x.dataset.f === 'overlayColor' && !look.overlay);
  // keep locked options unpickable even after a refill
  for (const sel of ['finish', 'overlay', 'rim']) for (const o of el(sel).options) if (locked()[o.value]) o.disabled = true;
  $('#dd-pic-clear', body).hidden = off || !look.picture;
  const owners = Object.keys(s.dice || {});
  $('#dd-hint', body).textContent = slot === 'set'
    ? (owners.length ? `The whole set, apart from ${owners.join(', ')} (they have looks of their own).` : 'Every die in the set looks like this. Pick a die above to give it a look of its own.')
    : mine ? `Only the ${SLOT_NAMES[slot]} looks like this.` : `The ${SLOT_NAMES[slot]} looks like the rest of the set.`;
  previewDice($('.dd-preview', body), s, { set: true, focus: slot === 'set' ? null : slot }).catch((e) => console.warn('[dice designer]', e));
  renderSets();
}

// ---------- saved sets ----------
async function loadSets() {
  const got = await ctx.loadSets().catch(() => null);
  onServer = Array.isArray(got);
  sets = onServer ? cleanDiceSets(got) : localSets();
  // sets made in this browser before you had a login come along the first time
  if (onServer && !sets.length && localSets().length) { sets = localSets(); storeSets(); }
  renderSets();
}

async function storeSets(msg) {
  sets = cleanDiceSets(sets);
  if (onServer) {
    try { sets = cleanDiceSets(await ctx.saveSets(sets)) || sets; } catch (e) { toast(e.message, true); return; }
  } else keepLocal(sets);
  renderSets();
  if (msg) toast(msg);
}

function saveAs(name) {
  name = String(name || '').trim();
  if (!name) { toast('Give the set a name first', true); return; }
  const same = sets.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (same) same.style = ctx.get();
  else {
    if (sets.length >= MAX_SETS) { toast(`You can keep ${MAX_SETS} sets: delete one first`, true); return; }
    sets.push({ id: newId(), name, style: ctx.get() });
  }
  $('#dd-name', root).value = '';
  storeSets(same ? `Updated “${name}”` : `Saved “${name}”`);
}

function useSet(x) {
  const lock = locked();
  const style = cleanDiceStyle(x.style);
  const missing = [style.finish, style.overlay, style.rim, ...Object.values(style.dice || {}).flatMap((d) => [d.finish, d.overlay, d.rim])].find((k) => k && lock[k]);
  if (missing) { toast(`That set uses ${FINISHES[missing].label}, which isn't unlocked here yet: ${lock[missing]}`, true); return; }
  ctx.apply(style);
  render();
  toast(ctx.usedText(x.name));
}

function renderSets() {
  if (!root?.isConnected) return;
  const w = { body: root };
  const now = JSON.stringify(ctx.get());
  $('#dd-list', w.body).innerHTML = sets.length ? sets.map((x) => {
    const st = x.style, on = JSON.stringify(cleanDiceStyle(x.style)) === now;
    return `<li data-id="${x.id}" class="${on ? 'on' : ''}">
      <span class="dd-swatch" style="--a:${st.body};--b:${st.overlay ? st.overlayColor : st.body2};--c:${st.ink}"></span>
      <span class="dd-name">${esc(x.name)}${on ? ' <em>· using</em>' : ''}<small>${esc(FINISHES[st.finish]?.label || '')}${Object.keys(st.dice || {}).length ? ` + ${Object.keys(st.dice).length} more` : ''}</small></span>
      ${on ? '' : '<button type="button" class="btn small-btn" data-act="use">Use</button>'}
      <button type="button" class="btn ghost small-btn" data-act="update" title="Save your dice as they are now into this set">Update</button>
      <button type="button" class="btn ghost small-btn" data-act="delete" title="Delete this set">✕</button>
    </li>`;
  }).join('') : '<li class="muted small">No sets yet. Make some dice you like and give them a name.</li>';
  $('#dd-where', w.body).textContent = ctx.whereText(onServer);
}
