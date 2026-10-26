// Combat tracker: initiative order, turns and rounds, hit points, conditions with durations.
import { $, esc, store, call, toast } from './util.js';
import { systemFor } from './systems.js';
import { roll } from './rolls.js';
import { getSelectedTokenId, requestDraw } from './map.js';

let socket;
let lastActive = null;
let pendingRender = false;

const CONDITIONS = {
  dnd5e: ['Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating', 'Blessed'],
  coc7: ['Major wound', 'Unconscious', 'Dying', 'Prone', 'Temporary insanity', 'Bout of madness'],
  tftl: ['Upset', 'Scared', 'Exhausted', 'Injured', 'Broken'],
  swade: ['Shaken', 'Distracted', 'Vulnerable', 'Stunned', 'Entangled', 'Bound', 'Prone', 'On Hold'],
  traveller: ['Stunned', 'Prone', 'Seriously wounded', 'Unconscious', 'In cover'],
  cpr: ['Seriously wounded', 'Mortally wounded', 'Prone', 'Grappled', 'In cover'],
  generic: ['Prone', 'Stunned', 'Poisoned', 'Unconscious', 'Hidden'],
};
// how a player rolls their own initiative (card-based and DEX-ordered games don't roll)
const INIT_DICE = { dnd5e: '1d20', generic: '1d20', traveller: '2d6', cpr: '1d10' };
const ruleset = () => store.settings?.ruleset || 'generic';
const sgn = (n) => (n >= 0 ? `+${n}` : `${n}`);

export function initCombat(s) {
  socket = s;
  socket.on('combat', (c) => {
    store.combat = c;
    // don't re-draw under the GM's cursor while they're typing in the tracker
    const focused = document.activeElement;
    if (focused && focused.closest('#combat-body') && focused.matches('input, select')) {
      if (!pendingRender) focused.addEventListener('blur', () => { pendingRender = false; setTimeout(render, 0); }, { once: true });
      pendingRender = true;
    } else render();
    requestDraw();
    // tell players when their turn comes round
    const active = c.active ? c.entries[c.turn] : null;
    if (active && active.id !== lastActive && controls(active) && !store.isGM) toast(`Your turn — ${active.name}`);
    lastActive = active?.id || null;
  });
  store.on('settings', render);
  store.on('sheets', render);
  // initiative rolled from a character sheet lands on that character's entry
  store.on('initiative-rolled', ({ sheetId, total }) => {
    const e = store.combat?.entries.find((x) => x.sheetId === sheetId);
    if (e && controls(e)) call(socket, 'combat:set-init', { id: e.id, value: total }).catch(() => {});
  });
  const panel = $('[data-panel=combat]');
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.dmg-in')) { e.preventDefault(); applyHp(e.target.closest('[data-id]').dataset.id, 1); }
    if (e.key === 'Enter' && e.target.matches('.add-name')) { e.preventDefault(); addByName(); }
    if (e.key === 'Enter' && e.target.matches('.cond-in')) { e.preventDefault(); addCondition(e.target.closest('[data-id]').dataset.id); }
  });
}

function controls(e) {
  if (store.isGM) return true;
  const t = e.tokenId && store.scene?.tokens.find((x) => x.id === e.tokenId);
  if (t && (t.owners || []).includes(store.me)) return true;
  const sh = e.sheetId && store.sheets.find((x) => x.id === e.sheetId);
  return !!(sh && sh.owner === store.me);
}

/** Build a tracker entry from a map token (and its linked sheet, if any). */
export function entryFromToken(t) {
  const sheet = t.sheetId && store.sheets.find((s) => s.id === t.sheetId);
  const sys = sheet && systemFor(sheet.system);
  const pc = (t.owners || []).some((o) => o && o !== '*') || !!sheet?.owner;
  return {
    name: t.label || sheet?.data?.name || 'Token', tokenId: t.id, sheetId: t.sheetId || null,
    side: pc ? 'pc' : 'npc', hidden: !!t.hidden,
    initMod: sys?.initMod ? sys.initMod(sheet.data) : 0,
    hp: sheet ? null : t.bar && t.bar.max ? { cur: t.bar.cur, max: t.bar.max } : null,
  };
}

