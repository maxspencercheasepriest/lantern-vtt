// Character cards: a trading-card picture of a character (the card designer, carddesigner.js), with the facts that
// matter in their game. Pure, so the server and Lantern Plus can check designs too.
import { THEMES } from './themes.js';

const HEX = /^#[0-9a-f]{6}$/i;
const PIC = /^\/uploads\/[a-f0-9]{16,40}\.(png|jpe?g|webp|gif)$/;
const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const val = (v) => (v == null || v === '' ? '—' : String(v));

export const CARD_LAYOUTS = { classic: 'Classic (picture on top)', full: 'Full picture', framed: 'Framed portrait' };
/** Game plugins' card facts by ruleset id (the browser's plugins.js fills this in). */
export const CARD_PLUGINS = {};
export const CARD_SYSTEM_NAMES = { dnd5e: 'D&D 5e', coc7: 'Call of Cthulhu', traveller: 'Traveller', cpr: 'Cyberpunk RED', swade: 'Savage Worlds', tftl: 'Tales from the Loop', generic: '' };

/**
 * What goes on a character's card, from their sheet: { name, subtitle, stats: [[label, value]] (up to 10), extras:
 * [[label, value]] (up to 4) }.
 */
export function cardFacts(system, d = {}) {
  if (CARD_PLUGINS[system]) return CARD_PLUGINS[system](d);
  const name = text(d.name, 40) || 'Unnamed';
  const pick = (obj, keys, f = (x) => x) => keys.map((k) => [k, val(f(obj?.[k]))]);
  switch (system) {
    case 'dnd5e':
      return { name, subtitle: text([d.race, d.classLevel, d.level ? `level ${d.level}` : ''].filter(Boolean).join(' · '), 60),
        stats: pick(d.abilities, ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']), extras: [['AC', val(d.ac)], ['HP', `${val(d.hp)}/${val(d.hpMax)}`], ['Speed', val(d.speed)]] };
    case 'coc7':
      return { name, subtitle: text([d.occupation, d.age ? `age ${d.age}` : ''].filter(Boolean).join(' · '), 60),
        stats: pick(d.chars, ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU']), extras: [['HP', val(d.hp)], ['Sanity', val(d.san)], ['Luck', val(d.luck)], ['MP', val(d.mp)]] };
    case 'traveller':
      return { name, subtitle: text([d.species, d.career, d.age ? `age ${d.age}` : ''].filter(Boolean).join(' · '), 60),
        stats: pick(d.chars, ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'], (c) => c?.cur ?? c?.max), extras: [] };
    case 'cpr':
      return { name: text(d.handle, 40) || name, subtitle: text([d.handle ? name : '', d.role, d.roleRank ? `rank ${d.roleRank}` : ''].filter(Boolean).join(' · '), 60),
        stats: pick(d.stats, ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP']), extras: [['HP', `${val(d.hp)}/${val(d.hpMax)}`], ['Humanity', val(d.humanity)]] };
    case 'swade':
      return { name, subtitle: text([d.concept, d.rank, d.wildCard ? 'Wild Card' : ''].filter(Boolean).join(' · '), 60),
        stats: Object.entries(d.attrs || {}).slice(0, 5).map(([k, v]) => [k, `d${v}`]), extras: [['Pace', val(d.pace)], ['Bennies', val(d.bennies)]] };
    case 'tftl':
      return { name, subtitle: text([d.type, d.age ? `age ${d.age}` : ''].filter(Boolean).join(' · '), 60),
        stats: Object.entries(d.attrs || {}).slice(0, 4).map(([k, v]) => [k, val(v)]), extras: [['Luck', val(d.luck)], ...(d.iconic?.name ? [['Iconic item', text(d.iconic.name, 24)]] : [])] };
    default:
      return { name, subtitle: '', stats: (Array.isArray(d.fields) ? d.fields : []).slice(0, 8).map((f) => [text(f.label, 14) || '?', val(text(f.value, 12))]), extras: d.hpMax ? [['HP', `${val(d.hp)}/${val(d.hpMax)}`]] : [] };
  }
}

/** A card design, made safe. */
export function cleanCardDesign(x = {}) {
  const t = Object.hasOwn(THEMES, x?.theme) ? x.theme : 'fantasy';
  return {
    theme: t,
    layout: Object.hasOwn(CARD_LAYOUTS, x?.layout) ? x.layout : 'classic',
    c1: HEX.test(x?.c1) ? x.c1.toLowerCase() : null,       // frame colour (null: the theme's)
    c2: HEX.test(x?.c2) ? x.c2.toLowerCase() : null,       // accent
    tagline: text(x?.tagline, 90),
    showStats: x?.showStats !== false,
    zoom: num(x?.zoom, 1, 0.3, 5), ox: num(x?.ox, 0, -1.5, 1.5), oy: num(x?.oy, 0, -1.5, 1.5),
    photo: typeof x?.photo === 'string' && PIC.test(x.photo) ? x.photo : null, // a picture other than the sheet's portrait
  };
}

/** The frame's colours for a theme: [frame, accent, ink, background]. */
export function cardColors(design) {
  const dice = THEMES[design.theme]?.dice || { body: '#2a2620', body2: '#e8a33d', ink: '#f2e6c8' };
  return [design.c1 || dice.body2, design.c2 || dice.ink, '#f6efe0', THEMES[design.theme]?.bg || '#16151a', dice.body];
}
