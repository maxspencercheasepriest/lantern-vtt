// Game plugins: the plugin.json format (shared/plugin.js) and installing from a zip (plugins.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { cleanManifest, cleanOutcome, outcomeOf, rollFor, defaultsFor, rowFor, cleanRules, pluginCardFacts, isPluginRuleset, pluginRuleset } from '../shared/plugin.js';
import { GamePlugins, zipFolder } from '../plugins.js';
import { cardFacts, CARD_PLUGINS } from '../shared/cards.js';
import { parse } from '../shared/dice.js';

const EXAMPLE = path.join(import.meta.dirname, '..', 'examples', 'plugins', 'hearth');
const example = () => {
  const m = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'plugin.json'), 'utf8'));
  m.rules = fs.readFileSync(path.join(EXAMPLE, 'rules.md'), 'utf8');
  return cleanManifest(m, ['plugin.json', 'rules.md', 'clocks.html']);
};

test('the example plugin is a valid one, and everything in it is usable', () => {
  const m = example();
  assert.equal(m.id, 'hearth');
  assert.equal(m.system.sections.length, 5);
  assert.equal(m.rules.length, 6, 'rules.md split at its headings');
  assert.equal(m.rules[0].name, 'Rolling the dice');
  assert.equal(m.stamps.length, 5);
  assert.deepEqual(m.panels, [{ name: 'Progress clocks', file: 'clocks.html' }]);
  // every roll on the sheet points at a roll that exists, and makes dice Lantern can roll
  const d = defaultsFor(m.system, 'Wren');
  for (const sec of m.system.sections) for (const f of sec.fields || []) if (f.roll) assert.ok(parse(rollFor(m.rolls[f.roll], d, { value: 2 }).expr));
  for (const q of m.quickRolls) assert.ok(parse(q.roll ? rollFor(m.rolls[q.roll], d).expr : q.dice));
});

test('a new character and new rows start from the fields', () => {
  const m = example();
  const d = defaultsFor(m.system, 'Wren');
  assert.deepEqual([d.name, d.calling, d.attrs.might, d.grit, d.dread, d.wounded, d.gear], ['Wren', 'Hunter', 1, 6, 0, false, []]);
  const gear = m.system.sections.find((s) => s.list).list;
  assert.deepEqual(rowFor(gear), { name: '', uses: 0 }, 'a list row can have a name column');
});

test('rolls: {value} and other fields fill the dice; no dice left uses the fallback', () => {
  const r = { dice: '{value}d6kh1', fallback: '2d6kl1', label: '{label}' };
  assert.deepEqual(rollFor(r, {}, { value: 3, label: 'Might' }), { expr: '3d6kh1', label: 'Might' });
  assert.deepEqual(rollFor(r, {}, { value: 0, label: 'Might' }), { expr: '2d6kl1', label: 'Might' });
  assert.equal(rollFor({ dice: '1d20+{attrs.str}+{bonus}' }, { attrs: { str: 3 }, bonus: -1 }).expr, '1d20+3-1');
  assert.equal(rollFor({ dice: '{value}d6' }, {}, { value: 0 }).error, 'No dice to roll');
  assert.ok(rollFor(undefined).error);
});

test('outcomes: bands by total, and a critical when enough dice show the face', () => {
  const o = cleanOutcome({ bands: [{ min: 6, text: 'It works', tone: 'good' }, { min: 4, max: 5, text: 'At a cost', tone: 'partial' }, { max: 3, text: 'Trouble', tone: 'bad' }, { text: '' }], crit: { face: 6, count: 2, text: 'Triumph' } });
  assert.equal(o.bands.length, 3);
  assert.deepEqual(outcomeOf(o, 6, [6, 2]), { text: 'It works', tone: 'good' });
  assert.deepEqual(outcomeOf(o, 5, [5, 1]), { text: 'At a cost', tone: 'partial' });
  assert.deepEqual(outcomeOf(o, 1, [1]), { text: 'Trouble', tone: 'bad' });
  assert.deepEqual(outcomeOf(o, 6, [6, 6, 3]), { text: 'Triumph', tone: 'crit' });
  assert.equal(cleanOutcome({ bands: [{ text: 'x'.repeat(100), tone: 'evil' }] }).bands[0].tone, 'neutral');
  assert.equal(cleanOutcome('nope'), null);
});

