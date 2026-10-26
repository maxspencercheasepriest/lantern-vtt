const assert = require('assert');
const T = require('../public/js/lib/traveller.js');

// Characteristic DMs
assert.deepStrictEqual([0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15].map(T.charDM), [-3, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 3]);

// UPP incl. pseudo-hex
assert.deepStrictEqual(T.parseUPP('789A87'), { STR: 7, DEX: 8, END: 9, INT: 10, EDU: 8, SOC: 7 });
assert.deepStrictEqual(T.parseUPP('7-8-9-A-8-F'), { STR: 7, DEX: 8, END: 9, INT: 10, EDU: 8, SOC: 15 });
assert.strictEqual(T.parseUPP('12345'), null);

// Skill parsing
const skills = T.parseSkills('Pilot (Spacecraft) 2, Gun Combat (Slug)-1\nAdmin: 0; Jack-of-all-Trades 1\nVacc Suit');
assert.deepStrictEqual(skills, [
  { name: 'Pilot (Spacecraft)', level: 2 }, { name: 'Gun Combat (Slug)', level: 1 },
  { name: 'Admin', level: 0 }, { name: 'Jack-of-all-Trades', level: 1 }, { name: 'Vacc Suit', level: 0 },
]);

// Skill levels
assert.strictEqual(T.skillLevel(skills, 'pilot (spacecraft)').level, 2);
assert.strictEqual(T.skillLevel(skills, 'Pilot (Small Craft)').level, 0);      // other speciality
assert.strictEqual(T.skillLevel(skills, 'Pilot').level, 2);                    // base -> best speciality
assert.strictEqual(T.skillLevel(skills, 'Stealth').level, -2);                 // untrained -3 + JoaT 1
assert.strictEqual(T.skillLevel([], 'Stealth').level, -3);

// Resolution
let r = T.resolve([4, 5], 'normal', { skill: 2, char: 1, dm: -1 }, 8);
assert.deepStrictEqual([r.total, r.effect, r.label, r.success], [11, 3, 'Average Success', true]);
r = T.resolve([1, 6, 3], 'boon', { skill: 0, char: 0, dm: 0 }, 8);
assert.deepStrictEqual([r.kept, r.dropped, r.total], [[6, 3], [1], 9]);
r = T.resolve([1, 6, 3], 'bane', { skill: 0, char: 0, dm: 0 }, 8);
assert.deepStrictEqual([r.kept, r.dropped, r.total, r.label], [[1, 3], [6], 4, 'Failure']);
assert.strictEqual(T.resolve([1, 1], 'normal', {}, 8).label, 'Exceptional Failure');
assert.strictEqual(T.resolve([6, 6], 'normal', { skill: 2 }, 8).label, 'Exceptional Success');
assert.strictEqual(T.resolve([3, 4], 'normal', {}, 8).label, 'Marginal Failure');
assert.strictEqual(T.resolve([4, 4], 'normal', {}, 8).label, 'Marginal Success');
assert.throws(() => T.resolve([7, 1], 'normal', {}, 8));

console.log('traveller rules: all tests passed');

// Damage
assert.deepStrictEqual(T.parseDamage('3D'), { dice: 3, mod: 0 });
assert.deepStrictEqual(T.parseDamage('2d6+3'), { dice: 2, mod: 3 });
assert.deepStrictEqual(T.parseDamage('D'), { dice: 1, mod: 0 });
assert.strictEqual(T.parseDamage('banana'), null);
const wp = T.parseWeapons('Laser Pistol | Gun Combat (Energy) | 3D\nCutlass | Melee (Blade) | 3D | +1\n\nbroken line');
assert.deepStrictEqual(wp.weapons, [
  { name: 'Laser Pistol', skill: 'Gun Combat (Energy)', damage: '3D', dm: 0 },
  { name: 'Cutlass', skill: 'Melee (Blade)', damage: '3D', dm: 1 },
]);
assert.strictEqual(wp.errors.length, 1);
assert.strictEqual(T.formatWeapons(wp.weapons), 'Laser Pistol | Gun Combat (Energy) | 3D\nCutlass | Melee (Blade) | 3D | +1');
let d = T.resolveDamage([4, 2, 6], '3D', 3);
assert.deepStrictEqual([d.diceSum, d.total], [12, 15]);
assert.strictEqual(T.resolveDamage([1, 1], '2D-3', 0).total, 0);
console.log('damage: all tests passed');

