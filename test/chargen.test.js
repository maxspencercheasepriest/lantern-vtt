import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// systems.js expects a browser; a bare window/document is enough to render sheets as HTML strings
globalThis.window ??= {};
globalThis.document ??= { addEventListener() {}, querySelector() { return null; } };
const { SYSTEMS } = await import('../public/js/systems.js');
const { generate, GENERATORS, cryptoRnd } = await import('../public/js/chargen.js');

const many = (id, n = 300) => Array.from({ length: n }, () => generate(id, SYSTEMS[id].defaults()));

test('every ruleset has a generator whose sheet renders', () => {
  for (const id of Object.keys(SYSTEMS)) {
    assert.ok(GENERATORS[id], `generator for ${id}`);
    for (const { data, log } of many(id, 50)) {
      assert.ok(data.name && !/^New /.test(data.name), `${id} gets a name`);
      assert.ok(log.length >= 1);
      assert.doesNotThrow(() => SYSTEMS[id].render(data));
      assert.ok(JSON.stringify(data).length < 200_000);
    }
  }
});

test('crypto dice are fair-ish and in range', () => {
  const counts = Array(6).fill(0);
  for (let i = 0; i < 6000; i++) { const v = cryptoRnd(6); assert.ok(v >= 1 && v <= 6); counts[v - 1]++; }
  for (const c of counts) assert.ok(c > 800 && c < 1200, `face count ${c}`);
});

test('D&D 5e: scores, HP, proficiencies and SRD spells', () => {
  const srd = new Set(JSON.parse(readFileSync(new URL('../public/rules/dnd5e/spells.json', import.meta.url))).map((s) => s.name));
  for (const { data: d } of many('dnd5e')) {
    for (const v of Object.values(d.abilities)) assert.ok(v >= 3 && v <= 20);
    assert.ok(d.hpMax >= 1 && d.hp === d.hpMax);
    assert.ok(Object.values(d.saves).filter(Boolean).length === 2);
    assert.ok(Object.values(d.skills).filter(Boolean).length >= 4);
    for (const s of d.spells) assert.ok(srd.has(s.name), `${s.name} is in the SRD`);
    assert.ok(d.ac >= 10 && d.ac <= 20);
  }
});

test('Call of Cthulhu: characteristic ranges and derived values', () => {
  for (const { data: d } of many('coc7')) {
    for (const k of ['STR', 'CON', 'DEX', 'APP', 'POW']) assert.ok(d.chars[k] >= 15 && d.chars[k] <= 90 && d.chars[k] % 5 === 0);
    for (const k of ['SIZ', 'INT']) assert.ok(d.chars[k] >= 40 && d.chars[k] <= 90);
    assert.ok(d.chars.EDU >= 40 && d.chars.EDU <= 99);
    assert.equal(d.san, d.chars.POW);
    assert.equal(d.hp, Math.floor((d.chars.CON + d.chars.SIZ) / 10));
    assert.equal(d.skills.find((s) => s.name === 'Language (Own)').value >= d.chars.EDU, true);
    for (const s of d.skills) assert.ok(s.value <= 99);
    assert.ok(d.occupation);
  }
});

test('Traveller: 2d6 characteristics and a career', () => {
  for (const { data: d } of many('traveller')) {
    for (const c of Object.values(d.chars)) assert.ok(c.max >= 2 && c.max <= 12 && c.cur === c.max);
    assert.ok(d.age >= 22 && d.age <= 34);
    assert.ok(d.skills.length && d.skills.every((s) => s.level >= 0 && s.level <= 3 && s.char));
  }
});

test('Tales from the Loop: attribute points equal age, luck is 15 minus age', () => {
  for (const { data: d } of many('tftl')) {
    assert.ok(d.age >= 10 && d.age <= 15);
    assert.equal(Object.values(d.attrs).reduce((a, b) => a + b, 0), d.age);
    for (const v of Object.values(d.attrs)) assert.ok(v >= 1 && v <= 5);
    assert.equal(d.luck, 15 - d.age);
    assert.equal(Object.values(d.skills).reduce((a, b) => a + b, 0), 10);
    for (const v of Object.values(d.skills)) assert.ok(v <= 3);
  }
});

test('Cyberpunk RED: 62 stat points, each 2–8, HP from BODY and WILL', () => {
  for (const { data: d } of many('cpr')) {
    const vals = Object.values(d.stats);
    assert.equal(vals.reduce((a, b) => a + b, 0), 62);
    for (const v of vals) assert.ok(v >= 2 && v <= 8);
    assert.equal(d.hpMax, 10 + 5 * Math.ceil((d.stats.BODY + d.stats.WILL) / 2));
    assert.equal(d.humanity, d.stats.EMP * 10);
  }
});

test('Savage Worlds: five attribute steps, legal dice', () => {
  const steps = (v) => (+v - 4) / 2;
  for (const { data: d } of many('swade')) {
    assert.equal(Object.values(d.attrs).reduce((a, v) => a + steps(v), 0), 5);
    for (const s of d.skills) assert.ok(['4', '6', '8', '10', '12'].includes(String(s.die)));
    assert.ok(d.hindrances.includes('Major'));
  }
});
