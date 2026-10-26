// Campaign state beyond the map: ruleset choice, combat tracker and story notes.
// Pure-ish helpers; server.js wires them to sockets and handles permissions.
import crypto from 'node:crypto';

export const RULESETS = {
  generic: { name: 'Generic', init: { kind: 'roll', dice: '1d20' }, grid: { unitsPerSquare: 5, unitName: 'ft' } },
  dnd5e: { name: 'D&D 5e (SRD)', init: { kind: 'roll', dice: '1d20' }, grid: { unitsPerSquare: 5, unitName: 'ft' } },
  traveller: { name: 'Traveller', init: { kind: 'roll', dice: '2d6' }, grid: { unitsPerSquare: 1.5, unitName: 'm' } },
  coc7: { name: 'Call of Cthulhu 7e', init: { kind: 'stat' }, grid: { unitsPerSquare: 1, unitName: 'yd' } },
  tftl: { name: 'Tales from the Loop', init: { kind: 'cards10' }, grid: { unitsPerSquare: 1, unitName: 'm' } },
  cpr: { name: 'Cyberpunk RED', init: { kind: 'roll', dice: '1d10' }, grid: { unitsPerSquare: 2, unitName: 'm' } },
  swade: { name: 'Savage Worlds', init: { kind: 'deck' }, grid: { unitsPerSquare: 1, unitName: '"' } },
};