export async function addTokens(tokens) {
  if (!tokens.length) return toast('No tokens to add', true);
  try {
    const r = await call(socket, 'combat:add', { entries: tokens.map(entryFromToken) });
    toast(r.ids.length ? `Added ${r.ids.length} to combat` : 'Already in combat');
  } catch (e) { toast(e.message, true); }
}

function addByName() {
  const input = $('[data-panel=combat] .add-name');
  const name = input.value.trim();
  if (!name) return;
  call(socket, 'combat:add', { name, side: 'npc' }).then(() => { input.value = ''; }, (e) => toast(e.message, true));
}

async function applyHp(id, sign) {
  const row = $(`[data-panel=combat] [data-id="${id}"]`);
  const v = Math.abs(Number(row.querySelector('.dmg-in').value));
  if (!v) return;
  try { await call(socket, 'combat:damage', { id, amount: v * sign }); } catch (e) { toast(e.message, true); }
}

function addCondition(id) {
  const row = $(`[data-panel=combat] [data-id="${id}"]`);
  const name = row.querySelector('.cond-in').value.trim();
  if (!name) return;
  const rounds = row.querySelector('.cond-rounds').value;
  const e = store.combat.entries.find((x) => x.id === id);
  call(socket, 'combat:update', { id, patch: { conditions: [...(e.conditions || []), { name, rounds: rounds === '' ? null : Number(rounds) }] } }).catch((er) => toast(er.message, true));
}

async function onClick(ev) {
  const b = ev.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  const id = b.closest('[data-id]')?.dataset.id;
  const e = id && store.combat.entries.find((x) => x.id === id);
  const go = (evt, p) => call(socket, evt, p).catch((er) => toast(er.message, true));
  switch (a) {
    case 'start': return go('combat:start', {});
    case 'next': return go('combat:next', { dir: 1 });
    case 'prev': return go('combat:next', { dir: -1 });
    case 'end': if (confirm('End combat? Initiative and conditions are cleared.')) go('combat:end', { removeNpcs: $('[data-panel=combat] .end-npcs')?.checked }); return;
    case 'clear': if (confirm('Remove everyone from the tracker?')) go('combat:end', { clearAll: true }); return;
    case 'roll-npcs': return go('combat:roll', { ids: store.combat.entries.filter((x) => x.side === 'npc' && x.init == null).map((x) => x.id) });
    case 'reroll': return go('combat:roll', { all: true });
    case 'add-selected': {
      const t = store.scene.tokens.find((x) => x.id === getSelectedTokenId());
      return t ? addTokens([t]) : toast('Click a token on the map first', true);
    }
    case 'add-all': return addTokens(store.scene.tokens.filter((t) => !store.combat.entries.some((x) => x.tokenId === t.id)));
    case 'add-name': return addByName();
    case 'remove': return go('combat:remove', { id });
    case 'hide': return go('combat:update', { id, patch: { hidden: !e.hidden } });
    case 'side': return go('combat:update', { id, patch: { side: e.side === 'pc' ? 'npc' : 'pc' } });
    case 'dmg': return applyHp(id, 1);
    case 'heal': return applyHp(id, -1);
    case 'cond-add': return addCondition(id);
    case 'cond-del': return go('combat:update', { id, patch: { conditions: e.conditions.filter((c) => c.id !== b.dataset.cid) } });
    case 'my-init': {
      const dice = INIT_DICE[ruleset()] || '1d20';
      const res = await roll(`${dice}${e.initMod ? sgn(e.initMod) : ''}`, { label: `${e.name}: initiative`, meta: { initiative: true } });
      if (res) go('combat:set-init', { id, value: res.total });
      return;
    }
    case 'open-sheet': return import('./sheets.js').then((m) => m.openSheet(e.sheetId));
    case 'open-ref': return import('./rules.js').then((m) => m.openEntry(e.ref.ruleset || 'dnd5e', 'monsters', e.ref.id));
    case 'focus': {
      const t = e.tokenId && store.scene.tokens.find((x) => x.id === e.tokenId);
      if (t) store.emit('ping', { x: t.x + (t.size * store.scene.map.gridSize) / 2, y: t.y + (t.size * store.scene.map.gridSize) / 2, color: '#e8a33d', name: e.name, local: true });
      return;
    }
    default:
  }
}

