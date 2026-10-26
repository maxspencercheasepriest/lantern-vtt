/* Traveller (Mongoose 2nd Edition) task-check rules.
 * Pure functions, no DOM — loaded first so the panel can use them. */
(function (root) {
  'use strict';

  const CHARS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'];

  // Traveller "pseudo-hex" used in UPPs (skips I and O).
  const EHEX = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  const DIFFICULTIES = [
    { label: 'Simple', target: 2 },
    { label: 'Easy', target: 4 },
    { label: 'Routine', target: 6 },
    { label: 'Average', target: 8 },
    { label: 'Difficult', target: 10 },
    { label: 'Very Difficult', target: 12 },
    { label: 'Formidable', target: 14 },
  ];

  // Core skill list, with the characteristic most often paired with it.
  // The panel uses the pairing as a default; the player can always change it.
  const SKILLS = [
    ['Admin', 'EDU'], ['Advocate', 'EDU'],
    ['Animals (Handling)', 'DEX'], ['Animals (Training)', 'INT'], ['Animals (Veterinary)', 'EDU'],
    ['Art (Performer)', 'INT'], ['Art (Holography)', 'INT'], ['Art (Instrument)', 'DEX'],
    ['Art (Visual Media)', 'INT'], ['Art (Write)', 'INT'],
    ['Astrogation', 'EDU'],
    ['Athletics (Dexterity)', 'DEX'], ['Athletics (Endurance)', 'END'], ['Athletics (Strength)', 'STR'],
    ['Broker', 'INT'], ['Carouse', 'SOC'], ['Deception', 'INT'], ['Diplomat', 'SOC'],
    ['Drive (Hovercraft)', 'DEX'], ['Drive (Mole)', 'DEX'], ['Drive (Track)', 'DEX'],
    ['Drive (Walker)', 'DEX'], ['Drive (Wheel)', 'DEX'],
    ['Electronics (Comms)', 'EDU'], ['Electronics (Computers)', 'EDU'],
    ['Electronics (Remote Ops)', 'DEX'], ['Electronics (Sensors)', 'INT'],
    ['Engineer (M-drive)', 'EDU'], ['Engineer (J-drive)', 'EDU'],
    ['Engineer (Life Support)', 'EDU'], ['Engineer (Power)', 'EDU'],
    ['Explosives', 'EDU'],
    ['Flyer (Airship)', 'DEX'], ['Flyer (Grav)', 'DEX'], ['Flyer (Ornithopter)', 'DEX'],
    ['Flyer (Rotor)', 'DEX'], ['Flyer (Wing)', 'DEX'],
    ['Gambler', 'INT'],
    ['Gunner (Turret)', 'DEX'], ['Gunner (Ortillery)', 'INT'], ['Gunner (Screen)', 'INT'], ['Gunner (Capital)', 'INT'],
    ['Gun Combat (Archaic)', 'DEX'], ['Gun Combat (Energy)', 'DEX'], ['Gun Combat (Slug)', 'DEX'],
    ['Heavy Weapons (Artillery)', 'INT'], ['Heavy Weapons (Man Portable)', 'DEX'], ['Heavy Weapons (Vehicle)', 'DEX'],
    ['Investigate', 'INT'], ['Language', 'EDU'], ['Leadership', 'SOC'], ['Mechanic', 'EDU'], ['Medic', 'EDU'],
    ['Melee (Unarmed)', 'STR'], ['Melee (Blade)', 'STR'], ['Melee (Bludgeon)', 'STR'], ['Melee (Natural)', 'STR'],
    ['Navigation', 'INT'], ['Persuade', 'SOC'],
    ['Pilot (Small Craft)', 'DEX'], ['Pilot (Spacecraft)', 'DEX'], ['Pilot (Capital Ships)', 'DEX'],
    ['Profession', 'INT'], ['Recon', 'INT'], ['Science', 'EDU'],
    ['Seafarer (Ocean Ships)', 'DEX'], ['Seafarer (Personal)', 'DEX'], ['Seafarer (Sail)', 'DEX'], ['Seafarer (Submarine)', 'DEX'],
    ['Stealth', 'DEX'], ['Steward', 'EDU'], ['Streetwise', 'INT'], ['Survival', 'EDU'],
    ['Tactics (Military)', 'INT'], ['Tactics (Naval)', 'INT'], ['Vacc Suit', 'DEX'],
  ];

  const JOAT = 'jack-of-all-trades';

  function norm(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')').trim();
  }
  function baseName(name) {
    return norm(name).replace(/\s*\(.*\)$/, '');
  }

  /** Characteristic value -> DM (Mongoose 2e table). */
  function charDM(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return -3;
    if (v <= 2) return -2;
    if (v <= 5) return -1;
    if (v <= 8) return 0;
    if (v <= 11) return 1;
    if (v <= 14) return 2;
    return 3;
  }

  /** "789A87" -> {STR:7, DEX:8, END:9, INT:10, EDU:8, SOC:7}; null if it isn't a 6-digit UPP. */
  function parseUPP(upp) {
    const s = String(upp || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (s.length !== 6) return null;
    const out = {};
    for (let i = 0; i < 6; i++) {
      const v = EHEX.indexOf(s[i]);
      if (v < 0) return null;
      out[CHARS[i]] = v;
    }
    return out;
  }

  /**
   * Parse a skill list the way people write it on a sheet:
   *   "Admin 1, Pilot (Spacecraft) 2, Gun Combat-0"   or one per line, "Name: 1" also fine.
   * Returns [{name, level}].
   */
  function parseSkills(text) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of String(text || '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === '\n' || ch === ';') && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    const out = [];
    for (const raw of parts) {
      const p = raw.trim();
      if (!p) continue;
      const m = p.match(/^(.*?)[\s:\-–]+(\d+)$/);
      if (m && m[1].trim()) out.push({ name: m[1].trim(), level: Number(m[2]) });
      else out.push({ name: p, level: 0 });
    }
    return out;
  }

  function formatSkills(skills) {
    return (skills || []).map(s => `${s.name} ${s.level}`).join('\n');
  }

  /**
   * Effective skill level for a check.
   *  - exact match (incl. speciality) -> that level
   *  - same base skill, different/no speciality -> 0 (any level in a skill gives 0 in all its specialities)
   *  - untrained -> -3, reduced by Jack-of-all-Trades
   */
  function skillLevel(skills, wanted) {
    const list = skills || [];
    const w = norm(wanted);
    const exact = list.find(s => norm(s.name) === w);
    if (exact) return { level: exact.level, how: 'trained' };

    const wBase = baseName(wanted);
    const sameBase = list.filter(s => baseName(s.name) === wBase);
    if (sameBase.length) {
      // Asking for the base skill itself ("Pilot") when they only have specialities: use the best one.
      if (!/\(/.test(wanted)) {
        const best = Math.max(...sameBase.map(s => s.level));
        return { level: best, how: 'trained' };
      }
      return { level: 0, how: 'other speciality' };
    }

    const joat = list.find(s => norm(s.name).replace(/\s/g, '-') === JOAT || norm(s.name) === 'jack of all trades');
    const j = joat ? Math.min(3, joat.level) : 0;
    return { level: -3 + j, how: j ? `untrained, JoaT ${j}` : 'untrained' };
  }

  function defaultCharFor(skill) {
    const n = norm(skill);
    const exact = SKILLS.find(([s]) => norm(s) === n);
    if (exact) return exact[1];
    const base = SKILLS.find(([s]) => baseName(s) === baseName(skill));
    return base ? base[1] : 'INT';
  }

  function effectTier(effect) {
    if (effect <= -6) return { label: 'Exceptional Failure', success: false };
    if (effect <= -2) return { label: 'Failure', success: false };
    if (effect === -1) return { label: 'Marginal Failure', success: false };
    if (effect === 0) return { label: 'Marginal Success', success: true };
    if (effect <= 5) return { label: 'Average Success', success: true };
    return { label: 'Exceptional Success', success: true };
  }

  /**
   * Resolve a task check from physical dice.
   * @param {number[]} dice  2 values (normal) or 3 (boon/bane)
   * @param {'normal'|'boon'|'bane'} mode
   * @param {object} mods {skill, char, dm} (numbers; skill/char may be null when not used)
   * @param {number} target
   */
  function resolve(dice, mode, mods, target) {
    const vals = dice.map(Number);
    if (vals.some(v => !(v >= 1 && v <= 6))) throw new Error('Dice values must be 1–6');
    const need = mode === 'normal' ? 2 : 3;
    if (vals.length < need) throw new Error(`Need ${need} dice`);
    const used = vals.slice(0, need);

    let kept = used.slice(), dropped = [];
    if (mode !== 'normal') {
      const order = used.map((v, i) => [v, i]).sort((a, b) => mode === 'boon' ? b[0] - a[0] : a[0] - b[0]);
      const keepIdx = new Set(order.slice(0, 2).map(x => x[1]));
      kept = used.filter((_, i) => keepIdx.has(i));
      dropped = used.filter((_, i) => !keepIdx.has(i));
    }
    const diceSum = kept[0] + kept[1];
    const s = Number(mods.skill) || 0, c = Number(mods.char) || 0, d = Number(mods.dm) || 0;
    const total = diceSum + s + c + d;
    const effect = total - target;
    return { used, kept, dropped, diceSum, total, target, effect, ...effectTier(effect) };
  }

  /** "3D", "2D+3", "4d6-1", "1D" -> {dice, mod}; null if unreadable. */
  function parseDamage(spec) {
    const m = String(spec || '').replace(/\s+/g, '').match(/^(\d*)[dD]6?([+\-]\d+)?$/);
    if (!m) return null;
    const dice = m[1] === '' ? 1 : Number(m[1]);
    if (!(dice >= 1 && dice <= 20)) return null;
    return { dice, mod: m[2] ? Number(m[2]) : 0 };
  }
  function formatDamage(d) {
    return `${d.dice}D${d.mod ? (d.mod > 0 ? `+${d.mod}` : d.mod) : ''}`;
  }

  /**
   * Weapons, one per line:  Name | Skill | Damage [| DM]
   *   Laser Pistol | Gun Combat (Energy) | 3D
   *   Cutlass | Melee (Blade) | 3D | +1
   * Returns {weapons, errors}.
   */
  /**
   * Weapons, one per line:  Name | Skill | Damage [| DM] [| mag N]
   *   Laser Rifle | Gun Combat (Energy) | 5D | mag 100
   *   Cutlass | Melee (Blade) | 3D | +1
   * Extra columns can come in any order: a signed number is a DM, "mag 30" / "ammo 30" / "30 rounds" is magazine size.
   */
  function parseWeapons(text) {
    const weapons = [], errors = [];
    String(text || '').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const cols = line.split('|').map(s => s.trim());
      const dmg = parseDamage(cols[2]);
      if (cols.length < 3 || !cols[0] || !dmg) { errors.push(`Line ${i + 1}: "${line.trim()}"`); return; }
      let dm = 0, mag = 0, fx = null, bad = false;
      for (const extra of cols.slice(3)) {
        if (!extra) continue;
        const f = extra.match(/^fx\s*:?\s*(none|[a-z]+-[a-z]+)$/i);
        if (f) { fx = f[1].toLowerCase(); continue; }
        const m1 = extra.match(/^(?:mag|magazine|ammo|rounds?|shots?)\s*:?\s*(\d+)$/i) || extra.match(/^(\d+)\s*(?:rds?|rounds?|shots?|ammo)$/i);
        if (m1) { mag = Number(m1[1]); continue; }
        if (/^[+\-−]?\d+$/.test(extra)) { dm = Number(extra.replace('−', '-')); continue; }
        bad = true;
      }
      if (bad) { errors.push(`Line ${i + 1}: "${line.trim()}"`); return; }
      const w = { name: cols[0], skill: cols[1], damage: formatDamage(dmg), dm };
      if (mag) w.mag = mag;
      if (fx) w.fx = fx;
      weapons.push(w);
    });
    return { weapons, errors };
  }
  function formatWeapons(weapons) {
    return (weapons || []).map(w => [w.name, w.skill, w.damage]
      .concat(w.dm ? [w.dm > 0 ? `+${w.dm}` : String(w.dm)] : [])
      .concat(w.mag ? [`mag ${w.mag}`] : []).concat(w.fx ? [`fx ${w.fx}`] : []).join(' | ')).join('\n');
  }

  /* ---------------- Roll20 /fx for attacks ----------------
   * Directional effects run from your selected token to a token you click; the rest play on the clicked token. */
  const FX_DIRECTIONAL = ['beam', 'breath', 'splatter', 'missile'];
  function defaultFx(w) {
    const n = norm(w.skill), name = norm(w.name);
    if (/grenade|explosive|rocket/.test(name) || /explosives/.test(n)) return 'explode-fire';
    if (/energy/.test(n) || /laser/.test(name)) return 'beam-fire';
    if (/plasma|fusion/.test(name)) return 'beam-holy';
    if (/gun combat|heavy weapons|gunner/.test(n)) return 'missile-smoke';
    if (/melee/.test(n)) return 'burst-blood';
    return 'burst-smoke';
  }
  function fxCommand(w) {
    const fx = w.fx || defaultFx(w);
    if (fx === 'none') return null;
    const shape = fx.split('-')[0];
    return FX_DIRECTIONAL.includes(shape)
      ? `/fx ${fx} @{selected|token_id} @{target|Target|token_id}`
      : `/fx ${fx} @{target|Target|token_id}`;
  }

  /* ---------------- Wounds ----------------
   * Damage (after armour) comes off END first; once END is 0 the rest goes to STR or DEX.
   * Status as the panel reports it: END 0 plus STR or DEX at 0 = unconscious; all three at 0 = dead. */
  const PHYS = ['STR', 'DEX', 'END'];
  function applyDamage(current, amount, overflow) {
    const cur = { ...current };
    let left = Math.max(0, amount | 0);
    const log = [];
    const take = (c, n) => { const t = Math.min(cur[c], n); if (t) { cur[c] -= t; log.push(`${c} −${t}`); } return n - t; };
    left = take('END', left);
    const other = overflow === 'DEX' ? 'STR' : 'DEX';
    left = take(overflow === 'DEX' ? 'DEX' : 'STR', left);
    left = take(other, left);
    return { current: cur, log, excess: left };
  }
  function woundStatus(cur, max) {
    const zero = PHYS.filter(c => cur[c] <= 0);
    if (zero.length === 3) return 'Dead';
    if (cur.END <= 0 && (cur.STR <= 0 || cur.DEX <= 0)) return 'Unconscious';
    if (cur.END <= 0) return 'Seriously wounded';
    if (PHYS.some(c => cur[c] < max[c])) return 'Wounded';
    return 'Unhurt';
  }

  /** Traveller damage: weapon dice + any fixed modifier + the attack's Effect. */
  function resolveDamage(dice, spec, effect) {
    const d = typeof spec === 'string' ? parseDamage(spec) : spec;
    if (!d) throw new Error('Unreadable damage, e.g. 3D or 2D+3');
    const vals = dice.map(Number);
    if (vals.length < d.dice) throw new Error(`Need ${d.dice} dice`);
    if (vals.some(v => !(v >= 1 && v <= 6))) throw new Error('Dice values must be 1–6');
    const used = vals.slice(0, d.dice);
    const diceSum = used.reduce((a, b) => a + b, 0);
    const eff = Math.max(0, Number(effect) || 0);
    return { used, diceSum, mod: d.mod, effect: eff, total: Math.max(0, diceSum + d.mod + eff) };
  }

  /* ---------------- Psionics (core rules as written) ----------------
   * Talents are rolled like skills with the PSI DM, using *current* PSI.
   * A successful power costs its PSI cost; a failed attempt costs 1.
   * Spending below 0 turns the excess into damage. At 0 PSI no power can be attempted.
   * Each extra range band doubles the cost. Recovery: 1 point/hour, starting 3 hours after last use. */
  const TALENTS = ['Telepathy', 'Clairvoyance', 'Telekinesis', 'Awareness', 'Teleportation'];
  for (const t of TALENTS) SKILLS.push([t, 'PSI']);

  function isTalent(name) { return TALENTS.some(t => baseName(t) === baseName(name)); }

  function parseTarget(s) {
    const str = String(s || '').trim();
    if (!str) return 8;
    const n = Number(str.replace(/\+$/, ''));
    if (Number.isFinite(n) && n > 0) return n;
    const d = DIFFICULTIES.find(d => d.label.toLowerCase() === str.toLowerCase());
    return d ? d.target : null;
  }

  /**
   * Powers, one per line:  Name | Talent | PSI cost | Difficulty (optional, default Average 8+)
   *   Life Detection | Telepathy | 1 | Routine
   *   Mind Link | Telepathy | 2 | 8
   */
  function parsePowers(text) {
    const powers = [], errors = [];
    String(text || '').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const c = line.split('|').map(s => s.trim());
      const cost = Number(c[2]);
      const target = parseTarget(c[3]);
      if (c.length < 3 || !c[0] || !c[1] || !(cost >= 0) || target == null) { errors.push(`Line ${i + 1}: "${line.trim()}"`); return; }
      powers.push({ name: c[0], talent: c[1], cost, target });
    });
    return { powers, errors };
  }
  function formatPowers(powers) {
    return (powers || []).map(p => {
      const d = DIFFICULTIES.find(d => d.target === p.target);
      return [p.name, p.talent, p.cost].concat(p.target === 8 ? [] : [d ? d.label : p.target]).join(' | ');
    }).join('\n');
  }

  /** Cost after paying to extend range: each extra band doubles it. */
  function psiCost(cost, extraBands) { return cost * Math.pow(2, Math.max(0, extraBands | 0)); }

  /** What a power attempt does to the PSI pool. */
  function psiSpend(current, cost, success) {
    const spent = success ? cost : 1;
    const after = current - spent;
    return { spent, after: Math.max(0, after), damage: after < 0 ? -after : 0 };
  }

  const api = { CHARS, DIFFICULTIES, SKILLS, charDM, parseUPP, parseSkills, formatSkills, skillLevel, defaultCharFor, effectTier, resolve, norm,
    parseDamage, formatDamage, parseWeapons, formatWeapons, resolveDamage,
    TALENTS, isTalent, parsePowers, formatPowers, psiCost, psiSpend, PHYS, applyDamage, woundStatus, defaultFx, fxCommand };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Traveller = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
