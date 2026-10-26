// Builds Lantern's D&D 5e compendium (public/rules/dnd5e/*.json) from the 5e-bits SRD 5.1 data.
//   git clone --depth 1 https://github.com/5e-bits/5e-database
//   node scripts/build-srd.js 5e-database/src/2014/en
// The SRD 5.1 is © Wizards of the Coast, licensed CC-BY-4.0 (see public/rules/dnd5e/LICENSE.txt).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-srd.js <5e-database/src/2014/en>'); process.exit(1); }
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'rules', 'dnd5e');
fs.mkdirSync(out, { recursive: true });
const read = (f) => JSON.parse(fs.readFileSync(path.join(src, `5e-SRD-${f}.json`), 'utf8'));
const write = (f, data) => {
  fs.writeFileSync(path.join(out, `${f}.json`), JSON.stringify(data));
  console.log(`${f}: ${data.length} entries, ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`);
};
const paras = (a) => (Array.isArray(a) ? a.join('\n\n') : a || '');
const mod = (v) => Math.floor((v - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const crText = (cr) => ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[cr] || String(cr));

// ---- monsters: structured, rendered as a stat block in the app
const monsters = read('Monsters').map((m) => {
  const ac = m.armor_class?.[0];
  const actionsOf = (list) => (list || []).map((a) => ({
    name: a.name,
    desc: a.desc || '',
    ...(a.attack_bonus != null ? { bonus: a.attack_bonus } : {}),
    ...(a.damage?.length ? { dmg: a.damage.filter((d) => d.damage_dice).map((d) => ({ dice: d.damage_dice.replace(/\s+/g, ''), type: d.damage_type?.name || '' })) } : {}),
    ...(a.dc ? { dc: { ability: a.dc.dc_type?.name, value: a.dc.dc_value } } : {}),
    ...(a.usage ? { usage: a.usage.type === 'recharge on roll' ? `Recharge ${a.usage.min_value}–6` : a.usage.times ? `${a.usage.times}/${a.usage.type.replace('per ', '')}` : a.usage.type } : {}),
  }));
  const saves = [], skills = [];
  for (const p of m.proficiencies || []) {
    const n = p.proficiency.name;
    if (n.startsWith('Saving Throw: ')) saves.push(`${n.slice(14)} ${signed(p.value)}`);
    if (n.startsWith('Skill: ')) skills.push(`${n.slice(7)} ${signed(p.value)}`);
  }
  return {
    id: m.index, name: m.name,
    size: m.size, type: m.type + (m.subtype ? ` (${m.subtype})` : ''), alignment: m.alignment,
    ac: ac ? `${ac.value}${ac.type && ac.type !== 'natural' && ac.type !== 'dex' ? ` (${(ac.armor || []).map((x) => x.name.toLowerCase()).join(', ') || ac.type})` : ac.type === 'natural' ? ' (natural armor)' : ''}` : '',
    acValue: ac?.value ?? null,
    hp: m.hit_points, hd: m.hit_points_roll || m.hit_dice,
    speed: Object.entries(m.speed || {}).map(([k, v]) => (k === 'walk' ? v : k === 'hover' ? 'hover' : `${k} ${v}`)).join(', '),
    abilities: [m.strength, m.dexterity, m.constitution, m.intelligence, m.wisdom, m.charisma],
    saves, skills,
    vuln: m.damage_vulnerabilities, resist: m.damage_resistances, immune: m.damage_immunities,
    condImmune: (m.condition_immunities || []).map((c) => c.name),
    senses: Object.entries(m.senses || {}).map(([k, v]) => (k === 'passive_perception' ? `passive Perception ${v}` : `${k} ${v}`)).join(', '),
    languages: m.languages || '—',
    cr: crText(m.challenge_rating), crValue: m.challenge_rating, xp: m.xp, pb: m.proficiency_bonus,
    traits: actionsOf(m.special_abilities), actions: actionsOf(m.actions),
    reactions: actionsOf(m.reactions), legendary: actionsOf(m.legendary_actions),
    initMod: mod(m.dexterity),
  };
});
write('monsters', monsters);

// ---- spells
const ordinal = (n) => ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'][n];
const spells = read('Spells').map((s) => ({ ...s, damage: Array.isArray(s.damage) ? s.damage[0] : s.damage })).map((s) => ({
  id: s.index, name: s.name,
  sub: s.level === 0 ? `${s.school.name} cantrip` : `${ordinal(s.level)}-level ${s.school.name.toLowerCase()}${s.ritual ? ' (ritual)' : ''}`,
  level: s.level, school: s.school.name,
  facts: [
    ['Casting Time', s.casting_time], ['Range', s.range],
    ['Components', `${s.components.join(', ')}${s.material ? ` (${s.material.replace(/\.$/, '')})` : ''}`],
    ['Duration', `${s.concentration ? 'Concentration, ' : ''}${s.duration}`],
    ['Classes', (s.classes || []).map((c) => c.name).join(', ')],
  ],
  text: paras(s.desc) + (s.higher_level?.length ? `\n\n**At Higher Levels.** ${paras(s.higher_level)}` : ''),
  ...(s.damage?.damage_at_slot_level ? { dmgSlot: s.damage.damage_at_slot_level } : {}),
  ...(s.damage?.damage_at_character_level ? { dmgChar: s.damage.damage_at_character_level } : {}),
  ...(s.heal_at_slot_level ? { healSlot: s.heal_at_slot_level } : {}),
  ...(s.dc ? { save: s.dc.dc_type?.name } : {}),
  ...(s.attack_type ? { attack: s.attack_type } : {}),
  dmgType: s.damage?.damage_type?.name || '',
}));
write('spells', spells);

// ---- conditions
write('conditions', read('Conditions').map((c) => ({ id: c.index, name: c.name, sub: 'Condition', text: paras(c.desc) })));

// ---- magic items
write('magic-items', read('Magic-Items').filter((i) => !i.variant).map((i) => ({
  id: i.index, name: i.name,
  sub: `${i.equipment_category?.name || 'Wondrous item'}, ${(i.rarity?.name || '').toLowerCase()}`,
  text: paras((i.desc || []).slice(1).length ? i.desc.slice(1) : i.desc),
})));

// ---- equipment (weapons, armour, gear)
write('equipment', read('Equipment').map((e) => {
  const facts = [];
  if (e.cost) facts.push(['Cost', `${e.cost.quantity} ${e.cost.unit}`]);
  if (e.weight) facts.push(['Weight', `${e.weight} lb.`]);
  if (e.damage) facts.push(['Damage', `${e.damage.damage_dice} ${e.damage.damage_type?.name?.toLowerCase() || ''}`]);
  if (e.two_handed_damage) facts.push(['Two-handed', `${e.two_handed_damage.damage_dice}`]);
  if (e.range?.long) facts.push(['Range', `${e.range.normal}/${e.range.long} ft.`]);
  if (e.properties?.length) facts.push(['Properties', e.properties.map((p) => p.name).join(', ')]);
  if (e.armor_class) facts.push(['Armor Class', `${e.armor_class.base}${e.armor_class.dex_bonus ? ` + Dex${e.armor_class.max_bonus ? ` (max ${e.armor_class.max_bonus})` : ''}` : ''}`]);
  if (e.str_minimum) facts.push(['Strength', `${e.str_minimum}`]);
  if (e.stealth_disadvantage) facts.push(['Stealth', 'Disadvantage']);
  return {
    id: e.index, name: e.name,
    sub: e.category_range || e.armor_category ? `${e.category_range || `${e.armor_category} armor`}` : e.gear_category?.name || e.equipment_category?.name || '',
    facts, text: paras(e.desc), ...(e.damage ? { dmg: e.damage.damage_dice } : {}),
  };
}));

// ---- rules text (the SRD's rules chapters)
write('rules', read('Rule-Sections').map((r) => ({ id: r.index, name: r.name, sub: 'Rules', text: r.desc.replace(/^##\s+.*\n+/, '') })));

fs.writeFileSync(path.join(out, 'LICENSE.txt'), `This compendium includes material taken from the System Reference Document 5.1 ("SRD 5.1")
by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document.
The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License
available at https://creativecommons.org/licenses/by/4.0/legalcode.

Data prepared from the 5e-bits/5e-database project (MIT licence for its code).
`);
console.log('done');