function onChange(ev) {
  const el = ev.target;
  const id = el.closest('[data-id]')?.dataset.id;
  if (!id || !store.isGM) return;
  const go = (patch) => call(socket, 'combat:update', { id, patch }).catch((er) => toast(er.message, true));
  if (el.matches('.init-in')) go({ init: el.value === '' ? null : Number(el.value) });
  if (el.matches('.hpmax-in')) {
    const e = store.combat.entries.find((x) => x.id === id);
    const max = Math.max(0, Number(el.value) || 0);
    go({ hp: max ? { cur: e.hp ? Math.min(e.hp.cur, max) || max : max, max, temp: e.hp?.temp || 0 } : null });
  }
  if (el.matches('.hpcur-in')) { const e = store.combat.entries.find((x) => x.id === id); go({ hp: { ...(e.hp || { max: Number(el.value) }), cur: Number(el.value) || 0 } }); }
  if (el.matches('.note-in')) go({ note: el.value });
  if (el.matches('.ac-in')) go({ ac: el.value });
  if (el.matches('.mod-in')) go({ initMod: Number(el.value) || 0 });
}

function hpCell(e) {
  if (store.isGM) {
    if (e.sheetId) {
      const sh = store.sheets.find((s) => s.id === e.sheetId);
      const bar = sh && systemFor(sh.system).bar?.(sh.data);
      return `<span class="hp sheet">${bar ? `${bar.cur}/${bar.max}` : '—'} <button class="lnk" data-a="open-sheet">sheet</button></span>`;
    }
    const pct = e.hp?.max ? Math.max(0, Math.min(1, e.hp.cur / e.hp.max)) : 0;
    return `<span class="hp">
      <input class="hpcur-in" type="number" value="${e.hp ? e.hp.cur : ''}" placeholder="HP" title="Current HP"><span class="muted">/</span><input class="hpmax-in" type="number" value="${e.hp ? e.hp.max : ''}" placeholder="max" title="Max HP">
      ${e.hp ? `<span class="hpbar"><span style="width:${pct * 100}%;background:${pct > 0.5 ? 'var(--green)' : pct > 0.25 ? 'var(--amber)' : 'var(--red)'}"></span></span>` : ''}
      ${e.hp ? `<input class="dmg-in" type="number" min="0" placeholder="±"><button class="b" data-a="dmg" title="Damage (Enter)">−</button><button class="b" data-a="heal" title="Heal">+</button>` : ''}
    </span>`;
  }
  if (e.side === 'pc' && e.sheetId) {
    const sh = store.sheets.find((s) => s.id === e.sheetId);
    const bar = sh && systemFor(sh.system).bar?.(sh.data);
    return bar ? `<span class="hp">${bar.cur}/${bar.max}</span>` : '';
  }
  if (e.hp) return `<span class="hp">${e.hp.cur}/${e.hp.max}</span>`;
  return e.status ? `<span class="status ${e.status.toLowerCase()}">${esc(e.status)}</span>` : '';
}

