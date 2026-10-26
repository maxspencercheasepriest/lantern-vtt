import { parse, pushPool, pushNeeded } from '/shared/dice.js';
import { store, call, toast, esc, $ } from './util.js';
import { rollPhysical, rollPhysicalWith, physicalAvailable } from './godice.js';

let socket;
export function initRolls(s) {
  socket = s;
  // Push buttons on roll cards (Call of Cthulhu and Year Zero)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-push]');
    if (b) { b.disabled = true; pushRoll(b.dataset.push).finally(() => b.remove()); }
  });
  socket.on('chat', (m) => {
    if (m.meta?.pushOf) document.querySelectorAll(`[data-push="${CSS.escape(m.meta.pushOf)}"]`).forEach((x) => x.remove());
  });
}

/** Push (re-roll) one of your own rolls. Digital rolls are re-rolled by the server, physical ones with your dice. */
async function pushRoll(id) {
  const m = store.chat.find((x) => x.id === id);
  if (!m) return;
  try {
    const physical = m.source === 'godice' || m.source === 'mixed' || m.source === 'manual';
    if (!physical || !physicalAvailable()) return void (await call(socket, 'roll:push', { id }));
    let result;
    if (m.meta.pushable === 'yze') {
      const need = pushNeeded(m.result);
      result = await rollPhysicalWith(`${m.label || 'Roll'} — push`, need, (roller) => pushPool(m.result, roller));
    } else {
      result = (await rollPhysical(parse(m.result.expr), `${m.label || 'Roll'} — push`))?.result;
    }
    if (!result) return;
    await call(socket, 'roll:physical', {
      result, sources: ['godice'], label: `${m.label || 'Roll'} — pushed`,
      meta: { ...m.meta, pushed: true, pushOf: m.id }, visibility: m.visibility === 'gm' ? 'gm' : 'all',
    });
  } catch (e) { toast(e.message, true); }
}

// Call of Cthulhu success levels
const PCT_LEVELS = ['Fumble', 'Failure', 'Regular success', 'Hard success', 'Extreme success', 'Critical success'];
export function pctLevel(rollv, skill) {
  if (rollv === 1) return 5;
  if (rollv === 100 || (skill < 50 && rollv >= 96)) return 0;
  if (rollv <= Math.floor(skill / 5)) return 4;
  if (rollv <= Math.floor(skill / 2)) return 3;
  if (rollv <= skill) return 2;
  return 1;
}

export const rollSource = { value: localStorage.getItem('lantern.diceSource') || 'digital' };
export function setRollSource(v) {
  rollSource.value = v;
  localStorage.setItem('lantern.diceSource', v);
  store.emit('rollSource', v);
}

const defaultVisibility = () => ($('#gm-only-rolls')?.checked ? 'gm' : 'all');

/**
 * Roll an expression, digitally (server) or with GoDice (browser), and post it to chat.
 * opts: { label, meta, visibility, digital: true to force digital }
 */