const uid = () => crypto.randomBytes(6).toString('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, def = 0, min = -1e6, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// ---------------------------------------------------------------- combat

export const freshCombat = () => ({ active: false, round: 0, turn: 0, entries: [], deck: null });

export function cleanEntry(e, existing = {}) {
  const out = { ...existing };
  if ('name' in e) out.name = str(e.name, 60).trim() || 'Combatant';
  if ('tokenId' in e) out.tokenId = typeof e.tokenId === 'string' ? e.tokenId.slice(0, 32) : null;
  if ('sheetId' in e) out.sheetId = typeof e.sheetId === 'string' ? e.sheetId.slice(0, 32) : null;
  if ('init' in e) out.init = e.init === null || e.init === '' ? null : num(e.init, null, -1000, 1000);
  if ('initMod' in e) out.initMod = num(e.initMod, 0, -100, 1000);
  if ('hidden' in e) out.hidden = !!e.hidden;
  if ('side' in e) out.side = e.side === 'pc' ? 'pc' : 'npc';
  if ('ac' in e) out.ac = e.ac === null || e.ac === '' ? null : str(String(e.ac), 20);
  if ('hp' in e) out.hp = e.hp && typeof e.hp === 'object' ? { cur: num(e.hp.cur, 0), max: num(e.hp.max, 0, 0), temp: num(e.hp.temp, 0, 0) } : null;
  if ('note' in e) out.note = str(e.note, 200);
  if ('ref' in e) out.ref = e.ref && typeof e.ref === 'object' ? { type: str(e.ref.type, 20), id: str(e.ref.id, 80), ruleset: str(e.ref.ruleset, 20) } : null;
  if ('conditions' in e) {
    out.conditions = (Array.isArray(e.conditions) ? e.conditions : []).slice(0, 20).map((c) => ({
      id: typeof c.id === 'string' ? c.id.slice(0, 16) : uid(),
      name: str(c.name, 40).trim() || 'Condition',
      rounds: c.rounds == null || c.rounds === '' ? null : num(c.rounds, null, 0, 999),
    }));
  }
  return out;
}

export function newEntry(e) {
  return cleanEntry({ name: 'Combatant', tokenId: null, sheetId: null, init: null, initMod: 0, hidden: false, side: 'npc', ac: null, hp: null, note: '', ref: null, conditions: [], ...e }, { id: uid() });
}

// Savage Worlds action deck: 52 cards + 2 jokers. Higher value acts first.
const SUITS = ['♣', '♦', '♥', '♠']; // low → high for ties
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
function newDeck() {
  const cards = [];
  RANKS.forEach((r, ri) => SUITS.forEach((s, si) => cards.push({ label: `${r}${s}`, value: ri * 4 + si + 1 })));
  cards.push({ label: 'Joker', value: 100, joker: true }, { label: 'Joker', value: 101, joker: true });
  return shuffle(cards);
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Turn order: highest first, except Year Zero cards (lowest first). Ties by initiative modifier, then name. */
export function sortEntries(c, ruleset) {
  const asc = RULESETS[ruleset]?.init.kind === 'cards10';
  const active = c.entries[c.turn]?.id;
  c.entries.sort((a, b) => {
    if (a.init == null && b.init == null) return a.name.localeCompare(b.name);
    if (a.init == null) return 1;
    if (b.init == null) return -1;
    return (asc ? a.init - b.init : b.init - a.init) || (b.initMod || 0) - (a.initMod || 0) || a.name.localeCompare(b.name);
  });
  if (active) c.turn = Math.max(0, c.entries.findIndex((e) => e.id === active));
}

/**
 * Give initiative to entries without one (or everyone, for card-based rulesets each round).
 * Returns lines describing what happened, for the GM's chat log.
 */
export function rollInitiative(c, ruleset, rollDie, { only = null, all = false } = {}) {
  const rs = RULESETS[ruleset] || RULESETS.generic;
  const lines = [];
  const targets = c.entries.filter((e) => (only ? only.includes(e.id) : all || e.init == null));
  if (rs.init.kind === 'roll') {
    const [n, sides] = rs.init.dice.split('d').map(Number);
    for (const e of targets) {
      let t = 0;
      for (let k = 0; k < n; k++) t += rollDie(sides);
      e.init = t + (e.initMod || 0);
      e.initLabel = null;
      lines.push(`${e.name}: ${rs.init.dice}${e.initMod ? (e.initMod > 0 ? `+${e.initMod}` : e.initMod) : ''} = ${e.init}`);
    }
  } else if (rs.init.kind === 'stat') {
    // Call of Cthulhu: act in DEX order (readied firearms count +50 — set that in the entry's modifier)
    for (const e of targets) { e.init = e.initMod || 0; e.initLabel = null; lines.push(`${e.name}: DEX ${e.init}`); }
  } else if (rs.init.kind === 'cards10') {
    // Year Zero: everyone draws from cards 1–10, lowest goes first
    const pool = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((v) => !c.entries.some((e) => !targets.includes(e) && e.init === v)));
    for (const e of targets) {
      e.init = pool.length ? pool.pop() : 10 + crypto.randomInt(1, 100) / 100;
      e.initLabel = `Card ${Math.floor(e.init)}`;
      lines.push(`${e.name}: card ${Math.floor(e.init)}`);
    }
  } else if (rs.init.kind === 'deck') {
    if (!c.deck || c.deck.length < targets.length) c.deck = newDeck();
    for (const e of targets) {
      const card = c.deck.pop();
      e.init = card.value; e.initLabel = card.label;
      if (card.joker) c.shuffleNext = true; // jokers mean a reshuffle at the end of the round
      lines.push(`${e.name}: ${card.label}${card.joker ? ' (+2 to all rolls this round!)' : ''}`);
    }
  }
  sortEntries(c, ruleset);
  return lines;
}

/** Advance the turn. Returns chat lines (new round, expired conditions). */
export function nextTurn(c, ruleset, rollDie, dir = 1) {
  const lines = [];
  if (!c.entries.length) return lines;
  if (dir < 0) {
    if (c.turn > 0) c.turn--;
    else if (c.round > 1) { c.round--; c.turn = c.entries.length - 1; }
    return lines;
  }
  c.turn++;
  if (c.turn >= c.entries.length) {
    c.turn = 0;
    c.round++;
    lines.push(`Round ${c.round}`);
    // tick down conditions that have a duration
    for (const e of c.entries) {
      for (const cond of e.conditions || []) if (cond.rounds != null) cond.rounds--;
      const expired = (e.conditions || []).filter((x) => x.rounds != null && x.rounds <= 0);
      if (expired.length) lines.push(`${e.name}: ${expired.map((x) => x.name).join(', ')} ended`);
      e.conditions = (e.conditions || []).filter((x) => !(x.rounds != null && x.rounds <= 0));
    }
    // card-based initiative is dealt fresh every round
    const kind = RULESETS[ruleset]?.init.kind;
    if (kind === 'deck' || kind === 'cards10') {
      if (kind === 'deck' && c.shuffleNext) { c.deck = newDeck(); c.shuffleNext = false; lines.push('Joker drawn last round — deck reshuffled'); }
      const dealt = rollInitiative(c, ruleset, rollDie, { all: true });
      lines.push(...dealt);
      c.turn = 0;
    }
  }
  return lines;
}

export function hpStatus(hp) {
  if (!hp || !hp.max) return null;
  const f = hp.cur / hp.max;
  if (hp.cur <= 0) return 'Down';
  if (f <= 0.25) return 'Critical';
  if (f <= 0.5) return 'Bloodied';
  if (f < 1) return 'Hurt';
  return 'Healthy';
}

/** What a viewer sees: GMs everything; players don't see hidden entries or NPC hit points. */
export function combatFor(c, viewer) {
  if (viewer.isGM) return c;
  const activeId = c.entries[c.turn]?.id;
  const entries = c.entries.filter((e) => !e.hidden).map((e) => (e.side === 'pc' ? e : { ...e, hp: null, ac: null, status: hpStatus(e.hp), note: '' }));
  const turn = Math.max(0, entries.findIndex((e) => e.id === activeId));
  return { active: c.active, round: c.round, turn: c.entries[c.turn]?.hidden ? -1 : turn, entries };
}

// ---------------------------------------------------------------- notes

export function cleanNote(n, existing = {}) {
  const out = { ...existing };
  if ('title' in n) out.title = str(n.title, 120).trim() || 'Untitled';
  if ('body' in n) {
    if (typeof n.body === 'string' && n.body.length > 200_000) throw new Error('Note too long');
    out.body = str(n.body, 200_000);
  }
  if ('folder' in n) out.folder = str(n.folder, 60).trim();
  if ('share' in n) {
    const s = n.share;
    out.share = s === 'all' ? 'all' : Array.isArray(s) && s.length ? [...new Set(s.map((x) => str(x, 32)).filter(Boolean))].slice(0, 50) : 'none';
  }
  return out;
}

export const noteVisible = (n, viewer) =>
  (n.owner === '' ? viewer.isGM : n.owner === viewer.name) || n.share === 'all' || (Array.isArray(n.share) && n.share.includes(viewer.name));
export const noteEditable = (n, viewer) => (n.owner === '' ? viewer.isGM : n.owner === viewer.name);