// Psionics
const pp = T.parsePowers('Life Detection | Telepathy | 1 | Routine\nMind Link | Telepathy | 2 | 10+\nTelempathy | Telepathy | 1\nbad | x');
assert.deepStrictEqual(pp.powers, [
  { name: 'Life Detection', talent: 'Telepathy', cost: 1, target: 6 },
  { name: 'Mind Link', talent: 'Telepathy', cost: 2, target: 10 },
  { name: 'Telempathy', talent: 'Telepathy', cost: 1, target: 8 },
]);
assert.strictEqual(pp.errors.length, 1);
assert.strictEqual(T.formatPowers(pp.powers), 'Life Detection | Telepathy | 1 | Routine\nMind Link | Telepathy | 2 | Difficult\nTelempathy | Telepathy | 1');
assert.strictEqual(T.psiCost(2, 0), 2); assert.strictEqual(T.psiCost(2, 2), 8);
assert.deepStrictEqual(T.psiSpend(7, 2, true), { spent: 2, after: 5, damage: 0 });
assert.deepStrictEqual(T.psiSpend(7, 4, false), { spent: 1, after: 6, damage: 0 });
assert.deepStrictEqual(T.psiSpend(1, 4, true), { spent: 4, after: 0, damage: 3 });
assert.strictEqual(T.defaultCharFor('Telepathy'), 'PSI');
assert.strictEqual(T.skillLevel([{ name: 'Telepathy', level: 0 }], 'Telepathy').level, 0);
console.log('psionics: all tests passed');

// Ammo + wounds
const w2 = T.parseWeapons('Laser Rifle | Gun Combat (Energy) | 5D | mag 100\nMusket | Gun Combat (Archaic) | 3D-3 | -1 | 1 rounds\nBlade | Melee (Blade) | 2D\nOops | Melee | 2D | banana');
assert.deepStrictEqual(w2.weapons, [
  { name: 'Laser Rifle', skill: 'Gun Combat (Energy)', damage: '5D', dm: 0, mag: 100 },
  { name: 'Musket', skill: 'Gun Combat (Archaic)', damage: '3D-3', dm: -1, mag: 1 },
  { name: 'Blade', skill: 'Melee (Blade)', damage: '2D', dm: 0 },
]);
assert.strictEqual(w2.errors.length, 1);
assert.strictEqual(T.formatWeapons(w2.weapons), 'Laser Rifle | Gun Combat (Energy) | 5D | mag 100\nMusket | Gun Combat (Archaic) | 3D-3 | -1 | mag 1\nBlade | Melee (Blade) | 2D');
const max = { STR: 7, DEX: 9, END: 9 };
let hit = T.applyDamage(max, 6, 'STR');
assert.deepStrictEqual(hit.current, { STR: 7, DEX: 9, END: 3 }); assert.strictEqual(T.woundStatus(hit.current, max), 'Wounded');
hit = T.applyDamage(hit.current, 5, 'DEX');
assert.deepStrictEqual(hit.current, { STR: 7, DEX: 7, END: 0 }); assert.strictEqual(T.woundStatus(hit.current, max), 'Seriously wounded');
hit = T.applyDamage(hit.current, 9, 'DEX');
assert.deepStrictEqual(hit.current, { STR: 5, DEX: 0, END: 0 }); assert.strictEqual(T.woundStatus(hit.current, max), 'Unconscious');
hit = T.applyDamage(hit.current, 20, 'STR');
assert.strictEqual(T.woundStatus(hit.current, max), 'Dead'); assert.strictEqual(hit.excess, 15);
console.log('ammo + wounds: all tests passed');

// FX
const w3 = T.parseWeapons('Laser Rifle | Gun Combat (Energy) | 5D | mag 100\nMusket | Gun Combat (Archaic) | 3D-3 | mag 1 | fx beam-smoke\nFrag Grenade | Athletics (Dexterity) | 5D | mag 3\nBlade | Melee (Blade) | 2D\nFists | Melee (Unarmed) | 1D | fx none').weapons;
assert.deepStrictEqual(w3.map(T.fxCommand), [
  '/fx beam-fire @{selected|token_id} @{target|Target|token_id}',
  '/fx beam-smoke @{selected|token_id} @{target|Target|token_id}',
  '/fx explode-fire @{target|Target|token_id}',
  '/fx burst-blood @{target|Target|token_id}',
  null,
]);
assert.ok(T.formatWeapons(w3).includes('Musket | Gun Combat (Archaic) | 3D-3 | mag 1 | fx beam-smoke'));
console.log('fx: all tests passed');
