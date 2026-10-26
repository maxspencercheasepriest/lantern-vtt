// Built-in rules: the D&D 5e SRD compendium and quick-reference pages for the other rulesets.
import { $, esc, store, toast, openWindow, call } from './util.js';
import { renderMarkdown, plainText } from './markdown.js';
import { REFERENCES, RULESET_INFO } from '/rules/references.js';
import { roll } from './rolls.js';

const DND_CATS = [
  ['rules', 'Rules'], ['conditions', 'Conditions'], ['monsters', 'Monsters'], ['spells', 'Spells'],
  ['magic-items', 'Magic items'], ['equipment', 'Equipment'],
];
export const categoriesFor = (rs) => (rs === 'dnd5e' ? DND_CATS : REFERENCES[rs] ? [['reference', 'Quick reference']] : []);

const cache = new Map(); // `${rs}/${cat}` -> entries
export async function loadCat(rs, cat) {
  const key = `${rs}/${cat}`;
  if (cache.has(key)) return cache.get(key);
  let list;
  if (cat === 'reference') list = (REFERENCES[rs] || []).map((r) => ({ ...r, sub: 'Quick reference' }));
  else {
    const res = await fetch(`/rules/${rs}/${cat}.json`);
    if (!res.ok) throw new Error(`Couldn't load ${cat}`);
    list = await res.json();
  }
  for (const e of list) e._search = `${e.name} ${e.sub || ''} ${e.type || ''} ${plainText(e.text || '')} ${(e.traits || []).concat(e.actions || []).map((a) => `${a.name} ${a.desc}`).join(' ')}`.toLowerCase();
  cache.set(key, list);
  return list;
}

export async function entryNames(rs, cat) { return (await loadCat(rs, cat)).map((e) => e.name); }

/** Search the current ruleset's built-in rules. Name matches first. */
export async function searchRules(rs, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const [cat, catName] of categoriesFor(rs)) {
    for (const e of await loadCat(rs, cat)) {
      if (!terms.every((t) => e._search.includes(t))) continue;
      const nameHit = terms.every((t) => e.name.toLowerCase().includes(t));
      const exact = e.name.toLowerCase() === q.toLowerCase().trim();
      hits.push({ rs, cat, catName, id: e.id, name: e.name, sub: e.sub || e.type || '', score: (exact ? 100 : 0) + (nameHit ? 10 : 0) - e.name.length / 100, snippet: nameHit ? '' : snippetOf(e, terms) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 60);
}
function snippetOf(e, terms) {
  const text = plainText(e.text || (e.traits || []).concat(e.actions || []).map((a) => `${a.name}. ${a.desc}`).join(' '));
  const i = text.toLowerCase().indexOf(terms[0]);
  if (i < 0) return '';
  const a = Math.max(0, i - 60);
  return (a ? '…' : '') + (a ? text.slice(a, i + 120).replace(/^\S*\s/, '') : text.slice(0, i + 120)).replace(/\s\S*$/, '') + '…';
}

// ---------- panel ----------
let panelRs = null;
let panelCat = null;
export function renderRulesPanel(box) {
  const rs = panelRs || store.settings?.ruleset || 'generic';
  const cats = categoriesFor(rs);
  if (!cats.find(([c]) => c === panelCat)) panelCat = cats[0]?.[0] || null;
  box.innerHTML = `
    <div class="row"><select class="rules-rs" aria-label="Ruleset">${Object.entries(RULESET_INFO).map(([k, v]) => `<option value="${k}" ${k === rs ? 'selected' : ''}>${esc(v.name)}${k === store.settings?.ruleset ? ' (this campaign)' : ''}</option>`).join('')}</select></div>
    ${cats.length ? `<div class="chips">${cats.map(([c, n]) => `<button data-cat="${c}" class="${c === panelCat ? 'on' : ''}">${n}</button>`).join('')}</div>
    <input class="rules-filter" type="search" placeholder="Filter…">
    <ul class="rules-list"></ul>` : '<p class="muted">No built-in rules for this ruleset. Add your rulebooks as PDFs and they\'ll be searchable here.</p>'}
    <p class="muted small rules-credit">${rs === 'dnd5e' ? 'Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">CC-BY-4.0</a>.' : cats.length ? "Lantern's own summary of how the mechanics work — use your rulebooks for the full rules." : ''}</p>`;
  box.querySelector('.rules-rs').onchange = (e) => { panelRs = e.target.value; panelCat = null; renderRulesPanel(box); };
  box.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { panelCat = b.dataset.cat; renderRulesPanel(box); }));
  if (!panelCat) return;
  const ul = box.querySelector('.rules-list');
  const filter = box.querySelector('.rules-filter');
  const draw = async () => {
    let list;
    try { list = await loadCat(rs, panelCat); } catch (e) { ul.innerHTML = `<li class="bad">${esc(e.message)}</li>`; return; }
    const f = filter.value.toLowerCase().trim();
    const shown = list.filter((e) => !f || e.name.toLowerCase().includes(f) || (e.type || '').toLowerCase().includes(f)).slice(0, 400);
    ul.innerHTML = shown.map((e) => `<li><button data-id="${esc(e.id)}"><span>${esc(e.name)}</span><small>${esc(panelCat === 'monsters' ? `CR ${e.cr} · ${e.type}` : e.sub || '')}</small></button></li>`).join('') || '<li class="muted">Nothing matches.</li>';
    ul.querySelectorAll('button').forEach((b) => (b.onclick = () => openEntry(rs, panelCat, b.dataset.id)));
  };
  filter.oninput = draw;
  draw();
}
export function setPanelRuleset(rs) { panelRs = rs; }

