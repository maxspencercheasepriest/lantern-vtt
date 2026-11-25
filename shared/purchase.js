// What happens to a character sheet when somebody buys something in a prop.
//
// A prop (the Night Market, or anything like it) posts a purchase to the client;
// this works out where it belongs on the sheet for whichever ruleset is in play.
// Pure on purpose: no DOM, no socket, so it can be tested on its own.

// Per ruleset: where the money is, what it's called, where loose gear goes, and
// whether bought weapons deserve a row of their own. Rulesets whose weapon rows
// carry extra columns (range, attacks) keep bought weapons in the gear box instead,
// so nothing arrives half-filled.
const SHOPS = {
  cpr: { money: 'eddies', currency: 'eb', gear: 'gear', weapons: 'weapons', cyberware: 'cyberware' },
  dnd5e: { money: 'coins.gp', currency: 'gp', gear: 'equipment', weapons: 'weapons' },
  traveller: { money: 'credits', currency: 'Cr', gear: 'equipment', weapons: null },
  coc7: { money: null, currency: '', gear: 'gear', weapons: null },
  swade: { money: null, currency: '', gear: 'gear', weapons: null },
  tftl: { money: null, currency: '', gear: 'items', weapons: null },
  generic: { money: null, currency: '', gear: 'notes', weapons: null },
};

export const shopFor = (system) => SHOPS[system] || SHOPS.generic;

const n = (v, def = 0) => { const x = Number(v); return Number.isFinite(x) ? x : def; };
const clean = (s, max = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  let t = o;
  for (const k of keys) { if (typeof t[k] !== 'object' || t[k] === null) t[k] = {}; t = t[k]; }
  t[last] = v;
}

/** One line as it reads on a sheet: "2× Heavy Pistol (200eb)". */
export function itemLine(item, currency = '') {
  const qty = Math.max(1, Math.round(n(item.qty, 1)));
  const name = clean(item.name) || 'Unnamed';
  const cost = n(item.price, 0) * qty;
  return (qty > 1 ? `${qty}× ` : '') + name + (cost ? ` (${cost}${currency})` : '');
}

/**
 * Add what was bought to a copy of the sheet's data.
 * Returns the new data, a one-line summary, what it cost, and whether the
 * character is now in the red. A ruleset with no money field (Tales from the
 * Loop, Savage Worlds) just gets the kit: the GM can settle up at the table.
 */
export function applyPurchase(data, items, system = 'generic') {
  const shop = shopFor(system);
  const d = JSON.parse(JSON.stringify(data || {}));
  const list = (Array.isArray(items) ? items : [items]).filter((x) => x && clean(x.name)).slice(0, 50);
  if (!list.length) return { data: d, summary: '', spent: 0, added: 0, short: false, money: null };

  let spent = 0;
  let added = 0;
  const lines = { gear: [], cyberware: [] };

  for (const raw of list) {
    const qty = Math.max(1, Math.round(n(raw.qty, 1)));
    const name = clean(raw.name);
    spent += n(raw.price, 0) * qty;
    added += qty;

    if (raw.kind === 'weapon' && shop.weapons) {
      // A sheet saved before this ruleset had a weapons table hasn't got the array
      // yet; start one rather than quietly filing a gun under Gear.
      if (!Array.isArray(d[shop.weapons])) d[shop.weapons] = [];
      for (let i = 0; i < Math.min(qty, 10); i++) {
        d[shop.weapons].push({
          name,
          skill: clean(raw.skill, 40) || (system === 'cpr' ? 'Handgun' : ''),
          damage: clean(raw.damage, 20),       // blank if nobody knows: the player fills it in
          rof: n(raw.rof, 1),
        });
      }
      continue;
    }
    const where = raw.kind === 'cyberware' && shop.cyberware && (shop.cyberware in d) ? 'cyberware' : 'gear';
    lines[where].push(itemLine({ ...raw, qty }, shop.currency));
  }

  for (const [bucket, got] of Object.entries(lines)) {
    if (!got.length) continue;
    const want = bucket === 'cyberware' ? shop.cyberware : shop.gear;
    const f = want && (want in d) ? want : 'notes';
    const cur = d[f];
    if (Array.isArray(cur)) {
      // Rows of objects (Tales from the Loop items) keep their shape.
      const asObjects = cur.length === 0 || typeof cur[0] === 'object';
      for (const line of got) cur.push(asObjects ? { name: line, bonus: 1 } : line);
    } else {
      d[f] = [String(cur ?? '').trimEnd(), ...got].filter(Boolean).join('\n');
    }
  }

  // Money. A sheet saved before the field existed, or one that keeps its cash as
  // text (Traveller), is still handled: read what's there, write back a number.
  let short = false;
  let money = null;
  if (shop.money && spent) {
    const before = getPath(d, shop.money);
    if (before === undefined || before === null || typeof before === 'number'
      || (typeof before === 'string' && /^\s*-?[\d,. ]*$/.test(before))) {
      const was = n(String(before ?? '').replace(/[, ]/g, ''), 0);
      setPath(d, shop.money, Math.round((was - spent) * 100) / 100);
      money = shop.money;
      short = was - spent < 0;           // allowed: the sheet shows the hole
    }
  }

  const summary = list.length === 1
    ? itemLine(list[0], shop.currency)
    : `${list.length} items${spent ? ` (${spent}${shop.currency})` : ''}`;

  return { data: d, summary, spent, added, short, money, currency: shop.currency };
}