test('what a plugin.json may not do', () => {
  assert.throws(() => cleanManifest({ name: 'No id' }), /needs an "id"/);
  assert.throws(() => cleanManifest({ id: 'BAD ID', name: 'x' }), /needs an "id"/);
  assert.throws(() => cleanManifest({ id: 'empty', name: 'Empty' }), /nothing in it/);
  assert.throws(() => cleanManifest({ format: 2, id: 'new', name: 'From the future', rules: 'x' }), /newer Lantern/);
  const m = cleanManifest({
    id: 'sneaky', name: 'Sneaky',
    system: { sections: [{ title: 'S', fields: [{ key: '__proto__.x', label: 'bad' }, { key: 'name', label: 'Name again' }, { key: 'portrait' }, { key: 'ok', type: 'weird', roll: 'missing' }] }] },
    panels: [{ name: 'Escape', file: '../../etc/passwd.html' }, { name: 'Elsewhere', file: 'https://example.com/x.html' }, { name: 'Missing', file: 'gone.html' }],
    stamps: [{ name: 'Huge', shape: 'blob', size: 9999 }],
  }, ['plugin.json']);
  assert.deepEqual(m.system.sections[0].fields.map((f) => [f.key, f.type, f.roll]), [['ok', 'text', undefined]], 'reserved keys and missing rolls dropped');
  assert.deepEqual(m.panels, []);
  assert.deepEqual(m.stamps, [{ name: 'Huge', shape: 'circle', size: 40, color: null }]);
});

test('rules from a Markdown file, and a ruleset id that fits everywhere a ruleset is kept', () => {
  const r = cleanRules('Intro line\n# One\nFirst\n## Two\nSecond\n');
  assert.deepEqual(r.map((x) => x.name), ['About', 'One', 'Two']);
  assert.ok(pluginRuleset('0123456789ab').length <= 20);
  assert.equal(isPluginRuleset('p:0123456789ab'), true);
  assert.equal(isPluginRuleset('dnd5e'), false);
});

test('character cards for a plugin game', () => {
  const m = example();
  const d = { ...defaultsFor(m.system, 'Wren'), home: 'Fenwick' };
  const f = pluginCardFacts(m.system, d);
  assert.equal(f.subtitle, 'Hunter · Fenwick');
  assert.deepEqual(f.stats.map((s) => s[0]), ['Might', 'Craft', 'Wits', 'Heart']);
  CARD_PLUGINS['p:0123456789ab'] = (x) => pluginCardFacts(m.system, x);
  assert.equal(cardFacts('p:0123456789ab', d).name, 'Wren');
  delete CARD_PLUGINS['p:0123456789ab'];
});

test('installing: from a zip (folder or not), the same files once, and a new version beside the old', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-plugins-'));
  try {
    const store = new GamePlugins(dir);
    const a = store.install(zipFolder(EXAMPLE), 'Flick');
    assert.match(a.key, /^[a-f0-9]{12}$/);
    assert.equal(a.manifest.rules.length, 6);
    assert.equal(store.install(zipFolder(EXAMPLE)).key, a.key, 'the same plugin twice is one plugin');
    // zipped inside a folder, with the Mac's extras
    const files = {};
    for (const f of fs.readdirSync(EXAMPLE)) files[`hearth/${f}`] = new Uint8Array(fs.readFileSync(path.join(EXAMPLE, f)));
    files['__MACOSX/hearth/._plugin.json'] = strToU8('junk');
    assert.equal(store.install(Buffer.from(zipSync(files))).key, a.key);
    // a new version is a new key, and the old one stays
    const m = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'plugin.json'), 'utf8'));
    files['hearth/plugin.json'] = strToU8(JSON.stringify({ ...m, version: '1.1' }));
    const b = store.install(Buffer.from(zipSync(files)));
    assert.notEqual(b.key, a.key);
    assert.deepEqual(store.list().map((p) => p.manifest.version).sort(), ['1.0', '1.1']);
    // it can be zipped up again
    assert.ok(new GamePlugins(dir).install(store.zip(b.key)).key === b.key);
    assert.throws(() => store.install(Buffer.from('not a zip')), /isn't a plugin/);
    assert.throws(() => store.install(Buffer.from(zipSync({ 'x.txt': strToU8('hi') }))), /No plugin.json/);
    assert.throws(() => store.install(Buffer.from(zipSync({ 'plugin.json': strToU8('{oops') }))), /mistake/);
    store.remove(b.key);
    assert.equal(store.get(b.key), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
