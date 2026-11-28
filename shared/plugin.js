// Game plugins: a game's own character sheet, dice mechanics, rules text, map stamps and panels, described in a
// plugin.json rather than written as code. Nothing in a plugin runs on the server or in Lantern's own page: sheets
// are drawn by Lantern from the description, dice go through Lantern's dice engine, and a panel (an HTML page
// in the plugin) runs sealed off like a prop. Pure, so the server, the browser and the tests share it.
//
// plugin.json (format 1):
// {
//   "format": 1, "id": "hearth", "name": "Hearth & Hazard", "version": "1.0", "author": "…", "about": "…", "licence": "…",
//   "system": {                                   // a character sheet and a ruleset the GM can pick for a campaign
//     "about": "…", "init": { "dice": "2d6", "mod": "attrs.wits" }, "grid": { "unitsPerSquare": 1, "unitName": "m" },
//     "hp": { "cur": "harm", "max": "harmMax" },  // the bar on tokens and in combat
//     "sections": [
//       { "title": "Attributes", "columns": 4, "fields": [ { "key": "attrs.grit", "label": "Grit", "type": "number", "min": 0, "max": 3, "roll": "action" } ] },
//       { "title": "Gear", "list": { "key": "gear", "fields": [ { "key": "name", "label": "Item" }, { "key": "uses", "label": "Uses", "type": "track", "max": 3 } ] } },
//       { "title": "Rolls", "rolls": [ { "label": "Fortune", "roll": "fortune" } ] }
//     ],
//     "card": { "subtitle": ["calling"], "stats": ["attrs.grit", "…"], "extras": ["stress"] }
//   },
//   "rolls": {                                    // dice mechanics: {value} is the field's number, {path} any other
//     "action": { "dice": "{value}d6kh1", "fallback": "2d6kl1", "label": "{label}", "outcome": {
//       "bands": [ { "min": 6, "text": "Success", "tone": "good" }, { "min": 4, "max": 5, "text": "Success, at a cost", "tone": "partial" }, { "max": 3, "text": "Trouble", "tone": "bad" } ],
//       "crit": { "face": 6, "count": 2, "text": "Triumph!" } } }
//   },
//   "quickRolls": [ { "name": "Fortune", "dice": "1d6", "outcome": { … } } ],   // the Dice tab's buttons
//   "rules": [ { "name": "Rolling the dice", "text": "Markdown…" } ],           // or "rules.md" (split at # headings)
//   "stamps": [ { "name": "Blast", "shape": "circle", "size": 2 } ],             // circle, square, cone, line (squares)
//   "panels": [ { "name": "Clocks", "file": "clocks.html" } ]                   // sandboxed pages, like props
// }

export const PLUGIN_FORMAT = 1;
export const PLUGIN_LIMITS = { files: 200, bytes: 20 * 1024 * 1024, rulesChars: 300_000 };
export const FIELD_TYPES = ['text', 'number', 'textarea', 'select', 'check', 'track'];
export const STAMP_SHAPES = ['circle', 'square', 'cone', 'line'];
export const TONES = ['good', 'partial', 'bad', 'crit', 'neutral'];

const text = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
const line = (v, n) => text(v, n).replace(/\s+/g, ' ');
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const PATH = /^[a-zA-Z][a-zA-Z0-9_]{0,30}(\.[a-zA-Z0-9_]{1,31}){0,3}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const RESERVED = new Set(['name', 'portrait', 'card', 'tokenImage', '__proto__', 'constructor', 'prototype']);
const okPath = (p) => typeof p === 'string' && PATH.test(p) && !p.split('.').some((k) => RESERVED.has(k) && k !== 'name') && p !== 'name' && p !== 'portrait';
// dice templates: Lantern's notation plus {placeholders}; checked again by the dice engine when rolled
const DICE = /^[0-9dDkKhHlLsSwWpPbBcC!+\-*\s{}a-zA-Z_.]{1,80}$/;
const okDice = (v) => typeof v === 'string' && DICE.test(v.trim()) ? v.trim() : null;
const HEX = /^#[0-9a-f]{6}$/i;

