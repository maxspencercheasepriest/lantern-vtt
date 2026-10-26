// Character sheet definitions. Each system provides defaults, a render function
// (returning HTML wired with data-* attributes) and roll builders.
//
//   data-bind="path"         two-way bound input (type=number binds numbers)
//   data-roll="kind:arg"     roll button, handled by system.roll(kind, arg, data)
//   data-add="listPath"      append a row from system.rows[listPath]()
//   data-del="listPath:i"    remove row i
//   data-set="path:value"    set a value (tracks like wounds)
import { esc } from './util.js';

// ---------- html helpers ----------
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const inp = (d, path, attrs = '') => `<input data-bind="${path}" value="${esc(get(d, path) ?? '')}" ${attrs}>`;
const numInp = (d, path, attrs = '') => inp(d, path, `type="number" ${attrs}`);
const area = (d, path, rows = 3, ph = '') => `<textarea data-bind="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(get(d, path) ?? '')}</textarea>`;
const sel = (d, path, options) => `<select data-bind="${path}">${options.map((o) => {
  const [v, label] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}" ${String(get(d, path)) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
}).join('')}</select>`;
const field = (label, html) => `<label class="f">${esc(label)}${html}</label>`;
const rollBtn = (roll, text = 'Roll', title = '') => `<button class="rollbtn" data-roll="${esc(roll)}" title="${esc(title)}">${esc(text)}</button>`;
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const portrait = (d) => `<div class="portrait" data-portrait style="${d.portrait ? `background-image:url('${esc(d.portrait)}')` : ''}">${d.portrait ? '' : 'Add<br>portrait'}</div>`;

/** Build "2d6+1-2" from base dice and modifiers, skipping zeros. */
export function expr(dice, ...mods) {
  const total = mods.reduce((a, m) => a + (Number(m) || 0), 0);
  return total ? `${dice}${signed(total)}` : dice;
}

// ======================================================================
// Traveller (Mongoose 2e)
// ======================================================================
const TRAV_CHARS = ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'];
// Traveller rules come from Flick's GoDice extension (js/lib/traveller.js), loaded as a global.
const TR = () => globalThis.Traveller;
const travDM = (v) => (TR() ? TR().charDM(v) : Math.floor((Number(v) || 0) / 3) - 2);
const hex = (v) => (Number(v) || 0).toString(16).toUpperCase().replace(/^([0-9A-F]{2,})$/, '$1');
const ehex = (v) => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.max(0, Math.min(33, Number(v) || 0))] ?? hex(v);
const DIFFICULTIES = [[2, 'Simple 2+'], [4, 'Easy 4+'], [6, 'Routine 6+'], [8, 'Average 8+'], [10, 'Difficult 10+'], [12, 'Very Difficult 12+'], [14, 'Formidable 14+']];