export function render() {
  const box = $('#combat-body');
  if (!box) return;
  const c = store.combat || { entries: [], active: false, round: 0, turn: 0 };
  const rs = ruleset();
  const gm = store.isGM;
  const kind = { dnd5e: 'roll', generic: 'roll', traveller: 'roll', cpr: 'roll', coc7: 'stat', tftl: 'cards', swade: 'deck' }[rs];
  const how = {
    roll: `Initiative: ${INIT_DICE[rs]} + modifier, highest first`,
    stat: 'Initiative: DEX order, highest first (readied firearms +50)',
    cards: 'Initiative: cards 1–10 dealt each round, lowest first',
    deck: 'Initiative: action cards dealt each round, highest first',
  }[kind];
  const active = c.active ? c.entries[c.turn] : null;
  const myTurn = active && !gm && controls(active);
  box.innerHTML = `
    <div class="combat-head">
      <div><b>${c.active ? `Round ${c.round}` : 'Not in combat'}</b>${active ? ` · <span class="muted">${esc(active.name)}'s turn</span>` : ''}<div class="muted small">${how}</div></div>
      <div class="row">${gm ? (c.active
        ? '<button class="btn" data-a="prev" title="Back a turn">◀</button><button class="btn primary" data-a="next">Next turn ▶</button><button class="btn ghost" data-a="end">End</button>'
        : '<button class="btn primary" data-a="start">Start combat</button>')
        : myTurn ? '<button class="btn primary" data-a="next">End my turn</button>' : ''}</div>
    </div>
    ${gm ? `<div class="row combat-add">
      <button class="btn" data-a="add-selected" title="Add the token you last clicked on the map">+ Selected token</button>
      <button class="btn" data-a="add-all">+ All tokens</button>
    </div>
    <div class="row combat-add"><input class="add-name" placeholder="Add by name, e.g. Bandit" maxlength="60"><button class="btn" data-a="add-name">Add</button></div>
    <div class="row small">${kind === 'roll' ? '<button class="btn ghost" data-a="roll-npcs">Roll NPC initiative</button>' : ''}
      ${c.entries.length ? `<button class="btn ghost" data-a="reroll">${kind === 'roll' ? 'Re-roll all' : kind === 'stat' ? 'Re-order by DEX' : 'Deal again'}</button>` : ''}
      <span style="flex:1"></span>${c.active ? '<label class="check small"><input type="checkbox" class="end-npcs"> remove NPCs when ending</label>' : c.entries.length ? '<button class="btn ghost danger" data-a="clear">Clear</button>' : ''}</div>` : ''}
    <ol class="combat-list">${c.entries.map((e, i) => {
      const isActive = c.active && i === c.turn;
      const mine = !gm && controls(e);
      return `<li data-id="${e.id}" class="${isActive ? 'active' : ''} ${e.hidden ? 'hidden-e' : ''} ${e.side} ${gm ? 'gm' : ''}">
        <div class="init">${gm ? `<input class="init-in" type="number" value="${e.init ?? ''}" title="Initiative${e.initLabel ? ` (${esc(e.initLabel)})` : ''}">`
          : e.init != null ? `<b>${e.initLabel ? esc(e.initLabel) : e.init}</b>` : mine && INIT_DICE[rs] ? '<button class="b" data-a="my-init">Roll</button>' : '<span class="muted">–</span>'}
          ${gm && e.initLabel ? `<span class="card">${esc(e.initLabel)}</span>` : ''}</div>
        <div class="who">
          <button class="name" data-a="focus" title="Show on the map">${esc(e.name)}</button>
          <span class="tags">${e.side === 'pc' ? '<span class="tag">PC</span>' : ''}${gm && e.hidden ? '<span class="tag">hidden</span>' : ''}
            ${gm && e.ac ? `<span class="muted small">AC <input class="ac-in" value="${esc(e.ac)}" maxlength="20"></span>` : ''}
            ${gm ? `<span class="muted small" title="Initiative modifier">mod <input class="mod-in" type="number" value="${e.initMod || 0}"></span>` : ''}
            ${e.ref ? '<button class="lnk" data-a="open-ref">stats</button>' : ''}${!gm && e.sheetId && mine ? '<button class="lnk" data-a="open-sheet">sheet</button>' : ''}</span>
          <div class="conds">${(e.conditions || []).map((cd) => `<span class="cond">${esc(cd.name)}${cd.rounds != null ? ` <small>${cd.rounds}</small>` : ''}${gm ? `<button data-a="cond-del" data-cid="${cd.id}" title="Remove">×</button>` : ''}</span>`).join('')}
            ${gm ? `<span class="cond-add"><input class="cond-in" list="cond-list" placeholder="+ condition"><input class="cond-rounds" type="number" min="1" placeholder="rds" title="Rounds (blank = until removed)"><button class="b" data-a="cond-add">+</button></span>` : ''}</div>
        </div>
        <div class="hpcell">${hpCell(e)}</div>
        ${gm ? `<div class="acts"><button class="b" data-a="side" title="Switch PC / NPC">${e.side === 'pc' ? 'PC' : 'NPC'}</button><button class="b" data-a="hide" title="${e.hidden ? 'Show to players' : 'Hide from players'}">${e.hidden ? '◌' : '●'}</button><button class="b" data-a="remove" title="Remove">✕</button></div>` : ''}
      </li>`;
    }).join('') || `<li class="empty muted">${gm ? 'Add tokens from the map, monsters from the Rules, or type a name.' : 'Nothing happening yet.'}</li>`}</ol>
    <datalist id="cond-list">${(CONDITIONS[rs] || CONDITIONS.generic).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
}
