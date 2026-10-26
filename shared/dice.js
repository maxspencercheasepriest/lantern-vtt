// Lantern VTT dice engine — shared by the server (digital rolls) and the browser (GoDice rolls).
//
// Notation (case-insensitive, spaces ignored), terms joined with + or -:
//   2d6        plain dice              d%  = d100
//   4d6kh3     keep highest 3          2d20kl1  keep lowest 1
//   1d6!       exploding / aces        (re-roll and add on max, chains)
//   1d10cp     Cyberpunk RED d10       (10 = roll again and add, 1 = roll again and subtract)
//   sw8        Savage Worlds trait     (d8 + d6 wild die, both ace, keep highest)
//   d100b1     percentile + 1 bonus die (Call of Cthulhu: extra tens die, keep the lowest)
//   d100p2     percentile + 2 penalty dice (keep the highest tens die)
//   5d6s6      dice pool counting successes (each die showing 6+ is one success; Year Zero)
//   5          flat modifier
//
// evaluate() takes an async roller (sides) => integer, so the same engine works
// with crypto randomness on the server and with physical GoDice in the browser.

const MAX_TERMS = 20;
const MAX_DICE = 100;
const MAX_SIDES = 1000;
const MAX_CHAIN = 20;

export function parse(expr) {
  const src = String(expr || '').toLowerCase().replace(/\s+/g, '');
  if (!src) throw new Error('Empty roll');
  const terms = [];
  let i = 0;
  while (i < src.length) {
    let sign = 1;
    if (src[i] === '+' || src[i] === '-') {
      sign = src[i] === '-' ? -1 : 1;
      i++;
    } else if (terms.length) {
      throw new Error(`Expected + or - at "${src.slice(i)}"`);
    }
    const rest = src.slice(i);
    let m;
    if ((m = /^sw(\d+)/.exec(rest))) {
      const sides = +m[1];
      checkSides(sides);
      terms.push({ type: 'swade', sign, sides });
      i += m[0].length;
    } else if ((m = /^(\d*)d(\d+|%)/.exec(rest))) {
      const count = m[1] === '' ? 1 : +m[1];
      const sides = m[2] === '%' ? 100 : +m[2];
      if (count < 1 || count > MAX_DICE) throw new Error(`Dice count must be 1–${MAX_DICE}`);
      checkSides(sides);
      i += m[0].length;
      // percentile with bonus/penalty dice
      const bp = sides === 100 && count === 1 ? /^([bp])(\d)/.exec(src.slice(i)) : null;
      if (bp) {
        const n = +bp[2];
        if (n > 2) throw new Error('At most 2 bonus or penalty dice');
        terms.push({ type: 'pct', sign, bonus: bp[1] === 'b' ? n : -n });
        i += bp[0].length;
        if (terms.length > MAX_TERMS) throw new Error('Too many terms');
        continue;
      }
      const term = { type: 'dice', sign, count, sides, explode: false, cpr: false, keep: null, succ: null };
      // modifiers
      for (;;) {
        const r = src.slice(i);
        let mm;
        if (r[0] === '!') { term.explode = true; i++; }
        else if ((mm = /^s(\d*)/.exec(r))) {
          const t = mm[1] === '' ? sides : +mm[1];
          if (t < 1 || t > sides) throw new Error('Success threshold out of range');
          term.succ = t;
          i += mm[0].length;
        }
        else if ((mm = /^cp/.exec(r))) { term.cpr = true; i += 2; }
        else if ((mm = /^k([hl])(\d*)/.exec(r))) {
          const n = mm[2] === '' ? 1 : +mm[2];
          if (n < 1 || n > count) throw new Error('Keep count out of range');
          term.keep = { mode: mm[1], n };
          i += mm[0].length;
        } else break;
      }
      if (term.cpr && term.sides !== 10) throw new Error('cp only works on d10');
      terms.push(term);
    } else if ((m = /^\d+/.exec(rest))) {
      terms.push({ type: 'num', sign, value: +m[0] });
      i += m[0].length;
    } else {
      throw new Error(`Can't read "${rest}"`);
    }
    if (terms.length > MAX_TERMS) throw new Error('Too many terms');
  }
  if (!terms.length) throw new Error('Empty roll');
  return { expr: src, terms };
}