/** A roll's outcome table, made safe: { bands: [{ min, max, text, tone }], crit: { face, count, text } | null }. */
export function cleanOutcome(o) {
  if (!o || typeof o !== 'object') return null;
  const bands = arr(o.bands, 8).map((b) => ({
    min: b?.min == null ? null : num(b.min, 0, -1000, 1000),
    max: b?.max == null ? null : num(b.max, 0, -1000, 1000),
    text: line(b?.text, 40),
    tone: TONES.includes(b?.tone) ? b.tone : 'neutral',
  })).filter((b) => b.text);
  const crit = o.crit && typeof o.crit === 'object' && line(o.crit.text, 40)
    ? { face: num(o.crit.face, 6, 1, 100), count: num(o.crit.count, 2, 1, 20), text: line(o.crit.text, 40) } : null;
  return bands.length || crit ? { bands, crit } : null;
}

/** Which band a total falls in (the first that fits), and whether the crit happened, from the dice faces rolled. */
export function outcomeOf(outcome, total, faces = []) {
  if (!outcome) return null;
  const crit = outcome.crit && faces.filter((f) => f === outcome.crit.face).length >= outcome.crit.count ? outcome.crit : null;
  const band = outcome.bands.find((b) => (b.min == null || total >= b.min) && (b.max == null || total <= b.max)) || null;
  return crit ? { text: crit.text, tone: 'crit' } : band ? { text: band.text, tone: band.tone } : null;
}

function cleanField(f, inList = false) {
  if (!f || typeof f !== 'object') return null;
  const key = inList ? (/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(f.key) && (f.key === 'name' || !RESERVED.has(f.key)) ? f.key : null) : okPath(f.key) ? f.key : null;
  if (!key) return null;
  const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
  const out = { key, label: line(f.label, 40) || key, type };
  if (type === 'number' || type === 'track') {
    out.min = num(f.min, 0, -9999, 9999);
    out.max = num(f.max, type === 'track' ? 6 : 9999, out.min, type === 'track' ? 20 : 99999);
    if (type === 'track') out.min = 0;
  }
  if (type === 'select') out.options = arr(f.options, 40).map((o) => line(o, 40)).filter(Boolean);
  if (type === 'select' && !out.options.length) out.type = 'text';
  if ('default' in f) out.default = type === 'number' || type === 'track' ? num(f.default, 0, -9999, 99999) : type === 'check' ? !!f.default : line(f.default, 200);
  if (typeof f.roll === 'string' && /^[a-z0-9_-]{1,24}$/i.test(f.roll)) out.roll = f.roll;
  if (f.wide) out.wide = true;
  return out;
}

function cleanSystem(s) {
  if (!s || typeof s !== 'object') return null;
  const sections = arr(s.sections, 24).map((x) => {
    const sec = { title: line(x?.title, 60), columns: num(x?.columns, 2, 1, 4) };
    if (x?.list && typeof x.list === 'object' && okPath(x.list.key)) {
      sec.list = { key: x.list.key, label: line(x.list.label, 30) || 'Row', fields: arr(x.list.fields, 8).map((f) => cleanField(f, true)).filter(Boolean) };
      if (!sec.list.fields.length) return null;
    } else {
      sec.fields = arr(x?.fields, 60).map((f) => cleanField(f)).filter(Boolean);
    }
    sec.rolls = arr(x?.rolls, 12).map((r) => ({ label: line(r?.label, 40), roll: typeof r?.roll === 'string' && /^[a-z0-9_-]{1,24}$/i.test(r.roll) ? r.roll : null })).filter((r) => r.label && r.roll);
    return sec.list || sec.fields.length || sec.rolls.length ? sec : null;
  }).filter(Boolean);
  if (!sections.length) return null;
  const paths = (v) => arr(v, 12).filter(okPath);
  return {
    about: line(s.about, 200),
    init: { dice: okDice(s.init?.dice) || '1d20', mod: okPath(s.init?.mod) ? s.init.mod : null },
    grid: { unitsPerSquare: num(s.grid?.unitsPerSquare, 1, 0.1, 1000), unitName: line(s.grid?.unitName, 8) || 'm' },
    hp: okPath(s.hp?.cur) && okPath(s.hp?.max) ? { cur: s.hp.cur, max: s.hp.max } : null,
    sections,
    card: { subtitle: paths(s.card?.subtitle).slice(0, 3), stats: paths(s.card?.stats).slice(0, 10), extras: paths(s.card?.extras).slice(0, 4) },
  };
}