const traveller = {
  id: 'traveller',
  name: 'Traveller',
  defaults: () => ({
    name: 'New Traveller', portrait: null, species: 'Human', age: '', career: '',
    chars: Object.fromEntries(TRAV_CHARS.map((c) => [c, { max: 7, cur: 7 }])),
    skills: [
      { name: 'Pilot (spacecraft)', level: 1, char: 'DEX' },
      { name: 'Gun Combat (slug)', level: 0, char: 'DEX' },
      { name: 'Vacc Suit', level: 0, char: 'DEX' },
    ],
    difficulty: 8, boon: 'none', dm: 0,
    weapons: [{ name: 'Autopistol', damage: '3d6-3', skill: 'Gun Combat (slug)' }],
    armour: '', credits: '', equipment: '', notes: '',
  }),
  rows: {
    skills: () => ({ name: '', level: 0, char: 'DEX' }),
    weapons: () => ({ name: '', damage: '2d6', skill: '' }),
  },
  bar(d) {
    const phys = ['STR', 'DEX', 'END'];
    return { cur: phys.reduce((a, c) => a + (+d.chars[c].cur || 0), 0), max: phys.reduce((a, c) => a + (+d.chars[c].max || 0), 0) };
  },
  render(d) {
    const upp = TRAV_CHARS.map((c) => ehex(d.chars[c].max)).join('');
    const skillNames = d.skills.map((s) => s.name).filter(Boolean);
    return `
    <div class="hdr">${portrait(d)}
      <div class="fields">
        ${field('Name', inp(d, 'name', 'class="name-input"'))}
        ${field('Species', inp(d, 'species'))}${field('Age', inp(d, 'age'))}${field('Career', inp(d, 'career'))}
        <div class="f muted small">UPP <span class="mono" style="color:var(--text);font-size:15px">${esc(upp)}</span></div>
      </div>
    </div>
    <div class="sheet-bar">
      ${field('Difficulty', sel(d, 'difficulty', DIFFICULTIES))}
      ${field('Boon / Bane', sel(d, 'boon', [['none', '—'], ['boon', 'Boon (3d6 keep 2 high)'], ['bane', 'Bane (3d6 keep 2 low)']]))}
      ${field('Extra DM', numInp(d, 'dm'))}
    </div>
    <fieldset><legend>Characteristics</legend>
      <div class="stat-grid">${TRAV_CHARS.map((c) => `
        <div class="stat"><span class="k">${c}</span>
          ${numInp(d, `chars.${c}.cur`, 'min="0" max="30" title="Current"')}
          <span class="dm">max ${numInp(d, `chars.${c}.max`, 'min="0" max="30" title="Maximum (before damage)"')}</span>
          ${rollBtn(`char:${c}`, `2D ${signed(travDM(d.chars[c].cur))}`)}
        </div>`).join('')}
      </div>
    </fieldset>
    <fieldset><legend>Skills</legend>
      <div class="list">
        <div class="li hd" style="grid-template-columns:1fr 56px 70px 74px 24px"><span>Skill</span><span>Level</span><span>Char</span><span></span><span></span></div>
        ${d.skills.map((s, i) => `
        <div class="li" style="grid-template-columns:1fr 56px 70px 74px 24px">
          ${inp(d, `skills.${i}.name`, 'placeholder="Skill (speciality)"')}
          ${numInp(d, `skills.${i}.level`, 'min="-3" max="6"')}
          ${sel(d, `skills.${i}.char`, TRAV_CHARS)}
          ${rollBtn(`skill:${i}`, signed(travDM(d.chars[s.char]?.cur) + (+s.level || 0)))}
          <button class="del" data-del="skills:${i}" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="add" data-add="skills">+ Skill</button>
      <p class="muted small" style="margin:6px 0 0">Untrained skills: use level −3. Skill rolls are 2D + characteristic DM + level + extra DM.</p>
    </fieldset>
    <fieldset><legend>Weapons</legend>
      <div class="list">
        ${d.weapons.map((w, i) => `
        <div class="li" style="grid-template-columns:1fr 130px 80px auto auto 24px">
          ${inp(d, `weapons.${i}.name`, 'placeholder="Weapon"')}
          ${inp(d, `weapons.${i}.skill`, 'list="trav-skills" placeholder="Skill"')}
          ${inp(d, `weapons.${i}.damage`, 'class="mono" placeholder="3d6"')}
          ${rollBtn(`attack:${i}`, 'Attack')}${rollBtn(`damage:${i}`, 'Dmg')}
          <button class="del" data-del="weapons:${i}" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="add" data-add="weapons">+ Weapon</button>
      <datalist id="trav-skills">${[...new Set([...skillNames, ...(TR()?.SKILLS || []).map(([n]) => n)])].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <p class="muted small" style="margin:6px 0 0">Attacks use your level in the weapon's skill — another speciality counts as 0, untrained is −3 (less Jack-of-all-Trades).</p>
    </fieldset>
    <div class="fields" style="grid-template-columns:1fr 1fr">
      ${field('Armour', inp(d, 'armour'))}${field('Credits', inp(d, 'credits'))}
    </div>
    ${field('Equipment', area(d, 'equipment'))}
    ${field('Notes', area(d, 'notes', 4))}`;
  },
  roll(kind, arg, d) {
    const dice = d.boon === 'boon' ? '3d6kh2' : d.boon === 'bane' ? '3d6kl2' : '2d6';
    const check = { type: 'effect', target: +d.difficulty || 8 };
    const tag = d.boon !== 'none' ? ` (${d.boon})` : '';
    if (kind === 'char') {
      return { expr: expr(dice, travDM(d.chars[arg].cur), d.dm), label: `${arg} check${tag}`, meta: { check } };
    }
    if (kind === 'skill') {
      const s = d.skills[arg];
      return { expr: expr(dice, travDM(d.chars[s.char]?.cur), s.level, d.dm), label: `${s.name || 'Skill'} (${s.char})${tag}`, meta: { check } };
    }
    if (kind === 'attack') {
      const w = d.weapons[arg];
      const norm = (n) => (TR() ? TR().norm(n) : String(n || '').toLowerCase().trim());
      const exact = d.skills.find((x) => norm(x.name) === norm(w.skill));
      // specialities / Jack-of-all-Trades, as in the extension
      const rule = TR() ? TR().skillLevel(d.skills.map((x) => ({ name: x.name, level: +x.level || 0 })), w.skill || '') : { level: exact ? +exact.level || 0 : -3, how: exact ? 'trained' : 'untrained' };
      const lvl = exact ? +exact.level || 0 : rule.level;
      const ch = exact?.char || (TR() ? TR().defaultCharFor(w.skill) : 'DEX');
      const how = exact || rule.how === 'trained' ? '' : ` (${rule.how})`;
      return {
        expr: expr(dice, travDM(d.chars[ch]?.cur), lvl, d.dm), label: `${w.name || 'Attack'}${tag}`,
        meta: { check, note: `${w.skill || 'Unskilled'} ${signed(lvl)}${how}, ${ch}`, flavour: { name: d.name, weapon: w.name || 'weapon', skill: w.skill || '' } },
      };
    }
    if (kind === 'damage') {
      const w = d.weapons[arg];
      return { expr: w.damage || '1d6', label: `${w.name || 'Weapon'} damage`, meta: { note: 'Add the attack\'s Effect to damage' } };
    }
  },
};

// ======================================================================
// Cyberpunk RED
// ======================================================================
const CPR_STATS = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];
const CPR_SKILLS = [
  ['Athletics', 'DEX', 2], ['Brawling', 'DEX', 2], ['Concentration', 'WILL', 2], ['Conversation', 'EMP', 2],
  ['Education', 'INT', 2], ['Evasion', 'DEX', 2], ['First Aid', 'TECH', 2], ['Human Perception', 'EMP', 2],
  ['Language (Streetslang)', 'INT', 2], ['Local Expert (Your Home)', 'INT', 2], ['Perception', 'INT', 2],
  ['Persuasion', 'COOL', 2], ['Stealth', 'DEX', 2], ['Handgun', 'REF', 0], ['Melee Weapon', 'DEX', 0],
  ['Shoulder Arms', 'REF', 0], ['Driving', 'REF', 0],
];
const cprHpMax = (d) => 10 + 5 * Math.ceil(((+d.stats.BODY || 0) + (+d.stats.WILL || 0)) / 2);

const cyberpunk = {
  id: 'cpr',
  name: 'Cyberpunk RED',
  defaults: () => {
    const d = {
      name: 'New Edgerunner', portrait: null, handle: '', role: 'Solo', roleAbility: '', roleRank: 4,
      stats: Object.fromEntries(CPR_STATS.map((s) => [s, 6])),
      hp: 40, hpMax: 40, humanity: 60, luckCur: 6, luckSpend: 0, mod: 0, dv: '',
      armorHead: 11, armorBody: 11,
      skills: CPR_SKILLS.map(([name, stat, level]) => ({ name, stat, level })),
      weapons: [{ name: 'Heavy Pistol', skill: 'Handgun', damage: '3d6', rof: 2 }],
      cyberware: '', gear: '', notes: '',
    };
    d.hpMax = cprHpMax(d); d.hp = d.hpMax; d.humanity = d.stats.EMP * 10;
    return d;
  },
  rows: {
    skills: () => ({ name: '', stat: 'DEX', level: 0 }),
    weapons: () => ({ name: '', skill: 'Handgun', damage: '2d6', rof: 1 }),
  },
  bar: (d) => ({ cur: +d.hp || 0, max: +d.hpMax || 0 }),
  render(d) {
    const skillNames = d.skills.map((s) => s.name).filter(Boolean);
    const suggested = cprHpMax(d);
    return `
    <div class="hdr">${portrait(d)}
      <div class="fields">
        ${field('Name', inp(d, 'name', 'class="name-input"'))}
        ${field('Handle', inp(d, 'handle'))}${field('Role', inp(d, 'role'))}
        ${field('Role ability', inp(d, 'roleAbility'))}${field('Rank', numInp(d, 'roleRank', 'min="0" max="10"'))}
      </div>
    </div>
    <div class="sheet-bar">
      ${field('HP', numInp(d, 'hp'))}<span class="muted">/</span>${field(`Max (${suggested})`, numInp(d, 'hpMax'))}
      ${field('Humanity', numInp(d, 'humanity'))}
      ${field(`Luck (${d.stats.LUCK})`, numInp(d, 'luckCur', 'min="0"'))}
      ${field('Spend luck', numInp(d, 'luckSpend', 'min="0" title="Added to your next check, then deducted"'))}
      ${field('Mod', numInp(d, 'mod', 'title="Situational modifier on every check"'))}
      ${field('vs DV', numInp(d, 'dv', 'placeholder="—" title="Optional: show beat / fail against this DV"'))}
      ${(+d.hp || 0) < (+d.hpMax || 0) / 2 ? '<span class="flag bad">Seriously wounded −2</span>' : ''}
    </div>
    <fieldset><legend>Stats</legend>
      <div class="stat-grid">${CPR_STATS.map((s) => `
        <div class="stat"><span class="k">${s}</span>${numInp(d, `stats.${s}`, 'min="0" max="10"')}${rollBtn(`stat:${s}`, `d10 ${signed(+d.stats[s] || 0)}`)}</div>`).join('')}
      </div>
    </fieldset>
    <fieldset><legend>Skills</legend>
      <div class="list">
        <div class="li hd" style="grid-template-columns:1fr 74px 50px 70px 24px"><span>Skill</span><span>Stat</span><span>Lvl</span><span>Base</span><span></span></div>
        ${d.skills.map((s, i) => `
        <div class="li" style="grid-template-columns:1fr 74px 50px 70px 24px">
          ${inp(d, `skills.${i}.name`, 'placeholder="Skill"')}
          ${sel(d, `skills.${i}.stat`, CPR_STATS)}
          ${numInp(d, `skills.${i}.level`, 'min="0" max="10"')}
          ${rollBtn(`skill:${i}`, signed((+d.stats[s.stat] || 0) + (+s.level || 0)))}
          <button class="del" data-del="skills:${i}" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="add" data-add="skills">+ Skill</button>
    </fieldset>
    <fieldset><legend>Weapons</legend>
      <div class="list">
        <div class="li hd" style="grid-template-columns:1fr 120px 64px 40px auto auto 24px"><span>Weapon</span><span>Skill</span><span>Dmg</span><span>ROF</span><span></span><span></span><span></span></div>
        ${d.weapons.map((w, i) => `
        <div class="li" style="grid-template-columns:1fr 120px 64px 40px auto auto 24px">
          ${inp(d, `weapons.${i}.name`, 'placeholder="Weapon"')}
          <select data-bind="weapons.${i}.skill">${skillNames.map((n) => `<option ${n === w.skill ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          ${inp(d, `weapons.${i}.damage`, 'class="mono"')}
          ${numInp(d, `weapons.${i}.rof`, 'min="1" max="4"')}
          ${rollBtn(`attack:${i}`, 'Hit')}${rollBtn(`damage:${i}`, 'Dmg')}
          <button class="del" data-del="weapons:${i}" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="add" data-add="weapons">+ Weapon</button>
    </fieldset>
    <div class="fields" style="grid-template-columns:1fr 1fr">
      ${field('Armor SP — head', numInp(d, 'armorHead'))}${field('Armor SP — body', numInp(d, 'armorBody'))}
    </div>
    ${field('Cyberware', area(d, 'cyberware'))}
    ${field('Gear', area(d, 'gear'))}
    ${field('Notes', area(d, 'notes', 4))}`;
  },
  roll(kind, arg, d, commit) {
    const wounded = (+d.hp || 0) < (+d.hpMax || 0) / 2 ? -2 : 0;
    const luck = Math.max(0, Math.min(+d.luckSpend || 0, +d.luckCur || 0));
    const spendLuck = () => { if (luck) { d.luckCur = (+d.luckCur || 0) - luck; d.luckSpend = 0; commit(); } };
    const dvCheck = d.dv !== '' && d.dv != null && Number.isFinite(+d.dv) ? { check: { type: 'beat', target: +d.dv } } : {};
    const note = [wounded && 'Seriously wounded −2', luck && `Luck +${luck}`].filter(Boolean).join(' · ');
    if (kind === 'stat') {
      spendLuck();
      return { expr: expr('1d10cp', d.stats[arg], d.mod, wounded, luck), label: `${arg}`, meta: { ...dvCheck, note } };
    }
    if (kind === 'skill') {
      const s = d.skills[arg];
      spendLuck();
      return { expr: expr('1d10cp', d.stats[s.stat], s.level, d.mod, wounded, luck), label: s.name || 'Skill', meta: { ...dvCheck, note } };
    }
    if (kind === 'attack') {
      const w = d.weapons[arg];
      const s = d.skills.find((x) => x.name === w.skill) || { stat: 'REF', level: 0 };
      spendLuck();
      return { expr: expr('1d10cp', d.stats[s.stat], s.level, d.mod, wounded, luck), label: `${w.name || 'Attack'} (${w.skill || 'unskilled'})`, meta: { ...dvCheck, note } };
    }
    if (kind === 'damage') {
      const w = d.weapons[arg];
      return { expr: w.damage || '2d6', label: `${w.name || 'Weapon'} damage`, meta: { cprDamage: true } };
    }
  },
};

// ======================================================================
// Savage Worlds (Adventure Edition)
// ======================================================================
const SW_ATTRS = ['Agility', 'Smarts', 'Spirit', 'Strength', 'Vigor'];
const SW_DICE = [['4', 'd4'], ['6', 'd6'], ['8', 'd8'], ['10', 'd10'], ['12', 'd12'], ['12+1', 'd12+1'], ['12+2', 'd12+2']];
const SW_SKILL_DICE = [['0', 'untrained'], ...SW_DICE];
const swDie = (v) => { const [die, mod] = String(v || '4').split('+'); return { die: +die || 0, mod: +mod || 0 }; };
const SW_CORE = [['Athletics', 'Agility'], ['Common Knowledge', 'Smarts'], ['Notice', 'Smarts'], ['Persuasion', 'Spirit'], ['Stealth', 'Agility']];

const savage = {
  id: 'swade',
  name: 'Savage Worlds',
  defaults: () => ({
    name: 'New Hero', portrait: null, concept: '', rank: 'Novice', wildCard: true,
    attrs: Object.fromEntries(SW_ATTRS.map((a) => [a, '6'])),
    skills: [...SW_CORE.map(([name, attr]) => ({ name, attr, die: '4' })), { name: 'Fighting', attr: 'Agility', die: '6' }, { name: 'Shooting', attr: 'Agility', die: '6' }],
    pace: 6, parryBonus: 0, armor: 0, toughBonus: 0,
    bennies: 3, wounds: 0, fatigue: 0, mod: 0,
    weapons: [{ name: 'Colt Peacemaker', damage: '2d6+1', ap: 1, range: '12/24/48' }],
    edges: '', hindrances: '', gear: '', notes: '',
  }),
  rows: {
    skills: () => ({ name: '', attr: 'Agility', die: '4' }),
    weapons: () => ({ name: '', damage: 'Str+d6', ap: 0, range: '' }),
  },
  bar: (d) => ({ cur: 3 - (+d.wounds || 0), max: 3 }),
  derived(d) {
    const fighting = d.skills.find((s) => /^fighting$/i.test(s.name));
    const f = fighting ? swDie(fighting.die) : { die: 0, mod: 0 };
    const v = swDie(d.attrs.Vigor);
    return {
      parry: 2 + Math.floor(f.die / 2) + Math.floor(f.mod / 2) + (+d.parryBonus || 0),
      tough: 2 + Math.floor(v.die / 2) + Math.floor(v.mod / 2) + (+d.toughBonus || 0) + (+d.armor || 0),
    };
  },
  render(d) {
    const { parry, tough } = savage.derived(d);
    const pen = (+d.wounds || 0) + (+d.fatigue || 0);
    const track = (path, n, cls = '') => `<span class="track ${cls}">${Array.from({ length: n }, (_, i) =>
      `<button data-set="${path}:${(+get(d, path) || 0) === i + 1 ? i : i + 1}" class="${(+get(d, path) || 0) > i ? 'on' : ''}" title="${i + 1}">${i + 1}</button>`).join('')}</span>`;
    return `
    <div class="hdr">${portrait(d)}
      <div class="fields">
        ${field('Name', inp(d, 'name', 'class="name-input"'))}
        ${field('Concept', inp(d, 'concept'))}
        ${field('Rank', sel(d, 'rank', ['Novice', 'Seasoned', 'Veteran', 'Heroic', 'Legendary']))}
        <label class="check small" style="align-self:end"><input type="checkbox" data-bind="wildCard" ${d.wildCard ? 'checked' : ''}> Wild Card</label>
      </div>
    </div>
    <div class="sheet-bar">
      <span>Bennies</span>${numInp(d, 'bennies', 'min="0" style="width:52px"')}
      <span>Wounds</span>${track('wounds', 3)}
      <span>Fatigue</span>${track('fatigue', 2)}
      ${field('Mod', numInp(d, 'mod'))}
      ${pen ? `<span class="flag bad">−${pen} to traits</span>` : ''}
    </div>
    <fieldset><legend>Attributes</legend>
      <div class="stat-grid">${SW_ATTRS.map((a) => `
        <div class="stat"><span class="k">${a.toUpperCase()}</span>${sel(d, `attrs.${a}`, SW_DICE)}${rollBtn(`attr:${a}`, 'Roll')}</div>`).join('')}
      </div>
    </fieldset>
    <div class="sheet-bar">
      ${field('Pace', numInp(d, 'pace'))}
      <span class="grow"></span>
      <span>Parry <b class="mono">${parry}</b></span>${field('± parry', numInp(d, 'parryBonus'))}
      <span>Toughness <b class="mono">${tough}${+d.armor ? ` (${+d.armor})` : ''}</b></span>${field('Armor', numInp(d, 'armor'))}${field('± tough', numInp(d, 'toughBonus'))}
    </div>
    <fieldset><legend>Skills</legend>
      <div class="list">
        ${d.skills.map((s, i) => `
        <div class="li" style="grid-template-columns:1fr 92px 96px 52px 24px">
          ${inp(d, `skills.${i}.name`, 'placeholder="Skill"')}
          ${sel(d, `skills.${i}.attr`, SW_ATTRS)}
          ${sel(d, `skills.${i}.die`, SW_SKILL_DICE)}
          ${rollBtn(`skill:${i}`, 'Roll')}
          <button class="del" data-del="skills:${i}" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="add" data-add="skills">+ Skill</button>
    </fieldset>
    <fieldset><legend>Weapons</legend>
      <div class="list">
        <div class="li hd" style="grid-template-columns:1fr 84px 40px 82px auto auto 24px"><span>Weapon</span><span>Damage</span><span>AP</span><span>Range</span><span></span><span></span><span></span></div>
        ${d.weapons.map((w, i) => `
        <div class="li" style="grid-template-columns:1fr 84px 40px 82px auto auto 24px">
          ${inp(d, `weapons.${i}.name`, 'placeholder="Weapon"')}
          ${inp(d, `weapons.${i}.damage`, 'class="mono" title="e.g. Str+d6 or 2d6+1"')}
          ${numInp(d, `weapons.${i}.ap`)}
          ${inp(d, `weapons.${i}.range`)}
          ${rollBtn(`damage:${i}`, 'Dmg')}${rollBtn(`raise:${i}`, '+d6', 'Damage with a raise')}
          <button class="del" data-del="weapons:${i}" title="Remove">✕</button>
        </div>`).join('')}
      </div>
      <button class="add" data-add="weapons">+ Weapon</button>
    </fieldset>
    <div class="fields" style="grid-template-columns:1fr 1fr">
      ${field('Edges', area(d, 'edges'))}${field('Hindrances', area(d, 'hindrances'))}
    </div>
    ${field('Gear', area(d, 'gear'))}
    ${field('Notes', area(d, 'notes', 4))}`;
  },
  roll(kind, arg, d) {
    const pen = -((+d.wounds || 0) + (+d.fatigue || 0));
    const trait = (dieStr, label, unskilled) => {
      const { die, mod } = unskilled ? { die: 4, mod: -2 } : swDie(dieStr);
      const base = d.wildCard ? `sw${die}` : `1d${die}!`;
      return {
        expr: expr(base, mod, pen, d.mod), label: unskilled ? `${label} (unskilled)` : label,
        meta: { check: { type: 'raises', target: 4 }, note: pen ? `Wounds/Fatigue ${pen}` : undefined },
      };
    };
    if (kind === 'attr') return trait(d.attrs[arg], arg);
    if (kind === 'skill') {
      const s = d.skills[arg];
      return trait(s.die, s.name || 'Skill', String(s.die) === '0');
    }
    if (kind === 'damage' || kind === 'raise') {
      const w = d.weapons[arg];
      const str = swDie(d.attrs.Strength);
      // every damage die aces; "Str" becomes the Strength die
      let e = String(w.damage || 'Str').replace(/\s+/g, '').replace(/str/i, `1d${str.die}${str.mod ? `+${str.mod}` : ''}`);
      e = e.replace(/(\d*d\d+)(?![\d!])/gi, '$1!');
      if (kind === 'raise') e += '+1d6!';
      return { expr: e, label: `${w.name || 'Weapon'} damage${kind === 'raise' ? ' (raise)' : ''}`, meta: { note: +w.ap ? `AP ${w.ap}` : undefined } };
    }
  },
};

// ======================================================================
// Generic
// ======================================================================
const generic = {
  id: 'generic',
  name: 'Generic',
  defaults: () => ({
    name: 'New Character', portrait: null, hp: 10, hpMax: 10,
    fields: [{ label: 'Class', value: '' }, { label: 'Level', value: '1' }],
    rolls: [{ label: 'Attack', expr: '1d20+5' }, { label: 'Damage', expr: '1d8+3' }],
    notes: '',
  }),
  rows: {
    fields: () => ({ label: '', value: '' }),
    rolls: () => ({ label: '', expr: '1d20' }),
  },
  bar: (d) => ({ cur: +d.hp || 0, max: +d.hpMax || 0 }),
  render(d) {
    return `
    <div class="hdr">${portrait(d)}
      <div class="fields">
        ${field('Name', inp(d, 'name', 'class="name-input"'))}
        ${field('HP', numInp(d, 'hp'))}${field('Max HP', numInp(d, 'hpMax'))}
      </div>
    </div>
    <fieldset><legend>Fields</legend>
      <div class="list">${d.fields.map((f, i) => `
        <div class="li" style="grid-template-columns:120px 1fr 24px">
          ${inp(d, `fields.${i}.label`, 'placeholder="Label"')}${inp(d, `fields.${i}.value`)}
          <button class="del" data-del="fields:${i}" title="Remove">✕</button>
        </div>`).join('')}</div>
      <button class="add" data-add="fields">+ Field</button>
    </fieldset>
    <fieldset><legend>Rolls</legend>
      <div class="list">${d.rolls.map((r, i) => `
        <div class="li" style="grid-template-columns:1fr 120px auto 24px">
          ${inp(d, `rolls.${i}.label`, 'placeholder="Name"')}${inp(d, `rolls.${i}.expr`, 'class="mono" placeholder="1d20+5"')}
          ${rollBtn(`roll:${i}`, 'Roll')}
          <button class="del" data-del="rolls:${i}" title="Remove">✕</button>
        </div>`).join('')}</div>
      <button class="add" data-add="rolls">+ Roll</button>
      <p class="muted small" style="margin:6px 0 0">Notation: 2d6+1 · 4d6kh3 · 1d6! (exploding) · 1d10cp · sw8 (Savage Worlds)</p>
    </fieldset>
    ${field('Notes', area(d, 'notes', 6))}`;
  },
  roll(kind, arg, d) {
    const r = d.rolls[arg];
    return { expr: r.expr, label: r.label || r.expr };
  },
};

export const SYSTEMS = { traveller, cpr: cyberpunk, swade: savage, generic };
export const systemFor = (id) => SYSTEMS[id] || generic;
