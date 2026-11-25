// Call of Cthulhu (7th edition) mechanics shared by the server and the browser: success levels, which rolls
// tick a skill for improvement, and the development phase between sessions. Mechanics only, in our own words.

export const LEVELS = ['Fumble', 'Failure', 'Regular success', 'Hard success', 'Extreme success', 'Critical success'];
export const NEED = { regular: 2, hard: 3, extreme: 4 };

/** Success level of a percentile roll against a skill: 0 fumble … 5 critical. */
export function pctLevel(rollv, skill) {
  if (rollv === 1) return 5;
  if (rollv === 100 || (skill < 50 && rollv >= 96)) return 0;
  if (rollv <= Math.floor(skill / 5)) return 4;
  if (rollv <= Math.floor(skill / 2)) return 3;
  if (rollv <= skill) return 2;
  return 1;
}

/** Did a percentile check succeed at the level it needed? */
export function passes(check, total) {
  if (!check || check.type !== 'pct') return false;
  const lvl = pctLevel(total, +check.target || 0);
  return lvl > 0 && lvl >= (NEED[check.need] || 2);
}

// skills that never improve through use
export const NO_TICK = /^(cthulhu mythos|credit rating)$/i;
export const canTick = (skillName) => !!skillName && !NO_TICK.test(String(skillName).trim());

/** A successful skill roll made from a sheet ticks that skill for the development phase. */
export function earnsTick(meta, total) {
  return !!(meta?.improve?.sheet && canTick(meta.improve.skill) && passes(meta.check, total));
}

/** Find a skill row on a sheet by name (case and spacing don't matter). */
export const skillRow = (data, name) => (data?.skills || []).find((s) => String(s.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());

/**
 * Development phase for one ticked skill: roll d100, and if it beats the current value (or is over 95) the skill
 * goes up by 1d10. Reaching 90 or more for the first time earns 2d6 Sanity.
 */
export function develop(value, d100, d10, sanity2d6 = 0) {
  const v = +value || 0;
  const up = d100 > v || d100 > 95;
  const after = up ? v + d10 : v;
  return { up, rolled: d100, gain: up ? d10 : 0, before: v, after, sanity: up && v < 90 && after >= 90 ? sanity2d6 : 0 };
}