/** Rules text: a list of { name, text } (Markdown), or one Markdown file split at its # headings. */
export function cleanRules(r) {
  let list = [];
  if (typeof r === 'string') {
    let cur = null;
    for (const l of r.replace(/\r/g, '').split('\n')) {
      const h = /^#{1,2}\s+(.+)$/.exec(l);
      if (h) { cur = { name: h[1], text: '' }; list.push(cur); } else if (cur) cur.text += `${l}\n`; else if (l.trim()) { cur = { name: 'About', text: `${l}\n` }; list.push(cur); }
    }
  } else list = arr(r, 80);
  let budget = PLUGIN_LIMITS.rulesChars;
  return list.slice(0, 80).map((e, i) => {
    const t = text(e?.text, Math.max(0, Math.min(20_000, budget)));
    budget -= t.length;
    return { id: `r${i}`, name: line(e?.name, 80) || `Rule ${i + 1}`, text: t.replace(/^\n+|\n+$/g, '') };
  }).filter((e) => e.text);
}

/**
 * A plugin.json made safe, or throws with what to fix. `files` = the plugin's file names, to check panels exist.
 * The result is what the server keeps and sends to the table.
 */
export function cleanManifest(m, files = []) {
  if (!m || typeof m !== 'object') throw new Error("plugin.json isn't a description of a plugin");
  if (Number(m.format ?? 1) !== PLUGIN_FORMAT) throw new Error(`This plugin is for a newer Lantern (format ${m.format}). Update Lantern first.`);
  const id = String(m.id || '').toLowerCase();
  if (!ID.test(id)) throw new Error('plugin.json needs an "id": lower-case letters, numbers and dashes, up to 24');
  const name = line(m.name, 60);
  if (!name) throw new Error('plugin.json needs a "name"');
  const rolls = {};
  for (const [k, r] of Object.entries(m.rolls && typeof m.rolls === 'object' ? m.rolls : {}).slice(0, 40)) {
    if (!/^[a-z0-9_-]{1,24}$/i.test(k) || !r || typeof r !== 'object') continue;
    const dice = okDice(r.dice);
    if (!dice) continue;
    rolls[k] = { dice, fallback: okDice(r.fallback), label: line(r.label, 60) || '{label}', outcome: cleanOutcome(r.outcome) };
  }
  const have = new Set(files);
  const out = {
    format: PLUGIN_FORMAT, id, name,
    version: line(m.version, 20) || '1', author: line(m.author, 60), about: text(m.about, 1000), licence: line(m.licence ?? m.license, 120),
    system: cleanSystem(m.system),
    rolls,
    quickRolls: arr(m.quickRolls, 16).map((q) => {
      const roll = typeof q?.roll === 'string' && rolls[q.roll] ? q.roll : null;
      const dice = roll ? null : okDice(q?.dice);
      return roll || dice ? { name: line(q?.name, 30) || 'Roll', roll, dice, outcome: roll ? null : cleanOutcome(q?.outcome) } : null;
    }).filter(Boolean),
    rules: cleanRules(m.rules),
    stamps: arr(m.stamps, 16).map((s) => ({
      name: line(s?.name, 30), shape: STAMP_SHAPES.includes(s?.shape) ? s.shape : 'circle', size: num(s?.size, 1, 0.5, 40), color: HEX.test(s?.color) ? s.color.toLowerCase() : null,
    })).filter((s) => s.name),
    panels: arr(m.panels, 12).map((p) => ({ name: line(p?.name, 40), file: typeof p?.file === 'string' ? p.file.replace(/^\.?\//, '') : '' }))
      .filter((p) => p.name && /^[\w ./-]{1,120}\.html?$/i.test(p.file) && !p.file.includes('..') && (!files.length || have.has(p.file))),
  };
  // sheet buttons must point at rolls that exist
  for (const sec of out.system?.sections || []) {
    for (const f of [...(sec.fields || []), ...(sec.list?.fields || [])]) if (f.roll && !rolls[f.roll]) delete f.roll;
    sec.rolls = sec.rolls.filter((r) => rolls[r.roll]);
  }
  if (!out.system && !Object.keys(rolls).length && !out.quickRolls.length && !out.rules.length && !out.stamps.length && !out.panels.length) {
    throw new Error('This plugin has nothing in it Lantern can use: add a system, rolls, rules, stamps or panels');
  }
  return out;
}

/** A plugin's ruleset id, from its key (a hash of its files): short enough for every place a ruleset is kept. */
export const pluginRuleset = (key) => `p:${key}`;
export const isPluginRuleset = (rs) => typeof rs === 'string' && /^p:[a-f0-9]{12}$/.test(rs);
export const keyOfRuleset = (rs) => (isPluginRuleset(rs) ? rs.slice(2) : null);

const get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setIn = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] && typeof x[k] === 'object') ? x[k] : (x[k] = {}); x[ks.at(-1)] = v; };
const blank = (f) => ('default' in f ? f.default : f.type === 'number' ? Math.max(0, f.min ?? 0) : f.type === 'track' ? 0 : f.type === 'check' ? false : f.type === 'select' ? f.options[0] : '');

/** A new character for a plugin's system. */
export function defaultsFor(system, name = 'New character') {
  const d = { name, portrait: null };
  for (const sec of system?.sections || []) {
    for (const f of sec.fields || []) setIn(d, f.key, blank(f));
    if (sec.list) setIn(d, sec.list.key, []);
  }
  return d;
}

/** A new row for a list section. */
export const rowFor = (list) => Object.fromEntries(list.fields.map((f) => [f.key, blank(f)]));

/**
 * The dice for one of a plugin's rolls, from a sheet: { expr, label } or { error }. `value` is the number in the
 * field the button sits by; {placeholders} are fields on the sheet. A pool that comes to no dice uses `fallback`.
 */
export function rollFor(roll, d = {}, { value = 0, label = '' } = {}) {
  if (!roll) return { error: "That roll isn't in this plugin" };
  const fill = (t) => t.replace(/\{([a-zA-Z0-9_.]{1,80})\}/g, (_, k) => (k === 'value' ? String(Number(value) || 0) : k === 'label' ? '' : String(Number(get(d, k)) || 0)))
    .replace(/\+\s*-/g, '-').replace(/-\s*-/g, '+').replace(/\s+/g, '');
  let expr = fill(roll.dice);
  const counts = [...expr.matchAll(/(^|[^0-9])(-?\d*)d/gi)].map((m) => (m[2] === '' ? 1 : Number(m[2])));
  if (counts.some((n) => n < 1)) {
    if (!roll.fallback) return { error: 'No dice to roll' };
    expr = fill(roll.fallback);
  }
  return { expr, label: (roll.label || '{label}').replace('{label}', label).trim() || label || expr };
}

/** What goes on a character card for a plugin's system (see cards.js). */
export function pluginCardFacts(system, d = {}) {
  const fieldOf = (p) => (system.sections || []).flatMap((s) => s.fields || []).find((f) => f.key === p);
  const show = (v) => (v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? '✓' : '—') : String(v));
  const short = (p) => { const l = fieldOf(p)?.label || p.split('.').at(-1); return l.length > 6 ? l.slice(0, 4).toUpperCase() : l; };
  return {
    name: line(d.name, 40) || 'Unnamed',
    subtitle: line((system.card?.subtitle || []).map((p) => get(d, p)).filter((v) => v != null && v !== '').join(' · '), 60),
    stats: (system.card?.stats || []).map((p) => [short(p), show(get(d, p))]),
    extras: (system.card?.extras || []).map((p) => [fieldOf(p)?.label || p, show(get(d, p))]),
  };
}