export async function roll(expr, opts = {}) {
  const visibility = opts.visibility || defaultVisibility();
  try {
    const parsed = parse(expr); // validate before doing anything
    if (rollSource.value === 'godice' && !opts.digital) {
      if (!physicalAvailable()) {
        toast('No GoDice connected — rolling digitally instead');
      } else {
        const out = await rollPhysical(parsed, opts.label || expr);
        if (!out) return null; // cancelled
        await call(socket, 'roll:physical', { result: out.result, sources: out.sources, label: opts.label, meta: opts.meta, visibility });
        return out.result;
      }
    }
    return await call(socket, 'roll:digital', { expr, label: opts.label, meta: opts.meta, visibility });
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

// ---------- chat rendering ----------
function dieChips(d, parentSides, succ) {
  const sides = d.sides || parentSides;
  if (d.label === 'tens' || d.label === 'units') {
    const shown = d.label === 'tens' ? String(d.chain[0]).padStart(2, '0') : d.chain[0];
    return `<span class="die ${d.kept ? '' : 'dropped'}" title="${d.label} die">${shown}</span>`;
  }
  const chips = d.chain.map((v, i) => {
    const cls = ['die'];
    if (succ) cls.push(d.kept && v >= succ ? 'succ' : 'nosucc');
    else if (i === 0 && v === sides) cls.push('max');
    if (!succ && i === 0 && v === 1) cls.push('min');
    if (d.pushed) cls.push('pushed');
    if (!d.kept) cls.push('dropped');
    if (d.label === 'wild') cls.push('wild');
    const sep = i ? `<span class="chainsep">${v < 0 ? '−' : '+'}</span>` : '';
    return `${sep}<span class="${cls.join(' ')}" title="d${sides}${d.label ? ' ' + d.label : ''}">${Math.abs(v)}</span>`;
  });
  return chips.join('');
}

export function renderRollCard(m) {
  const r = m.result || {};
  const flags = new Set(r.flags || []);
  const pieces = [];
  (r.parts || []).forEach((p, i) => {
    if (i || p.sign < 0) pieces.push(`<span class="op">${p.sign < 0 ? '−' : '+'}</span>`);
    if (p.type === 'num') pieces.push(`<span>${esc(p.value)}</span>`);
    else (p.dice || []).forEach((d, k) => {
      if (k) pieces.push('<span class="op">·</span>');
      pieces.push(dieChips(d, p.sides, p.succ));
    });
  });

  const extras = [];
  const pool = r.mode === 'successes';
  const hasPct = (r.parts || []).some((p) => p.type === 'pct');
  if (hasPct) { flags.delete('crit'); flags.delete('fumble'); } // shown as success levels instead
  const flagLabels = {
    pushed: ['Pushed', 'neutral'],
    crit: ['Crit!', ''], fumble: ['Fumble', 'bad'], ace: ['Ace!', 'neutral'],
    'snake-eyes': ['Snake eyes', 'bad'], nat20: ['Natural 20', ''], nat1: ['Natural 1', 'bad'],
  };
  for (const f of flags) if (flagLabels[f]) extras.push(`<span class="flag ${flagLabels[f][1]}">${flagLabels[f][0]}</span>`);

  const check = m.meta?.check;
  let cardCls = flags.has('crit') || flags.has('nat20') ? 'crit' : flags.has('fumble') || flags.has('nat1') || flags.has('snake-eyes') ? 'fumble' : '';
  if (check) {
    const t = r.total;
    if (check.type === 'effect') {
      const eff = t - check.target;
      // Traveller effect tiers (Marginal, Average, Exceptional…) from the extension's rules
      const tier = globalThis.Traveller?.effectTier(eff) || { label: eff >= 0 ? 'Success' : 'Failure', success: eff >= 0 };
      extras.push(`<span class="flag ${tier.success ? '' : 'bad'}">${tier.label} · Effect ${eff >= 0 ? '+' : ''}${eff}</span>`);
      if (eff >= 6) cardCls = 'crit';
      if (eff <= -6) cardCls = 'fumble';
    } else if (check.type === 'raises') {
      if (flags.has('snake-eyes')) extras.push('<span class="flag bad">Critical failure</span>');
      else if (t >= check.target) {
        const raises = Math.floor((t - check.target) / 4);
        extras.push(`<span class="flag">Success${raises ? ` · ${raises} raise${raises > 1 ? 's' : ''}` : ''}</span>`);
      } else extras.push('<span class="flag bad">Failure</span>');
    } else if (check.type === 'pct') {
      const lvl = pctLevel(t, check.target);
      const need = { regular: 2, hard: 3, extreme: 4 }[check.need] || 2;
      const ok = lvl >= need && lvl > 0;
      extras.push(`<span class="flag ${lvl >= 2 ? '' : 'bad'}">${PCT_LEVELS[lvl]}</span>`);
      if (need > 2) extras.push(`<span class="flag ${ok ? '' : 'bad'}">${ok ? 'Passes' : 'Fails'} ${check.need}</span>`);
      extras.push(`<span class="muted small">vs ${check.target} · ½ ${Math.floor(check.target / 2)} · ⅕ ${Math.floor(check.target / 5)}</span>`);
      cardCls = lvl >= 4 ? 'crit' : lvl === 0 ? 'fumble' : cardCls;
    } else if (check.type === 'succ') {
      const ok = t >= check.target;
      extras.push(`<span class="flag ${ok ? '' : 'bad'}">${ok ? (t > check.target ? `Success · ${t - check.target} extra` : 'Success') : 'Failure'}</span>`);
    } else if (check.type === 'dc') {
      extras.push(t >= check.target ? `<span class="flag">Beats DC ${check.target}</span>` : `<span class="flag bad">Misses DC ${check.target}</span>`);
    } else if (check.type === 'beat') {
      extras.push(t > check.target ? `<span class="flag">Beats DV ${check.target}</span>` : `<span class="flag bad">Fails DV ${check.target}</span>`);
    }
  }
  if (m.meta?.cprDamage) {
    const sixes = (r.parts || []).flatMap((p) => p.dice || []).filter((d) => d.kept && d.chain[0] === 6).length;
    if (sixes >= 2) { extras.push('<span class="flag bad">Critical Injury!</span>'); cardCls = 'crit'; }
  }

  const sourceTag = m.source === 'godice' ? '<span class="tag godice">GoDice</span>'
    : m.source === 'mixed' ? '<span class="tag godice" title="Some dice rolled physically, some entered or rolled digitally">GoDice + other</span>'
    : m.source === 'manual' ? '<span class="tag">entered</span>' : '';

  const flavour = flavourLine(m);
  const pushed = m.meta?.pushed || store.chat.some((x) => x.meta?.pushOf === m.id);
  const canPush = m.meta?.pushable && !pushed && m.from === store.me &&
    (m.meta.pushable === 'coc' ? (m.meta.check && pctLevel(r.total, m.meta.check.target) < ({ regular: 2, hard: 3, extreme: 4 }[m.meta.check.need] || 2))
      : pushNeeded(r).length > 0 && (!m.meta.check || r.total < m.meta.check.target)); // Year Zero: push a roll that fell short
  const pushNote = m.meta?.pushed ? (m.meta.pushable === 'yze' ? 'Pushed — mark a Condition.' : 'Pushed roll — failing now brings something worse.') : '';
  return `<div class="roll ${cardCls}">
    ${m.label ? `<div class="label">${esc(m.label)}</div>` : ''}
    ${flavour ? `<div class="flavour">${esc(flavour)}</div>` : ''}
    ${m.meta?.note ? `<div class="muted small">${esc(m.meta.note)}</div>` : ''}
    <div class="expr">${esc(r.expr)} ${sourceTag}</div>
    <div class="dice">${pieces.join('')}</div>
    <div class="total"><b>${esc(r.total)}</b>${pool ? `<span class="muted">success${r.total === 1 ? '' : 'es'}</span>` : ''}${extras.join('')}</div>
    ${pushNote ? `<div class="muted small">${pushNote}</div>` : ''}
    ${canPush ? `<button class="btn push" data-push="${esc(m.id)}" title="${m.meta.pushable === 'yze' ? 'Re-roll every die that isn’t a success. You must take a Condition.' : 'Re-roll once. Failing a pushed roll brings dire consequences.'}">Push roll</button>` : ''}
  </div>`;
}

// Flavour lines from the extension (js/lib/flavour.js). Picked by message id so every client shows the same line.
function flavourLine(m) {
  const F = globalThis.Flavour;
  const fl = m.meta?.flavour;
  const check = m.meta?.check;
  if (!F || !fl || !check || check.type !== 'effect') return null;
  const effect = m.result.total - check.target;
  const res = { effect, success: effect >= 0 };
  const kind = fl.power ? 'psionic' : F.kindOf({ name: fl.weapon || '', skill: fl.skill || '' });
  const lines = F.LINES[kind]?.[F.outcome(res)];
  if (!lines?.length) return null;
  let h = 0;
  for (const c of String(m.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return lines[h % lines.length]
    .replace(/\{n\}/g, fl.name || 'Someone').replace(/\{w\}/g, fl.weapon || '').replace(/\{p\}/g, fl.power || '');
}
