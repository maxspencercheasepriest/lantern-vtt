/* Flavour lines posted before attack and psionic results.
 * {n} = character name, {w} = weapon, {p} = psionic power. Add or edit lines freely. */
(function (root) {
  'use strict';

  const LINES = {
    energy: {
      hit: [
        '{n} sights down the {w} — a lance of light finds its mark.',
        'The {w} hums and spits a beam. Ozone, and a scorched target.',
        '{n} squeezes the trigger; the {w} answers with a hiss of light that connects.',
      ],
      miss: [
        '{n} fires the {w}; the beam scorches the bulkhead instead.',
        'A crimson line from the {w} cuts the air — and nothing else.',
        'The {w} flares. The target is already somewhere else.',
      ],
      crit: [
        '{n} brings the {w} up in one smooth motion. A perfect shot.',
        'The {w} sings. {n} doesn’t even need to look.',
      ],
      fumble: [
        'The {w} whines, flickers, and dies mid-shot. Not now…',
        '{n}’s shot from the {w} goes so wide it worries the crew.',
      ],
    },
    slug: {
      hit: [
        'The {w} barks. {n}’s shot strikes home.',
        'Smoke and thunder from the {w} — a hit.',
        '{n} fires the {w}; something on the other end stops moving quite so well.',
      ],
      miss: [
        'The {w} roars; the shot goes wide.',
        '{n} fires the {w} and kicks up dust behind the target.',
        'A crack from the {w}, a ricochet, and nothing to show for it.',
      ],
      crit: [
        '{n} takes one breath, fires the {w} — dead centre.',
        'The {w} speaks once. That is all it needs.',
      ],
      fumble: [
        'The {w} hangs fire with a sad little fizz.',
        '{n} jerks the {w}; the shot buries itself in the floor.',
      ],
    },
    thrown: {
      hit: [
        '{n} pulls the pin and lobs the {w} — right on target.',
        'The {w} arcs through the air and lands exactly where {n} meant it to.',
      ],
      miss: [
        '{n} hurls the {w}; it bounces somewhere unhelpful.',
        'The {w} skitters past the target and rolls away.',
      ],
      crit: [
        '{n}’s throw drops the {w} exactly where it will hurt most.',
      ],
      fumble: [
        'The {w} slips from {n}’s fingers. Everyone looks down.',
      ],
    },
    melee: {
      hit: [
        '{n} steps in with the {w} and lands a clean strike.',
        'Steel flashes — the {w} bites.',
        '{n} closes the gap; the {w} does the rest.',
      ],
      miss: [
        '{n} swings the {w}; the target twists away.',
        'The {w} whistles through empty air.',
      ],
      crit: [
        '{n} moves like water — the {w} finds the gap in their guard.',
      ],
      fumble: [
        '{n} overcommits with the {w} and stumbles.',
      ],
    },
    psionic: {
      hit: [
        '{n}’s eyes go distant… {p} takes hold.',
        'A pressure behind the eyes, a hum in the teeth — {p} answers {n}’s call.',
      ],
      miss: [
        '{n} reaches out with {p} — and touches only static.',
        'For a moment {n} feels it… then {p} slips away.',
      ],
      crit: [
        'The air around {n} thrums. {p} blazes through without effort.',
      ],
      fumble: [
        '{n} reaches for {p}; a spike of pain lances behind the eyes.',
      ],
    },
  };

  function kindOf(weapon) {
    const s = (weapon.skill + ' ' + weapon.name).toLowerCase();
    if (/grenade|explosive|thrown|athletics/.test(s)) return 'thrown';
    if (/melee/.test(s)) return 'melee';
    if (/energy|laser|plasma|fusion/.test(s)) return 'energy';
    return 'slug';
  }

  function outcome(res) {
    if (res.effect >= 6) return 'crit';
    if (res.effect <= -6) return 'fumble';
    return res.success ? 'hit' : 'miss';
  }

  const last = {};
  function pick(list, key) {
    if (!list || !list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === last[key]) i = (i + 1) % list.length; // don't repeat back to back
    last[key] = i;
    return list[i];
  }

  /** A flavour line for this result, or null. */
  function line({ name, weapon, power, res }) {
    const kind = power ? 'psionic' : weapon ? kindOf(weapon) : null;
    if (!kind) return null;
    const o = outcome(res);
    const l = pick(LINES[kind][o], kind + o);
    if (!l) return null;
    return l.replace(/\{n\}/g, name || 'Someone').replace(/\{w\}/g, weapon ? weapon.name : '').replace(/\{p\}/g, power ? power.name : '');
  }

  root.Flavour = { LINES, line, outcome, kindOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Flavour;
})(globalThis);
