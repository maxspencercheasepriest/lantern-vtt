// Quick character generator for one-shots. Each ruleset has a generator that takes the system's blank sheet
// (systems.js defaults) and a dice function, and returns a filled-in sheet plus a short log of what was rolled.
// Rolls follow each game's usual method where it is simple; everything else (occupations, careers, names,
// hooks) is picked from short lists written for Lantern. No DOM here, so it is tested in Node.
//
//   generate(systemId, blankSheet, rnd?) -> { data, log: string[] }
//   rnd(n) returns a whole number from 1 to n.

export function cryptoRnd(n) {
  const max = Math.floor(0x100000000 / n) * n; // reject the uneven tail so every face is equally likely
  const buf = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(buf); while (buf[0] >= max);
  return (buf[0] % n) + 1;
}

const roll = (rnd, n, sides) => Array.from({ length: n }, () => rnd(sides));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pick = (rnd, list) => list[rnd(list.length) - 1];
function pickN(rnd, list, n) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(rnd(pool.length) - 1, 1)[0]);
  return out;
}
/** Spend `points` one at a time on random keys, using weights and a per-key cap. */
function spread(rnd, keys, points, { cap = () => Infinity, weight = () => 1, cost = () => 1, step = (k) => k } = {}) {
  let left = points;
  for (let guard = 0; left > 0 && guard < 5000; guard++) {
    const open = keys.filter((k) => !cap(k) && cost(k) <= left);
    if (!open.length) break;
    const bag = open.flatMap((k) => Array(Math.max(1, weight(k))).fill(k));
    const k = pick(rnd, bag);
    left -= cost(k);
    step(k);
  }
  return left;
}
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