// ---------- entry windows ----------
export async function openEntryByName(rs, cat, name) {
  const tryCats = cat ? [cat] : categoriesFor(rs).map(([c]) => c);
  for (const c of tryCats) {
    const list = await loadCat(rs, c).catch(() => []);
    const n = name.toLowerCase();
    const e = list.find((x) => x.name.toLowerCase() === n) || list.find((x) => x.name.toLowerCase().startsWith(n));
    if (e) return openEntry(rs, c, e.id);
  }
  toast(`"${name}" isn't in the ${RULESET_INFO[rs]?.name || ''} rules`, true);
}

export async function openEntry(rs, cat, id) {
  const e = (await loadCat(rs, cat)).find((x) => x.id === id);
  if (!e) return toast('Not found', true);
  const w = openWindow(`rules:${rs}:${cat}:${id}`, { title: e.name, width: cat === 'monsters' ? 520 : 480, height: cat === 'rules' ? 640 : 560 });
  if (w.existed) return;
  w.body.classList.add('rulesbody');
  w.body.innerHTML = cat === 'monsters' ? statBlock(e) : `
    ${e.sub ? `<p class="sub">${esc(e.sub)}</p>` : ''}
    ${e.facts?.length ? `<dl class="facts">${e.facts.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    <div class="md">${renderMarkdown(e.text)}</div>
    ${spellButtons(e)}`;
  wireRolls(w, e, cat);
}

const abilityMod = (v) => Math.floor((v - 10) / 2);
const sgn = (n) => (n >= 0 ? `+${n}` : `${n}`);

function statBlock(m) {
  const ab = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const line = (k, v) => (v && (!Array.isArray(v) || v.length) ? `<p><b>${k}</b> ${esc(Array.isArray(v) ? v.join(', ') : v)}</p>` : '');
  const acts = (title, list) => (list?.length ? `<h4>${title}</h4>${list.map((a, i) => `
    <p><b><i>${esc(a.name)}${a.usage ? ` (${esc(a.usage)})` : ''}.</i></b> ${esc(a.desc)}
      ${a.bonus != null ? `<button class="rollbtn" data-r="atk" data-list="${title}" data-i="${i}">${sgn(a.bonus)} to hit</button>` : ''}
      ${(a.dmg || []).map((d, k) => `<button class="rollbtn" data-r="dmg" data-list="${title}" data-i="${i}" data-k="${k}">${esc(d.dice)}${d.type ? ` ${esc(d.type.toLowerCase())}` : ''}</button>`).join('')}
      ${a.dc ? `<span class="muted small">DC ${a.dc.value} ${esc(a.dc.ability || '')}</span>` : ''}
    </p>`).join('')}` : '');
  return `<div class="statblock">
    <p class="sub">${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}</p>
    <hr>
    <p><b>Armor Class</b> ${esc(m.ac)}</p>
    <p><b>Hit Points</b> ${m.hp} (${esc(m.hd)}) <button class="rollbtn" data-r="hp">Roll HP</button></p>
    <p><b>Speed</b> ${esc(m.speed)}</p>
    <hr>
    <div class="abil">${ab.map((a, i) => `<button class="rollbtn" data-r="abil" data-i="${i}" title="${a} check"><b>${a}</b><span>${m.abilities[i]} (${sgn(abilityMod(m.abilities[i]))})</span></button>`).join('')}</div>
    <hr>
    ${line('Saving Throws', m.saves)}${line('Skills', m.skills)}
    ${line('Damage Vulnerabilities', m.vuln)}${line('Damage Resistances', m.resist)}${line('Damage Immunities', m.immune)}
    ${line('Condition Immunities', m.condImmune)}${line('Senses', m.senses)}${line('Languages', m.languages)}
    <p><b>Challenge</b> ${esc(m.cr)} (${(m.xp || 0).toLocaleString()} XP) <span class="muted">· proficiency ${sgn(m.pb || 2)}</span></p>
    <hr>
    ${acts('Traits', m.traits).replace('<h4>Traits</h4>', '')}
    ${acts('Actions', m.actions)}${acts('Reactions', m.reactions)}${acts('Legendary Actions', m.legendary)}
    ${store.isGM ? `<div class="row gm-actions"><label class="f small">Count <input type="number" class="count" value="1" min="1" max="20" style="width:60px"></label>
      <label class="check small"><input type="checkbox" class="rollhp" checked> Roll HP</label>
      <button class="btn primary" data-r="add">Add to combat</button><button class="btn" data-r="addtok">Add with tokens</button></div>` : ''}
  </div>`;
}

function spellButtons(e) {
  if (!e.dmgSlot && !e.dmgChar && !e.healSlot) return '';
  const opts = e.dmgSlot || e.healSlot || e.dmgChar;
  const label = e.dmgChar ? 'At character level' : 'Cast at slot level';
  return `<div class="row spellroll"><label class="f small">${label} <select class="lvl">${Object.keys(opts).map((k) => `<option>${k}</option>`).join('')}</select></label>
    <button class="btn" data-r="spell">${e.healSlot ? 'Roll healing' : `Roll ${esc(e.dmgType || '').toLowerCase()} damage`}</button></div>`;
}

const gmVisibility = () => (store.isGM ? 'gm' : undefined); // GM monster rolls stay behind the screen by default

function wireRolls(w, e, cat) {
  w.body.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-r]');
    if (!b) return;
    const kind = b.dataset.r;
    if (cat === 'spells' && kind === 'spell') {
      const lvl = w.body.querySelector('.lvl').value;
      const dice = (e.dmgSlot || e.healSlot || e.dmgChar)[lvl];
      return roll(String(dice).replace(/\s+/g, '').replace(/\+MOD/i, ''), { label: `${e.name} (${e.dmgChar ? `level ${lvl}` : `slot ${lvl}`})${e.save ? ` · ${e.save} save` : ''}` });
    }
    if (cat !== 'monsters') return;
    const list = { Traits: e.traits, Actions: e.actions, Reactions: e.reactions, 'Legendary Actions': e.legendary }[b.dataset.list];
    const a = list?.[+b.dataset.i];
    if (kind === 'atk') return roll(`1d20${sgn(a.bonus)}`, { label: `${e.name}: ${a.name}`, visibility: gmVisibility() });
    if (kind === 'dmg') { const d = a.dmg[+b.dataset.k]; return roll(d.dice, { label: `${e.name}: ${a.name} damage${d.type ? ` (${d.type.toLowerCase()})` : ''}`, visibility: gmVisibility() }); }
    if (kind === 'hp') return roll(e.hd.replace(/\s+/g, ''), { label: `${e.name}: hit points`, visibility: gmVisibility() });
    if (kind === 'abil') return roll(`1d20${sgn(abilityMod(e.abilities[+b.dataset.i]))}`, { label: `${e.name}: ${['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'][+b.dataset.i]} check`, visibility: gmVisibility() });
    if (kind === 'add' || kind === 'addtok') {
      const count = Math.max(1, Math.min(20, +w.body.querySelector('.count').value || 1));
      const rollHp = w.body.querySelector('.rollhp').checked;
      await addMonsters(e, count, rollHp, kind === 'addtok');
    }
  });
}

/** Rolls hit dice locally (it's GM-only information) and adds the monsters to the tracker. */
function rollHp(hd) {
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(hd.replace(/\s+/g, ''));
  if (!m) return null;
  let t = +(m[3] || 0);
  const buf = new Uint32Array(+m[1]);
  crypto.getRandomValues(buf);
  for (const x of buf) t += (x % +m[2]) + 1;
  return Math.max(1, t);
}

export async function addMonsters(m, count, doRoll, withTokens) {
  const entries = [];
  const sizeSq = { Tiny: 0.5, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 }[m.size] || 1;
  let tokenIds = [];
  if (withTokens) {
    const { viewCenter } = await import('./map.js');
    const c = viewCenter();
    const g = store.scene.map.gridSize;
    for (let i = 0; i < count; i++) {
      const res = await call(window.__lanternSocket, 'token:add', {
        x: c.x + (i % 5) * g * sizeSq - g, y: c.y + Math.floor(i / 5) * g * sizeSq - g, size: sizeSq,
        label: count > 1 ? `${m.name} ${i + 1}` : m.name, color: '#8e2c2c', owners: [],
      }).catch((er) => { toast(er.message, true); return null; });
      tokenIds.push(res?.id || null);
    }
  }
  for (let i = 0; i < count; i++) {
    const hp = (doRoll && rollHp(m.hd)) || m.hp;
    entries.push({
      name: count > 1 ? `${m.name} ${i + 1}` : m.name, side: 'npc', initMod: m.initMod,
      hp: { cur: hp, max: hp }, ac: String(m.acValue ?? m.ac), tokenId: tokenIds[i] || null,
      ref: { type: 'monster', id: m.id, ruleset: 'dnd5e' },
    });
  }
  try {
    await call(window.__lanternSocket, 'combat:add', { entries });
    toast(`Added ${count} ${m.name}${count > 1 ? 's' : ''} to combat`);
  } catch (er) { toast(er.message, true); }
}
