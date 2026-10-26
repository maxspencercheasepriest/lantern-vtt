// Lantern VTT dice engine — shared by the server (digital rolls) and the browser (GoDice rolls).
//
// Notation (case-insensitive, spaces ignored), terms joined with + or -:
//   2d6        plain dice              d%  = d100
//   4d6kh3     keep highest 3          2d20kl1  keep lowest 1
//   1d6!       exploding / aces        (re-roll and add on max, chains)
//   1d10cp     Cyberpunk RED d10       (10 = roll again and add, 1 = roll again and subtract)
//   sw8        Savage Worlds trait     (d8 + d6 wild die, both ace, keep highest)
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
      const term = { type: 'dice', sign, count, sides, explode: false, cpr: false, keep: null };
      // modifiers
      for (;;) {
        const r = src.slice(i);
        let mm;
        if (r[0] === '!') { term.explode = true; i++; }
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
  for (const t of parsed.terms) {
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
    const subtotal = sum(dice.filter((d) => d.kept).map((d) => d.value));
    if (t.sides === 20 && t.count === 1 && !t.explode) {
      if (dice[0].chain[0] === 20) flags.add('nat20');
      if (dice[0].chain[0] === 1) flags.add('nat1');
    }
    parts.push({
      type: 'dice', sign: t.sign, count: t.count, sides: t.sides,
      explode: t.explode, cpr: t.cpr, keep: t.keep, dice, subtotal,
    });
    total += t.sign * subtotal;
  }
  return { expr: parsed.expr, total, parts, flags: [...flags] };
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
  });
  return {
    expr: String(r.expr || '').slice(0, 120),
    total,
    flags: (Array.isArray(r.flags) ? r.flags : []).map(String).slice(0, 10),
    parts: parts.map((p) => ({
      type: ['num', 'dice', 'swade'].includes(p.type) ? p.type : 'num',
      sign: p.sign === -1 ? -1 : 1,
      value: Number(p.value) || 0,
      sides: Number(p.sides) || 0,
      count: Number(p.count) || 0,
      subtotal: Number(p.subtotal) || 0,
      dice: (Array.isArray(p.dice) ? p.dice : []).slice(0, MAX_DICE).map(cleanDie),
    })),
  };
}