function checkSides(s) {
  if (!Number.isInteger(s) || s < 2 || s > MAX_SIDES) throw new Error(`Dice must have 2–${MAX_SIDES} sides`);
}

/** Which physical dice a roll needs up front (explosions/crits may ask for more). */
export function diceNeeded(parsed) {
  const need = [];
  for (const t of parsed.terms) {
    if (t.type === 'dice') for (let k = 0; k < t.count; k++) need.push(t.sides);
    if (t.type === 'swade') need.push(t.sides, 6);
    if (t.type === 'pct') for (let k = 0; k < 2 + Math.abs(t.bonus); k++) need.push(10);
  }
  return need;
}

async function chain(roll, sides, explode) {
  const c = [await roll(sides)];
  if (explode) while (c[c.length - 1] === sides && c.length < MAX_CHAIN) c.push(await roll(sides));
  return c;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

export async function evaluate(parsed, roll) {
  const parts = [];
  const flags = new Set();
  let total = 0;
  let pool = false;
  for (const t of parsed.terms) {
    if (t.type === 'pct') {
      // units die + one tens die, plus one extra tens die per bonus/penalty die
      const units = (await roll(10)) % 10;
      const tens = [];
      for (let k = 0; k < 1 + Math.abs(t.bonus); k++) tens.push(((await roll(10)) % 10) * 10);
      const value = (x) => (x + units === 0 ? 100 : x + units);
      let pick = 0;
      tens.forEach((x, k) => {
        if (t.bonus > 0 ? value(x) < value(tens[pick]) : t.bonus < 0 ? value(x) > value(tens[pick]) : false) pick = k;
      });
      const result = value(tens[pick]);
      if (result === 1) flags.add('crit');
      if (result === 100) flags.add('fumble');
      parts.push({
        type: 'pct', sign: t.sign, sides: 100, bonus: t.bonus,
        dice: [
          ...tens.map((x, k) => ({ sides: 10, chain: [x], value: x, kept: k === pick, label: 'tens' })),
          { sides: 10, chain: [units], value: units, kept: true, label: 'units' },
        ],
        subtotal: result,
      });
      total += t.sign * result;
      continue;
    }
    if (t.type === 'num') {
      parts.push({ type: 'num', sign: t.sign, value: t.value });
      total += t.sign * t.value;
      continue;
    }
    if (t.type === 'swade') {
      const trait = await chain(roll, t.sides, true);
      const wild = await chain(roll, 6, true);
      const tv = sum(trait), wv = sum(wild);
      const useWild = wv > tv;
      if (trait[0] === 1 && wild[0] === 1) flags.add('snake-eyes');
      if (trait.length > 1 || wild.length > 1) flags.add('ace');
      const value = Math.max(tv, wv);
      parts.push({
        type: 'swade', sign: t.sign, sides: t.sides,
        dice: [
          { sides: t.sides, chain: trait, value: tv, kept: !useWild, label: 'trait' },
          { sides: 6, chain: wild, value: wv, kept: useWild, label: 'wild' },
        ],
        subtotal: value,
      });
      total += t.sign * value;
      continue;
    }
    // plain dice
    const dice = [];
    for (let k = 0; k < t.count; k++) {
      const c = await chain(roll, t.sides, t.explode);
      let value = sum(c);
      if (t.explode && c.length > 1) flags.add('ace');
      if (t.cpr) {
        if (c[0] === 10) { const x = await roll(10); c.push(x); value += x; flags.add('crit'); }
        else if (c[0] === 1) { const x = await roll(10); c.push(-x); value -= x; flags.add('fumble'); }
      }
      dice.push({ sides: t.sides, chain: c, value, kept: true });
    }
    if (t.keep) {
      const order = dice.map((d, idx) => idx).sort((a, b) =>
        t.keep.mode === 'h' ? dice[b].value - dice[a].value : dice[a].value - dice[b].value);
      const keepSet = new Set(order.slice(0, t.keep.n));
      dice.forEach((d, idx) => { d.kept = keepSet.has(idx); });
    }
    let subtotal;
    if (t.succ) {
      // dice pool: each kept die at or above the threshold is a success
      pool = true;
      for (const d of dice) d.success = d.kept && d.value >= t.succ;
      subtotal = dice.filter((d) => d.success).length;
      if (dice.some((d) => d.kept && d.chain[0] === 1)) flags.add('ones');
    } else {
      subtotal = sum(dice.filter((d) => d.kept).map((d) => d.value));
    }
    // natural 20 / 1 on a single d20, including advantage/disadvantage (2d20kh1 / kl1)
    const kept = dice.filter((d) => d.kept);
    if (t.sides === 20 && kept.length === 1 && !t.explode && !t.succ) {
      if (kept[0].chain[0] === 20) flags.add('nat20');
      if (kept[0].chain[0] === 1) flags.add('nat1');
    }
    parts.push({
      type: 'dice', sign: t.sign, count: t.count, sides: t.sides,
      explode: t.explode, cpr: t.cpr, keep: t.keep, succ: t.succ, dice, subtotal,
    });
    total += t.sign * subtotal;
  }
  return { expr: parsed.expr, total, parts, flags: [...flags], ...(pool ? { mode: 'successes' } : {}) };
}

export async function rollExpression(expr, roll) {
  return evaluate(parse(expr), roll);
}

/** Light validation of a result built in the browser (GoDice rolls) before the server posts it. */
export function sanitizeResult(r) {
  if (!r || typeof r !== 'object') throw new Error('Bad roll');
  const total = Number(r.total);
  if (!Number.isFinite(total)) throw new Error('Bad total');
  const parts = Array.isArray(r.parts) ? r.parts.slice(0, MAX_TERMS) : [];
  const cleanDie = (d) => ({
    sides: Number(d.sides) || 0,
    chain: (Array.isArray(d.chain) ? d.chain : []).slice(0, MAX_CHAIN + 1).map(Number).filter(Number.isFinite),
    value: Number(d.value) || 0,
    kept: !!d.kept,
    label: typeof d.label === 'string' ? d.label.slice(0, 10) : undefined,
    source: ['godice', 'manual', 'digital'].includes(d.source) ? d.source : undefined,
    success: d.success === true ? true : undefined,
    pushed: d.pushed === true ? true : undefined,
  });
  return {
    expr: String(r.expr || '').slice(0, 120),
    total,
    ...(r.mode === 'successes' ? { mode: 'successes' } : {}),
    flags: (Array.isArray(r.flags) ? r.flags : []).map(String).slice(0, 10),
    parts: parts.map((p) => ({
      type: ['num', 'dice', 'swade', 'pct'].includes(p.type) ? p.type : 'num',
      bonus: Number(p.bonus) || 0,
      succ: Number(p.succ) || undefined,
      sign: p.sign === -1 ? -1 : 1,
      value: Number(p.value) || 0,
      sides: Number(p.sides) || 0,
      count: Number(p.count) || 0,
      subtotal: Number(p.subtotal) || 0,
      dice: (Array.isArray(p.dice) ? p.dice : []).slice(0, MAX_DICE).map(cleanDie),
    })),
  };
}

/** Dice needed to push a pool roll: every pool die that didn't score a success. */
export function pushNeeded(result) {
  const need = [];
  for (const p of result.parts || []) if (p.succ) for (const d of p.dice || []) if (d.kept && !(d.value >= p.succ)) need.push(d.sides);
  return need;
}

/** Push a Year Zero roll: re-roll every pool die that isn't a success, keep the successes. */
export async function pushPool(result, roll) {
  const out = JSON.parse(JSON.stringify(result));
  let total = 0;
  for (const p of out.parts || []) {
    if (p.succ) {
      for (const d of p.dice) {
        if (!d.kept || d.value >= p.succ) continue;
        const v = await roll(d.sides);
        d.chain = [v]; d.value = v; d.success = v >= p.succ; d.pushed = true;
      }
      for (const d of p.dice) d.success = d.kept && d.value >= p.succ;
      p.subtotal = p.dice.filter((d) => d.success).length;
    }
    total += (p.sign || 1) * (p.type === 'num' ? p.value : p.subtotal);
  }
  out.total = total;
  out.flags = [...new Set([...(out.flags || []).filter((f) => f !== 'ones'), 'pushed'])];
  return out;
}