// ---------------------------------------------------------------- names
const NAMES = {
  fantasy: {
    first: ['Aldric', 'Brenna', 'Corin', 'Dagny', 'Eamon', 'Fenna', 'Garrick', 'Hesper', 'Isolde', 'Jorund', 'Kestrel', 'Lorcan', 'Maelis', 'Nyx', 'Orrin', 'Perrin', 'Quill', 'Rowan', 'Sabine', 'Tamsin', 'Ulric', 'Vesna', 'Wren', 'Yorick', 'Zara', 'Thorne', 'Elowen', 'Bram', 'Ilsa', 'Cassius'],
    last: ['Ashdown', 'Blackbriar', 'Coldwater', 'Duskmantle', 'Emberfall', 'Fairweather', 'Greymoor', 'Hollowell', 'Ironside', 'Kettlewick', 'Larkspur', 'Marrowgate', 'Nettlefield', 'Oakhart', 'Quickfoot', 'Ravensworth', 'Stonebrook', 'Thistledown', 'Underhill', 'Wolfsbane'],
  },
  twenties: {
    first: ['Arthur', 'Beatrice', 'Clarence', 'Dorothy', 'Edmund', 'Florence', 'Harold', 'Ida', 'Jasper', 'Lillian', 'Mabel', 'Norman', 'Opal', 'Percival', 'Rosalind', 'Sidney', 'Theodora', 'Virgil', 'Winifred', 'Agatha', 'Cecil', 'Evelyn', 'Howard', 'Mildred'],
    last: ['Ashworth', 'Blackwood', 'Carrington', 'Delacroix', 'Ellsworth', 'Fairbanks', 'Grimsby', 'Hargreaves', 'Kingsley', 'Lockhart', 'Marsh', 'Northcott', 'Pemberton', 'Quincey', 'Rutherford', 'Sinclair', 'Thorne', 'Whateley', 'Wainwright', 'Yardley'],
  },
  eighties: {
    first: ['Anna', 'Björn', 'Danny', 'Erik', 'Frida', 'Gabe', 'Hanna', 'Jonas', 'Kim', 'Lena', 'Mikael', 'Nils', 'Olivia', 'Pelle', 'Robin', 'Sara', 'Tommy', 'Ulla', 'Vincent', 'Wendy', 'Cody', 'Jenny', 'Kevin', 'Stacey'],
    last: ['Andersson', 'Berg', 'Carlsson', 'Dahl', 'Ek', 'Fors', 'Holm', 'Johansson', 'Lind', 'Nyberg', 'Sandberg', 'Walsh', 'Becker', 'Delgado', 'Hartley', 'Kowalski', 'Moreno', 'Parker', 'Reyes', 'Sullivan'],
  },
  scifi: {
    first: ['Ari', 'Bex', 'Cato', 'Dax', 'Esme', 'Falk', 'Gideon', 'Hana', 'Ivo', 'Juno', 'Kade', 'Lyra', 'Marek', 'Noor', 'Orla', 'Piet', 'Rhea', 'Soren', 'Talia', 'Vance', 'Wex', 'Yuki', 'Zed', 'Imre'],
    last: ['Achterberg', 'Brannigan', 'Castellan', 'Drexler', 'Esterhazy', 'Falkenrath', 'Grieve', 'Hadley', 'Ishikawa', 'Kovacs', 'Lindqvist', 'Marchetti', 'Novak', 'Okonkwo', 'Petrov', 'Quintero', 'Rourke', 'Sato', 'Varga', 'Zhou'],
  },
  cyber: {
    first: ['Ash', 'Bishop', 'Cass', 'Dex', 'Echo', 'Flint', 'Gage', 'Hex', 'Iris', 'Jinx', 'Kira', 'Lux', 'Mako', 'Nova', 'Onyx', 'Pike', 'Raze', 'Sable', 'Tank', 'Vex', 'Wraith', 'Zero', 'Glitch', 'Static'],
    last: ['Alvarez', 'Bergström', 'Chen', 'Dlamini', 'Esposito', 'Fujita', 'Grant', 'Haas', 'Ibarra', 'Jang', 'Kowal', 'Lopez', 'Mbeki', 'Nakamura', 'Okafor', 'Park', 'Reyes', 'Silva', 'Tanaka', 'Volkov'],
  },
  pulp: {
    first: ['Abel', 'Clara', 'Dutch', 'Eliza', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack', 'Kitty', 'Luke', 'Mae', 'Ned', 'Opal', 'Pete', 'Rose', 'Sam', 'Tess', 'Walt', 'Vera', 'Buck', 'Hattie', 'Jesse', 'Lottie'],
    last: ['Barlow', 'Cody', 'Dalton', 'Everett', 'Flynn', 'Garrett', 'Hollis', 'Jameson', 'Kincaid', 'Lomax', 'McCall', 'Navarro', 'Pryor', 'Quaid', 'Rourke', 'Slade', 'Tate', 'Vance', 'Whitlock', 'York'],
  },
};
const fullName = (rnd, set) => `${pick(rnd, NAMES[set].first)} ${pick(rnd, NAMES[set].last)}`;

// ======================================================================
// D&D 5e (SRD 5.1)
// ======================================================================
const ABIL = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const mod = (v) => Math.floor((v - 10) / 2);
const DND_RACES = {
  Human: { bonus: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 } },
  'Hill Dwarf': { bonus: { CON: 2, WIS: 1 }, speed: 25, hpPerLevel: 1 },
  'High Elf': { bonus: { DEX: 2, INT: 1 } },
  'Lightfoot Halfling': { bonus: { DEX: 2, CHA: 1 }, speed: 25 },
  Dragonborn: { bonus: { STR: 2, CHA: 1 } },
  'Rock Gnome': { bonus: { INT: 2, CON: 1 }, speed: 25 },
  'Half-Elf': { bonus: { CHA: 2 }, plusTwo: true },
  'Half-Orc': { bonus: { STR: 2, CON: 1 } },
  Tiefling: { bonus: { CHA: 2, INT: 1 } },
};
const atk = (name, ability, damage, type, extra = {}) => ({ name, ability, prof: true, bonus: 0, damage, addMod: ability !== 'SPELL', type, ...extra });
const DND_CLASSES = {
  Barbarian: { hd: 12, order: ['STR', 'CON', 'DEX'], saves: ['STR', 'CON'], skills: [2, ['Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival']],
    ac: (m) => 10 + m.DEX + m.CON, armour: 'Unarmoured Defence', attacks: [atk('Greataxe', 'STR', '1d12', 'slashing'), atk('Handaxe (thrown)', 'STR', '1d6', 'slashing')],
    gear: 'Greataxe, two handaxes, explorer\'s pack, four javelins', features: 'Rage (2/long rest), Unarmoured Defence' },
  Bard: { hd: 8, order: ['CHA', 'DEX', 'CON'], saves: ['DEX', 'CHA'], skills: [3, null], ac: (m) => 11 + m.DEX, armour: 'Leather',
    attacks: [atk('Rapier', 'DEX', '1d8', 'piercing'), atk('Vicious Mockery', 'SPELL', '1d4', 'psychic', { prof: false })],
    caster: 'CHA', slots: 2, spells: [['Vicious Mockery', 0], ['Light', 0], ['Healing Word', 1], ['Charm Person', 1], ['Faerie Fire', 1], ['Thunderwave', 1]],
    gear: 'Rapier, lute, leather armour, dagger, entertainer\'s pack', features: 'Bardic Inspiration (d6), Spellcasting' },
  Cleric: { hd: 8, order: ['WIS', 'CON', 'STR'], saves: ['WIS', 'CHA'], skills: [2, ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion']],
    ac: (m) => 14 + Math.min(2, m.DEX) + 2, armour: 'Scale mail and shield', attacks: [atk('Mace', 'STR', '1d6', 'bludgeoning'), atk('Sacred Flame', 'SPELL', '1d8', 'radiant', { prof: false })],
    caster: 'WIS', slots: 2, spells: [['Sacred Flame', 0], ['Guidance', 0], ['Light', 0], ['Cure Wounds', 1], ['Bless', 1], ['Healing Word', 1]],
    gear: 'Mace, scale mail, shield, holy symbol, priest\'s pack', features: 'Spellcasting, Divine Domain (Life)' },
  Druid: { hd: 8, order: ['WIS', 'CON', 'DEX'], saves: ['INT', 'WIS'], skills: [2, ['Arcana', 'Animal Handling', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival']],
    ac: (m) => 11 + m.DEX + 2, armour: 'Leather and wooden shield', attacks: [atk('Scimitar', 'DEX', '1d6', 'slashing'), atk('Produce Flame', 'SPELL', '1d8', 'fire')],
    caster: 'WIS', slots: 2, spells: [['Produce Flame', 0], ['Shillelagh', 0], ['Cure Wounds', 1], ['Entangle', 1], ['Thunderwave', 1]],
    gear: 'Scimitar, wooden shield, leather armour, druidic focus, explorer\'s pack', features: 'Druidic, Spellcasting' },
  Fighter: { hd: 10, order: ['STR', 'CON', 'DEX'], saves: ['STR', 'CON'], skills: [2, ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Survival']],
    ac: () => 18, armour: 'Chain mail and shield', attacks: [atk('Longsword', 'STR', '1d8', 'slashing'), atk('Light crossbow', 'DEX', '1d8', 'piercing')],
    gear: 'Chain mail, longsword, shield, light crossbow and 20 bolts, dungeoneer\'s pack', features: 'Fighting Style (Defence), Second Wind' },
  Monk: { hd: 8, order: ['DEX', 'WIS', 'CON'], saves: ['STR', 'DEX'], skills: [2, ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth']],
    ac: (m) => 10 + m.DEX + m.WIS, armour: 'Unarmoured Defence', attacks: [atk('Shortsword', 'DEX', '1d6', 'piercing'), atk('Unarmed strike', 'DEX', '1d4', 'bludgeoning')],
    gear: 'Shortsword, ten darts, explorer\'s pack', features: 'Unarmoured Defence, Martial Arts (d4)' },
  Paladin: { hd: 10, order: ['STR', 'CHA', 'CON'], saves: ['WIS', 'CHA'], skills: [2, ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion']],
    ac: () => 18, armour: 'Chain mail and shield', attacks: [atk('Longsword', 'STR', '1d8', 'slashing'), atk('Javelin', 'STR', '1d6', 'piercing')],
    gear: 'Chain mail, longsword, shield, five javelins, holy symbol, priest\'s pack', features: 'Divine Sense, Lay on Hands (5 HP)' },
  Ranger: { hd: 10, order: ['DEX', 'WIS', 'CON'], saves: ['STR', 'DEX'], skills: [3, ['Animal Handling', 'Athletics', 'Insight', 'Investigation', 'Nature', 'Perception', 'Stealth', 'Survival']],
    ac: (m) => 14 + Math.min(2, m.DEX), armour: 'Scale mail', attacks: [atk('Longbow', 'DEX', '1d8', 'piercing'), atk('Shortsword', 'DEX', '1d6', 'piercing')],
    gear: 'Scale mail, two shortswords, longbow and 20 arrows, explorer\'s pack', features: 'Favoured Enemy, Natural Explorer' },
  Rogue: { hd: 8, order: ['DEX', 'CON', 'CHA'], saves: ['DEX', 'INT'], skills: [4, ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Performance', 'Persuasion', 'Sleight of Hand', 'Stealth']],
    ac: (m) => 11 + m.DEX, armour: 'Leather', attacks: [atk('Rapier', 'DEX', '1d8', 'piercing'), atk('Shortbow', 'DEX', '1d6', 'piercing')],
    gear: 'Rapier, shortbow and 20 arrows, leather armour, two daggers, thieves\' tools, burglar\'s pack', features: 'Expertise, Sneak Attack (1d6), Thieves\' Cant' },
  Sorcerer: { hd: 6, order: ['CHA', 'CON', 'DEX'], saves: ['CON', 'CHA'], skills: [2, ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion']],
    ac: (m) => 10 + m.DEX, armour: 'None', attacks: [atk('Fire Bolt', 'SPELL', '1d10', 'fire'), atk('Light crossbow', 'DEX', '1d8', 'piercing')],
    caster: 'CHA', slots: 2, spells: [['Fire Bolt', 0], ['Light', 0], ['Mage Hand', 0], ['Magic Missile', 1], ['Shield', 1]],
    gear: 'Light crossbow and 20 bolts, arcane focus, two daggers, dungeoneer\'s pack', features: 'Spellcasting, Sorcerous Origin (Draconic)' },
  Warlock: { hd: 8, order: ['CHA', 'CON', 'DEX'], saves: ['WIS', 'CHA'], skills: [2, ['Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion']],
    ac: (m) => 11 + m.DEX, armour: 'Leather', attacks: [atk('Eldritch Blast', 'SPELL', '1d10', 'force'), atk('Dagger', 'DEX', '1d4', 'piercing')],
    caster: 'CHA', slots: 1, spells: [['Eldritch Blast', 0], ['Mage Hand', 0], ['Hellish Rebuke', 1], ['Charm Person', 1]],
    gear: 'Light crossbow, arcane focus, leather armour, two daggers, scholar\'s pack', features: 'Otherworldly Patron (Fiend), Pact Magic' },
  Wizard: { hd: 6, order: ['INT', 'CON', 'DEX'], saves: ['INT', 'WIS'], skills: [2, ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion']],
    ac: (m) => 10 + m.DEX, armour: 'None', attacks: [atk('Fire Bolt', 'SPELL', '1d10', 'fire'), atk('Quarterstaff', 'STR', '1d6', 'bludgeoning')],
    caster: 'INT', slots: 2, spells: [['Fire Bolt', 0], ['Light', 0], ['Mage Hand', 0], ['Magic Missile', 1], ['Shield', 1], ['Sleep', 1], ['Burning Hands', 1]],
    gear: 'Quarterstaff, spellbook, arcane focus, scholar\'s pack', features: 'Arcane Recovery, Spellcasting' },
};
const DND_SKILL_NAMES = ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival'];
const DND_BACKGROUNDS = [
  ['Acolyte', ['Insight', 'Religion']], ['Criminal', ['Deception', 'Stealth']], ['Folk Hero', ['Animal Handling', 'Survival']],
  ['Noble', ['History', 'Persuasion']], ['Sage', ['Arcana', 'History']], ['Soldier', ['Athletics', 'Intimidation']],
  ['Urchin', ['Sleight of Hand', 'Stealth']], ['Entertainer', ['Acrobatics', 'Performance']], ['Hermit', ['Medicine', 'Religion']],
];
const DND_HOOKS = [
  'owes a debt to a dangerous guild', 'is hunting the beast that burned their village', 'carries a sealed letter they must not open',
  'was the only survivor of a doomed expedition', 'swore an oath they are starting to regret', 'is secretly heir to a fallen house',
  'has a map with one corner torn away', 'keeps hearing a voice in their dreams', 'was framed for a crime in the capital',
  'is searching for a missing sibling', 'stole something from a temple and is still being followed', 'wants to prove their old mentor wrong',
];

function dnd5e(base, rnd) {
  const d = structuredClone(base);
  const log = [];
  const race = pick(rnd, Object.keys(DND_RACES));
  const cls = pick(rnd, Object.keys(DND_CLASSES));
  const R = DND_RACES[race], C = DND_CLASSES[cls];
  // 4d6, drop the lowest, six times; best scores go to the class's key abilities
  const sets = Array.from({ length: 6 }, () => roll(rnd, 4, 6));
  const scores = sets.map((r) => sum(r) - Math.min(...r)).sort((a, b) => b - a);
  log.push(`4d6 drop lowest: ${sets.map((r) => `[${r.join(' ')}]`).join(' ')} → ${scores.join(', ')}`);
  const order = [...C.order, ...pickN(rnd, ABIL.filter((a) => !C.order.includes(a)), 3)];
  const abil = Object.fromEntries(order.map((a, i) => [a, scores[i]]));
  const bonus = { ...R.bonus };
  if (R.plusTwo) for (const a of order.filter((x) => x !== 'CHA').slice(0, 2)) bonus[a] = (bonus[a] || 0) + 1;
  for (const a of ABIL) d.abilities[a] = Math.min(20, abil[a] + (bonus[a] || 0));
  const m = Object.fromEntries(ABIL.map((a) => [a, mod(d.abilities[a])]));
  const bg = pick(rnd, DND_BACKGROUNDS);

  d.name = fullName(rnd, 'fantasy');
  d.classLevel = cls; d.level = 1; d.race = race; d.background = bg[0]; d.xp = 0;
  d.speed = R.speed || 30;
  d.hitDice = `1d${C.hd}`;
  d.hpMax = d.hp = Math.max(1, C.hd + m.CON + (R.hpPerLevel || 0));
  d.ac = C.ac(m);
  for (const a of ABIL) d.saves[a] = C.saves.includes(a);
  const skills = new Set(bg[1]);
  const [n, list] = C.skills;
  for (const s of pickN(rnd, (list || DND_SKILL_NAMES).filter((x) => !skills.has(x)), n)) skills.add(s);
  for (const s of Object.keys(d.skills)) d.skills[s] = skills.has(s) ? 1 : 0;
  d.attacks = structuredClone(C.attacks);
  d.spellAbility = C.caster || '';
  for (const l of Object.keys(d.slots)) d.slots[l] = { cur: 0, max: 0 };
  if (C.slots) d.slots[1] = { cur: C.slots, max: C.slots };
  d.spells = (C.spells || []).map(([name, level]) => ({ name, level, prepared: true }));
  d.features = `${C.features}\n${race} traits · ${bg[0]} background feature`;
  d.equipment = `${C.gear}\nArmour: ${C.armour}`;
  d.coins = { cp: 0, sp: 0, gp: sum(roll(rnd, 4, 4)) * 10, pp: 0 };
  d.notes = `Hook: ${d.name.split(' ')[0]} ${pick(rnd, DND_HOOKS)}.`;
  log.push(`${race} ${cls} (${bg[0]}) · ${ABIL.map((a) => `${a} ${d.abilities[a]}`).join(' · ')}`);
  log.push(`HP ${d.hpMax} · AC ${d.ac} · skills: ${[...skills].join(', ')}`);
  return { data: d, log };
}

// ======================================================================
// Call of Cthulhu 7e
// ======================================================================
const COC_OCCUPATIONS = [
  ['Antiquarian', [30, 70], ['Appraise', 'Art/Craft', 'History', 'Library Use', 'Language (Other)', 'Spot Hidden', 'Persuade', 'Occult']],
  ['Author', [9, 30], ['Art/Craft', 'History', 'Library Use', 'Language (Other)', 'Language (Own)', 'Natural World', 'Occult', 'Psychology']],
  ['Doctor of Medicine', [30, 80], ['First Aid', 'Medicine', 'Language (Other)', 'Psychology', 'Science', 'Persuade', 'Spot Hidden', 'Library Use']],
  ['Journalist', [9, 30], ['Art/Craft', 'History', 'Library Use', 'Language (Own)', 'Fast Talk', 'Psychology', 'Spot Hidden', 'Persuade']],
  ['Police Detective', [20, 50], ['Disguise', 'Firearms (Handgun)', 'Law', 'Listen', 'Persuade', 'Psychology', 'Spot Hidden', 'Fighting (Brawl)']],
  ['Private Investigator', [9, 30], ['Disguise', 'Law', 'Library Use', 'Psychology', 'Spot Hidden', 'Locksmith', 'Fast Talk', 'Firearms (Handgun)']],
  ['Professor', [20, 70], ['Library Use', 'Language (Other)', 'Language (Own)', 'Psychology', 'Science', 'History', 'Anthropology', 'Persuade']],
  ['Dilettante', [50, 99], ['Art/Craft', 'Firearms (Rifle/Shotgun)', 'Language (Other)', 'Ride', 'Charm', 'Persuade', 'History', 'Drive Auto']],
  ['Ex-Soldier', [9, 30], ['Climb', 'Dodge', 'Fighting (Brawl)', 'Firearms (Rifle/Shotgun)', 'Stealth', 'Survival', 'First Aid', 'Mech. Repair']],
  ['Archaeologist', [10, 40], ['Appraise', 'Archaeology', 'History', 'Language (Other)', 'Library Use', 'Spot Hidden', 'Mech. Repair', 'Navigate']],
  ['Nurse', [9, 30], ['First Aid', 'Listen', 'Medicine', 'Psychology', 'Science', 'Spot Hidden', 'Charm', 'Persuade']],
];
const COC_WEAPONS = {
  'Firearms (Handgun)': { name: '.38 Revolver', skill: 'Firearms (Handgun)', damage: '1d10', range: '15 yds', attacks: '1 (3)' },
  'Firearms (Rifle/Shotgun)': { name: '12-gauge Shotgun', skill: 'Firearms (Rifle/Shotgun)', damage: '4d6/2d6/1d6', range: '10/20/50 yds', attacks: '1 or 2' },
};
const COC_BACKSTORY = {
  belief: ['There is a higher power that protects the righteous', 'Science will explain everything in time', 'Everyone has a price', 'The old stories are true', 'Family comes before everything'],
  person: ['a younger sibling who looks up to them', 'the professor who taught them everything', 'an old war comrade', 'a childhood sweetheart', 'a rival they secretly admire'],
  place: ['the family farm upstate', 'a quiet reading room at the university library', 'a smoky jazz club downtown', 'the lighthouse where they grew up', 'a parish church in the old country'],
  possession: ['a pocket watch that stopped on the day their father died', 'a battered field journal', 'a silver cigarette case with someone else\'s initials', 'a lucky coin from Cairo', 'a photograph they never show anyone'],
};

function coc7(base, rnd) {
  const d = structuredClone(base);
  const log = [];
  const r3 = () => sum(roll(rnd, 3, 6)) * 5;
  const r2 = () => (sum(roll(rnd, 2, 6)) + 6) * 5;
  const c = { STR: r3(), CON: r3(), SIZ: r2(), DEX: r3(), APP: r3(), INT: r2(), POW: r3(), EDU: r2() };
  log.push(`3d6×5 / (2d6+6)×5: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  // one EDU improvement check for an investigator in their twenties or thirties
  const age = 19 + rnd(20);
  const check = rnd(100);
  if (check > c.EDU) { const gain = rnd(10); c.EDU = Math.min(99, c.EDU + gain); log.push(`EDU improvement: rolled ${check}, +${gain} → ${c.EDU}`); }
  d.chars = c;
  d.age = age;
  d.luck = r3();
  d.san = d.sanStart = c.POW;
  d.hp = Math.floor((c.CON + c.SIZ) / 10);
  d.mp = Math.floor(c.POW / 5);

  const [occ, [crLo, crHi], occSkills] = pick(rnd, COC_OCCUPATIONS);
  d.occupation = occ;
  d.name = fullName(rnd, 'twenties');
  const skill = (n) => d.skills.find((s) => s.name === n);
  skill('Dodge').value = Math.floor(c.DEX / 2);
  skill('Language (Own)').value = c.EDU;
  const baseVal = Object.fromEntries(d.skills.map((s) => [s.name, s.value]));
  // occupation points: EDU × 4, Credit Rating first; personal interest points: INT × 2
  let occPts = c.EDU * 4;
  const cr = crLo + rnd(crHi - crLo + 1) - 1;
  skill('Credit Rating').value = cr; occPts -= cr;
  const cap = 75;
  const add = (n, p) => { skill(n).value += p; };
  spread(rnd, occSkills, Math.floor(Math.max(0, occPts) / 5), { cap: (n) => skill(n).value + 5 > cap, weight: (n) => (skill(n).value < 50 ? 2 : 1), step: (n) => add(n, 5) });
  const others = d.skills.map((s) => s.name).filter((n) => !occSkills.includes(n) && !['Credit Rating', 'Cthulhu Mythos'].includes(n));
  const interests = pickN(rnd, others, 4);
  spread(rnd, interests, Math.floor(c.INT * 2 / 5), { cap: (n) => skill(n).value + 5 > cap, step: (n) => add(n, 5) });
  const raised = d.skills.filter((s) => s.value !== baseVal[s.name] || s.name === 'Credit Rating').map((s) => `${s.name} ${s.value}`);

  d.weapons = [base.weapons[0], ...occSkills.filter((s) => COC_WEAPONS[s]).map((s) => ({ ...COC_WEAPONS[s] }))];
  if (d.weapons.length === 1) d.weapons.push({ name: 'Pocket knife', skill: 'Fighting (Brawl)', damage: '1d4+DB', range: '—', attacks: '1' });
  const bs = Object.fromEntries(Object.entries(COC_BACKSTORY).map(([k, v]) => [k, pick(rnd, v)]));
  d.backstory = `Ideology: ${bs.belief}.\nSignificant person: ${bs.person}.\nMeaningful place: ${bs.place}.\nTreasured possession: ${bs.possession}.`;
  d.gear = cr >= 50 ? 'Good clothes, a motor car, a little cash put by' : cr >= 20 ? 'Respectable clothes, a camera or notebook, bus fare' : 'Worn clothes, a pocket knife, a few coins';
  log.push(`${occ}, age ${age} · HP ${d.hp} · MP ${d.mp} · SAN ${d.san} · Luck ${d.luck} · Credit Rating ${cr}`);
  log.push(`Skills: ${raised.join(', ')}`);
  return { data: d, log };
}

// ======================================================================
// Traveller
// ======================================================================
const TRAV_CHARS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'];
const TRAV_CAREERS = [
  ['Navy', ['Pilot (Spacecraft)', 'Vacc Suit', 'Gunner (Turret)', 'Electronics (Sensors)', 'Engineer (M-drive)', 'Tactics (Naval)'], { name: 'Laser pistol', damage: '3d6', skill: 'Gun Combat (Energy)' }],
  ['Marine', ['Gun Combat (Slug)', 'Vacc Suit', 'Melee (Blade)', 'Athletics (Endurance)', 'Recon', 'Tactics (Military)'], { name: 'Gauss rifle', damage: '4d6', skill: 'Gun Combat (Slug)' }],
  ['Army', ['Gun Combat (Slug)', 'Drive (Wheel)', 'Recon', 'Heavy Weapons (Man Portable)', 'Medic', 'Survival'], { name: 'Assault rifle', damage: '3d6', skill: 'Gun Combat (Slug)' }],
  ['Scout', ['Pilot (Small Craft)', 'Astrogation', 'Electronics (Sensors)', 'Survival', 'Mechanic', 'Vacc Suit'], { name: 'Autopistol', damage: '3d6-3', skill: 'Gun Combat (Slug)' }],
  ['Merchant', ['Broker', 'Steward', 'Persuade', 'Pilot (Spacecraft)', 'Admin', 'Streetwise'], { name: 'Body pistol', damage: '2d6', skill: 'Gun Combat (Slug)' }],
  ['Agent', ['Investigate', 'Streetwise', 'Deception', 'Electronics (Computers)', 'Gun Combat (Slug)', 'Recon'], { name: 'Snub pistol', damage: '3d6-3', skill: 'Gun Combat (Slug)' }],
  ['Rogue', ['Deception', 'Stealth', 'Streetwise', 'Gun Combat (Slug)', 'Melee (Blade)', 'Gambler'], { name: 'Dagger', damage: '1d6+2', skill: 'Melee (Blade)' }],
  ['Scholar', ['Science', 'Investigate', 'Electronics (Computers)', 'Medic', 'Admin', 'Language'], { name: 'Stunner', damage: '2d6', skill: 'Gun Combat (Energy)' }],
  ['Drifter', ['Survival', 'Streetwise', 'Mechanic', 'Melee (Unarmed)', 'Recon', 'Athletics (Dexterity)'], { name: 'Shotgun', damage: '4d6', skill: 'Gun Combat (Slug)' }],
  ['Entertainer', ['Art (Performer)', 'Carouse', 'Persuade', 'Deception', 'Steward', 'Art (Instrument)'], { name: 'Body pistol', damage: '2d6', skill: 'Gun Combat (Slug)' }],
  ['Noble', ['Diplomat', 'Leadership', 'Admin', 'Carouse', 'Persuade', 'Melee (Blade)'], { name: 'Rapier', damage: '2d6', skill: 'Melee (Blade)' }],
];
const TRAV_CHAR_OF = (name) => {
  const T = globalThis.Traveller;
  if (T?.defaultCharFor) return T.defaultCharFor(name);
  return /Pilot|Gun|Vacc|Drive|Gunner|Stealth|Athletics \(Dex|Melee \(Blade|Instrument/.test(name) ? 'DEX'
    : /Melee|Athletics \(Str/.test(name) ? 'STR' : /Endurance/.test(name) ? 'END'
      : /Persuade|Diplomat|Leadership|Carouse|Steward/.test(name) ? 'SOC' : /Admin|Astrogation|Engineer|Mechanic|Medic|Science|Electronics \(Comp|Language|Survival|Broker/.test(name) ? 'EDU' : 'INT';
};
const TRAV_HOOKS = ['left the service under a cloud', 'is owed a favour by a minor noble', 'has a ship\'s mortgage hanging over them', 'saw something in the Deep that they won\'t talk about', 'is still in touch with an old crewmate turned pirate', 'carries a data wafer someone wants back'];

function traveller(base, rnd) {
  const d = structuredClone(base);
  const log = [];
  const rolls = TRAV_CHARS.map(() => roll(rnd, 2, 6));
  TRAV_CHARS.forEach((c, i) => { const v = sum(rolls[i]); d.chars[c] = { max: v, cur: v }; });
  const hexd = (v) => '0123456789ABCDEFG'[v] ?? '?';
  log.push(`2d6 each: ${TRAV_CHARS.map((c, i) => `${c} ${sum(rolls[i])}`).join(' · ')} → UPP ${TRAV_CHARS.map((c) => hexd(d.chars[c].max)).join('')}`);
  const [career, skills, weapon] = pick(rnd, TRAV_CAREERS);
  const terms = rnd(4);
  d.name = fullName(rnd, 'scifi');
  d.career = `${career} (${terms} term${terms > 1 ? 's' : ''})`;
  d.age = 18 + terms * 4;
  d.species = 'Human';
  const lv = Object.fromEntries(skills.map((s) => [s, 0]));
  spread(rnd, skills, terms + 2, { cap: (s) => lv[s] >= 3, step: (s) => { lv[s]++; } });
  d.skills = skills.map((name) => ({ name, level: lv[name], char: TRAV_CHAR_OF(name) }));
  d.weapons = [weapon];
  d.armour = pick(rnd, ['Mesh (+2)', 'Cloth (+5)', 'Flak jacket (+3)', 'None']);
  d.credits = `Cr${sum(roll(rnd, terms, 6)) * 1000}`;
  d.equipment = 'Commdot, hand computer, travel bag, rations for a week';
  d.notes = `Hook: ${pick(rnd, TRAV_HOOKS)}.`;
  log.push(`${career}, ${terms} term${terms > 1 ? 's' : ''}, age ${d.age} · ${d.skills.map((s) => `${s.name}-${s.level}`).join(', ')} · ${d.credits}`);
  return { data: d, log };
}

// ======================================================================
// Tales from the Loop
// ======================================================================
const TFTL_ATTR = { Body: ['Sneak', 'Force', 'Move'], Tech: ['Tinker', 'Program', 'Calculate'], Heart: ['Contact', 'Charm', 'Lead'], Mind: ['Investigate', 'Comprehend', 'Empathize'] };
const TFTL_TYPES = {
  Bookworm: { key: ['Investigate', 'Comprehend', 'Empathize'], items: ['Encyclopedia volume with notes in the margin', 'Library card and a stolen reference book'] },
  'Computer Geek': { key: ['Calculate', 'Program', 'Comprehend'], items: ['Home computer and a box of floppy disks', 'Programmable calculator'] },
  Hick: { key: ['Force', 'Sneak', 'Tinker'], items: ['Moped held together with wire', 'Pocketknife from Grandpa'] },
  Jock: { key: ['Force', 'Move', 'Contact'], items: ['Lucky team jacket', 'Brand-new BMX'] },
  'Popular Kid': { key: ['Contact', 'Charm', 'Lead'], items: ['Walkman with the coolest tapes', 'Older sibling\'s car keys'] },
  Rocker: { key: ['Move', 'Charm', 'Empathize'], items: ['Electric guitar', 'Battered boombox'] },
  Troublemaker: { key: ['Sneak', 'Force', 'Charm'], items: ['Slingshot', 'Lock picks made from hairpins'] },
  Weirdo: { key: ['Sneak', 'Investigate', 'Empathize'], items: ['Notebook full of strange drawings', 'Pet rat called Professor'] },
};
const TFTL_TEXT = {
  drive: ['wants to know what\'s really behind the fence', 'needs to prove they\'re not a baby any more', 'wants everyone to get along', 'is desperate to be famous', 'wants to find out what happened to their dad', 'just wants an adventure before summer ends'],
  problem: ['parents are getting divorced', 'is failing maths and hiding the report card', 'gets picked on by older kids', 'has to look after a little brother all the time', 'is moving away at the end of the year', 'broke something valuable and blamed someone else'],
  pride: ['can climb anything', 'knows every bus timetable by heart', 'has never told a lie', 'built a working radio', 'is the fastest runner in class', 'can always make people laugh'],
  anchor: ['Grandma', 'the school janitor', 'an older cousin', 'the librarian', 'their scout leader', 'the lady at the corner shop'],
};

function tftl(base, rnd) {
  const d = structuredClone(base);
  const type = pick(rnd, Object.keys(TFTL_TYPES));
  const T = TFTL_TYPES[type];
  const age = 9 + rnd(6); // 10–15
  d.name = fullName(rnd, 'eighties');
  d.type = type; d.age = age; d.luck = 15 - age;
  // attribute points equal to age, each attribute 1–5, the type's key attribute(s) favoured
  const keyAttrs = new Set(T.key.map((s) => Object.keys(TFTL_ATTR).find((a) => TFTL_ATTR[a].includes(s))));
  const attrs = { Body: 1, Tech: 1, Heart: 1, Mind: 1 };
  spread(rnd, Object.keys(attrs), age - 4, { cap: (a) => attrs[a] >= 5, weight: (a) => (keyAttrs.has(a) ? 3 : 1), step: (a) => { attrs[a]++; } });
  d.attrs = attrs;
  // 10 skill points: up to 3 in the type's key skills, up to 1 in anything else
  const sk = Object.fromEntries(Object.values(TFTL_ATTR).flat().map((s) => [s, 0]));
  spread(rnd, Object.keys(sk), 10, { cap: (s) => sk[s] >= (T.key.includes(s) ? 3 : 1), weight: (s) => (T.key.includes(s) ? 4 : 1), step: (s) => { sk[s]++; } });
  d.skills = sk;
  d.iconic = { name: pick(rnd, T.items), bonus: rnd(2) };
  for (const k of ['drive', 'problem', 'pride']) d[k] = `${d.name.split(' ')[0]} ${pick(rnd, TFTL_TEXT[k])}`;
  d.anchor = pick(rnd, TFTL_TEXT.anchor);
  const log = [
    `${type}, age ${age} · Luck ${d.luck} · ${Object.entries(attrs).map(([a, v]) => `${a} ${v}`).join(' · ')}`,
    `Skills: ${Object.entries(sk).filter(([, v]) => v).map(([s, v]) => `${s} ${v}`).join(', ')} · Iconic item: ${d.iconic.name} (+${d.iconic.bonus})`,
  ];
  return { data: d, log };
}

// ======================================================================
// Cyberpunk RED
// ======================================================================
const CPR_STATS = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];
const CPR_ROLES = {
  Rockerboy: { ability: 'Charismatic Impact', stats: ['COOL', 'EMP', 'WILL'], skills: ['Persuasion', 'Human Perception', 'Conversation'], weapon: { name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 } },
  Solo: { ability: 'Combat Awareness', stats: ['REF', 'DEX', 'BODY'], skills: ['Handgun', 'Shoulder Arms', 'Evasion', 'Brawling'], weapon: { name: 'Assault Rifle', skill: 'Shoulder Arms', damage: '5d6', rof: 1 } },
  Netrunner: { ability: 'Interface', stats: ['INT', 'TECH', 'REF'], skills: ['Education', 'Concentration', 'Stealth'], weapon: { name: 'Medium Pistol', skill: 'Handgun', damage: '2d6', rof: 2 } },
  Tech: { ability: 'Maker', stats: ['TECH', 'INT', 'DEX'], skills: ['Education', 'First Aid', 'Perception'], weapon: { name: 'Shotgun', skill: 'Shoulder Arms', damage: '5d6', rof: 1 } },
  Medtech: { ability: 'Medicine', stats: ['TECH', 'INT', 'EMP'], skills: ['First Aid', 'Human Perception', 'Education'], weapon: { name: 'Medium Pistol', skill: 'Handgun', damage: '2d6', rof: 2 } },
  Media: { ability: 'Credibility', stats: ['INT', 'COOL', 'EMP'], skills: ['Conversation', 'Human Perception', 'Perception'], weapon: { name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 } },
  Exec: { ability: 'Teamwork', stats: ['INT', 'COOL', 'EMP'], skills: ['Persuasion', 'Human Perception', 'Education'], weapon: { name: 'Very Heavy Pistol', skill: 'Handgun', damage: '4d6', rof: 1 } },
  Lawman: { ability: 'Backup', stats: ['REF', 'BODY', 'COOL'], skills: ['Handgun', 'Perception', 'Shoulder Arms'], weapon: { name: 'Shotgun', skill: 'Shoulder Arms', damage: '5d6', rof: 1 } },
  Fixer: { ability: 'Operator', stats: ['INT', 'COOL', 'EMP'], skills: ['Persuasion', 'Conversation', 'Local Expert (Your Home)'], weapon: { name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 } },
  Nomad: { ability: 'Moto', stats: ['REF', 'TECH', 'BODY'], skills: ['Driving', 'Shoulder Arms', 'Athletics'], weapon: { name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 } },
};
const CPR_LOOKS = ['chrome mohawk and a long coat', 'neon tattoos down both arms', 'mirrorshades and a perfect suit', 'patched leathers covered in band pins', 'a cheap kevlar vest and a nervous grin', 'cyberoptics that glow faintly amber'];
const CPR_HOOKS = ['owes eddies to a Tyger Claws loan shark', 'is wanted for questioning by a megacorp', 'lost a friend in a botched heist', 'is looking for the ripperdoc who botched their cyberware', 'has a fixer who keeps calling about \'one last job\'', 'saw something they shouldn\'t have in the Combat Zone'];

function cyberpunk(base, rnd) {
  const d = structuredClone(base);
  const role = pick(rnd, Object.keys(CPR_ROLES));
  const R = CPR_ROLES[role];
  // 62 points across the ten stats, each 2–8, leaning towards the role's key stats
  const st = Object.fromEntries(CPR_STATS.map((s) => [s, 2]));
  spread(rnd, CPR_STATS, 62 - 20, { cap: (s) => st[s] >= 8, weight: (s) => (R.stats.includes(s) ? 3 : 1), step: (s) => { st[s]++; } });
  d.stats = st;
  d.name = fullName(rnd, 'cyber');
  d.handle = pick(rnd, NAMES.cyber.first);
  d.role = role; d.roleAbility = R.ability; d.roleRank = 4;
  // skills: the basic skills start at 2, plus 20 extra levels leaning on the role's skills, max 6
  const names = d.skills.map((s) => s.name);
  const skill = (n) => d.skills.find((s) => s.name === n);
  spread(rnd, names, 20, { cap: (n) => skill(n).level >= 6, weight: (n) => (R.skills.includes(n) ? 5 : 1), step: (n) => { skill(n).level++; } });
  d.hpMax = d.hp = 10 + 5 * Math.ceil((st.BODY + st.WILL) / 2);
  d.humanity = st.EMP * 10;
  d.luckCur = st.LUCK;
  d.weapons = [{ ...R.weapon }];
  d.notes = `Look: ${pick(rnd, CPR_LOOKS)}.\nHook: ${pick(rnd, CPR_HOOKS)}.`;
  const top = d.skills.filter((s) => s.level >= 4).map((s) => `${s.name} ${s.level}`);
  return {
    data: d,
    log: [`${role} (${R.ability}) · ${CPR_STATS.map((s) => `${s} ${st[s]}`).join(' · ')}`, `HP ${d.hpMax} · Humanity ${d.humanity} · best skills: ${top.join(', ') || '—'}`],
  };
}

// ======================================================================
// Savage Worlds
// ======================================================================
const SW_ATTRS = ['Agility', 'Smarts', 'Spirit', 'Strength', 'Vigor'];
const SW_EXTRA = [['Fighting', 'Agility'], ['Shooting', 'Agility'], ['Driving', 'Agility'], ['Riding', 'Agility'], ['Healing', 'Smarts'],
  ['Intimidation', 'Spirit'], ['Repair', 'Smarts'], ['Survival', 'Smarts'], ['Taunt', 'Smarts'], ['Thievery', 'Agility'], ['Academics', 'Smarts'],
  ['Gambling', 'Smarts'], ['Research', 'Smarts'], ['Occult', 'Smarts'], ['Electronics', 'Smarts'], ['Battle', 'Smarts']];
const SW_CONCEPTS = [
  ['Gunslinger', ['Shooting', 'Intimidation'], 'Agility'], ['Brawler', ['Fighting', 'Intimidation'], 'Strength'],
  ['Scholar', ['Academics', 'Research', 'Occult'], 'Smarts'], ['Scout', ['Survival', 'Shooting', 'Riding'], 'Agility'],
  ['Grifter', ['Gambling', 'Thievery', 'Taunt'], 'Smarts'], ['Medic', ['Healing', 'Repair'], 'Smarts'],
  ['Soldier', ['Fighting', 'Shooting', 'Battle'], 'Vigor'], ['Mechanic', ['Repair', 'Driving', 'Electronics'], 'Smarts'],
];
const SW_HINDRANCES = { major: ['Code of Honor', 'Heroic', 'Loyal', 'Vengeful', 'Wanted', 'Arrogant', 'Overconfident', 'Death Wish'], minor: ['Curious', 'Cautious', 'Stubborn', 'Quirk', 'Big Mouth', 'Greedy', 'Habit', 'Pacifist', 'Poverty', 'Suspicious'] };
const SW_EDGES = ['Alertness', 'Brawny', 'Quick', 'Luck', 'Fleet-Footed', 'Level Headed', 'Marksman', 'Brave', 'Attractive', 'Rich', 'Healer', 'Charismatic'];
const SW_WEAPONS = {
  Fighting: { name: 'Sabre', damage: 'Str+d6', ap: 0, range: '' },
  Shooting: { name: 'Colt Peacemaker', damage: '2d6+1', ap: 1, range: '12/24/48' },
};

function savage(base, rnd) {
  const d = structuredClone(base);
  const [concept, likes, keyAttr] = pick(rnd, SW_CONCEPTS);
  const step = (v) => String(Math.min(12, (+v || 4) + 2));
  // five attribute steps from d4
  const attrs = Object.fromEntries(SW_ATTRS.map((a) => [a, '4']));
  spread(rnd, SW_ATTRS, 5, { cap: (a) => +attrs[a] >= 12, weight: (a) => (a === keyAttr ? 4 : 1), step: (a) => { attrs[a] = step(attrs[a]); } });
  d.attrs = attrs;
  // core skills start at d4; the concept's skills join the list; 12 points, costing 2 per step above the linked attribute
  const skills = [...base.skills.filter((s) => !['Fighting', 'Shooting'].includes(s.name)).map((s) => ({ ...s }))];
  for (const n of [...new Set(['Fighting', ...likes])]) {
    const ex = SW_EXTRA.find(([x]) => x === n);
    skills.push({ name: n, attr: ex ? ex[1] : 'Agility', die: '0' });
  }
  const sk = (n) => skills.find((s) => s.name === n);
  const cost = (n) => { const s = sk(n); return (+s.die || 0) >= (+attrs[s.attr] || 4) ? 2 : 1; };
  spread(rnd, skills.map((s) => s.name), 12, {
    cap: (n) => +sk(n).die >= 12, cost,
    weight: (n) => (likes.includes(n) ? 5 : n === 'Fighting' ? 2 : 1),
    step: (n) => { const s = sk(n); s.die = +s.die ? step(s.die) : '4'; },
  });
  d.skills = skills.filter((s) => +s.die);
  d.name = fullName(rnd, 'pulp');
  d.concept = concept; d.rank = 'Novice';
  d.bennies = 3; d.wounds = 0; d.fatigue = 0;
  const hind = [pick(rnd, SW_HINDRANCES.major), ...pickN(rnd, SW_HINDRANCES.minor, 2)];
  d.hindrances = `${hind[0]} (Major), ${hind[1]} (Minor), ${hind[2]} (Minor)`;
  d.edges = pickN(rnd, SW_EDGES, 2).join(', ');
  d.weapons = ['Shooting', 'Fighting'].filter((n) => sk(n) && +sk(n).die).map((n) => ({ ...SW_WEAPONS[n] }));
  if (!d.weapons.length) d.weapons = [{ name: 'Knife', damage: 'Str+d4', ap: 0, range: '3/6/12' }];
  d.gear = 'Bedroll, canteen, lantern, rope, $' + (rnd(6) * 50);
  return {
    data: d,
    log: [`${concept} · ${SW_ATTRS.map((a) => `${a} d${attrs[a]}`).join(' · ')}`,
      `Skills: ${d.skills.map((s) => `${s.name} d${s.die}`).join(', ')} · Edges: ${d.edges} · Hindrances: ${d.hindrances}`],
  };
}

// ======================================================================
// Generic
// ======================================================================
const GEN_CONCEPTS = ['Disgraced knight', 'Street doctor', 'Runaway heir', 'Retired smuggler', 'Haunted priest', 'Wandering musician', 'Bounty hunter', 'Failed inventor', 'Bodyguard', 'Cartographer'];
const GEN_TRAITS = ['Brave to a fault', 'Never forgets a face', 'Quick with a joke', 'Unshakeably calm', 'Hopelessly curious', 'Fiercely loyal', 'Silver-tongued', 'Light-fingered'];
const GEN_FLAWS = ['Can\'t resist a wager', 'Terrified of the dark', 'Owes money everywhere', 'Trusts the wrong people', 'Short-tempered', 'Hunted by an old enemy', 'Proud', 'Bad liar'];

function generic(base, rnd) {
  const d = structuredClone(base);
  const st = { Body: sum(roll(rnd, 3, 6)), Mind: sum(roll(rnd, 3, 6)), Spirit: sum(roll(rnd, 3, 6)) };
  const m = (v) => Math.floor((v - 10) / 2);
  d.name = fullName(rnd, pick(rnd, ['fantasy', 'pulp', 'scifi']));
  d.hpMax = d.hp = 6 + st.Body;
  const concept = pick(rnd, GEN_CONCEPTS);
  d.fields = [
    { label: 'Concept', value: concept },
    ...Object.entries(st).map(([k, v]) => ({ label: k, value: `${v} (${signed(m(v))})` })),
    { label: 'Trait', value: pick(rnd, GEN_TRAITS) },
    { label: 'Flaw', value: pick(rnd, GEN_FLAWS) },
  ];
  d.rolls = Object.entries(st).map(([k, v]) => ({ label: `${k} check`, expr: m(v) ? `1d20${signed(m(v))}` : '1d20' }));
  d.rolls.push({ label: 'Damage', expr: '1d6' });
  return { data: d, log: [`3d6 each: ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(' · ')} · HP ${d.hpMax}`, `${concept} · ${d.fields[4].value} · ${d.fields[5].value}`] };
}

export const GENERATORS = { dnd5e, coc7, traveller, tftl, cpr: cyberpunk, swade: savage, generic };

export function generate(system, blank, rnd = cryptoRnd) {
  const gen = GENERATORS[system] || generic;
  return gen(blank, rnd);
}
