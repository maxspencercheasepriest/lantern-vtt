// Buying something in a prop and having it land on the right part of the sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPurchase, itemLine, shopFor } from '../shared/purchase.js';

// systems.js is browser code; it only wants a window to read the app's server
// address from. The sheet definitions themselves are plain data and functions.
globalThis.window = globalThis.window || {};
const { SYSTEMS } = await import('../public/js/systems.js');

const cpr = () => SYSTEMS.cpr.defaults();

test('a weapon becomes a weapon row and costs eddies', () => {
  const d = cpr();
  const before = d.weapons.length;
  const r = applyPurchase(d, [{ name: 'Heavy SMG', qty: 1, price: 220, kind: 'weapon', skill: 'Handgun', damage: '3d6', rof: 1 }], 'cpr');
  assert.equal(r.data.weapons.length, before + 1);
  assert.deepEqual(r.data.weapons.at(-1), { name: 'Heavy SMG', skill: 'Handgun', damage: '3d6', rof: 1 });
  assert.equal(r.spent, 220);
  assert.equal(r.data.eddies, 1000 - 220);
  assert.equal(r.money, 'eddies');
  assert.equal(r.short, false);
  assert.equal(r.data.gear, '');                       // nothing doubled up in gear
});

test('two of a weapon makes two rows', () => {
  const r = applyPurchase(cpr(), [{ name: 'Combat Knife', qty: 2, price: 50, kind: 'weapon', skill: 'Melee Weapon', damage: '1d6', rof: 2 }], 'cpr');
  assert.equal(r.data.weapons.filter((w) => w.name === 'Combat Knife').length, 2);
  assert.equal(r.spent, 100);
});

test('chrome goes under cyberware, kit under gear', () => {
  const r = applyPurchase(cpr(), [
    { name: 'Kerenzikov', qty: 1, price: 600, kind: 'cyberware' },
    { name: 'Anti-Smog Mask', qty: 2, price: 25, kind: 'gear' },
  ], 'cpr');
  assert.equal(r.data.cyberware, 'Kerenzikov (600eb)');
  assert.equal(r.data.gear, '2× Anti-Smog Mask (50eb)');
  assert.equal(r.spent, 650);
  assert.equal(r.summary, '2 items (650eb)');
});

test('an existing gear box is added to, not replaced', () => {
  const d = cpr();
  d.gear = 'Agent\nRope';
  const r = applyPurchase(d, [{ name: 'Grapple Gun', qty: 1, price: 120 }], 'cpr');
  assert.equal(r.data.gear, 'Agent\nRope\nGrapple Gun (120eb)');
});

test('spending more than you have shows the hole rather than refusing', () => {
  const d = cpr();
  d.eddies = 100;
  const r = applyPurchase(d, [{ name: 'Metalgear', qty: 1, price: 7000 }], 'cpr');
  assert.equal(r.data.eddies, -6900);
  assert.equal(r.short, true);
});

test('a sheet saved before eddies existed still gets charged', () => {
  const d = cpr();
  delete d.eddies;
  const r = applyPurchase(d, [{ name: 'Burner Agent', qty: 1, price: 60 }], 'cpr');
  assert.equal(r.data.eddies, -60);
  assert.equal(r.short, true);
});

test('D&D money comes off the gold, kit goes in equipment', () => {
  const d = SYSTEMS.dnd5e.defaults();
  d.coins.gp = 50;
  const r = applyPurchase(d, [{ name: 'Rope, hempen (50 feet)', qty: 1, price: 1 }], 'dnd5e');
  assert.equal(r.data.coins.gp, 49);
  assert.match(r.data.equipment, /Rope, hempen \(50 feet\) \(1gp\)$/);
});

test('Traveller keeps its credits as text and still pays', () => {
  const d = SYSTEMS.traveller.defaults();
  d.credits = '12,000';
  const r = applyPurchase(d, [{ name: 'Vacc Suit', qty: 1, price: 2000 }], 'traveller');
  assert.equal(r.data.credits, 10000);
  assert.match(r.data.equipment, /Vacc Suit \(2000Cr\)/);
});

test('Tales from the Loop items keep their row shape', () => {
  const d = SYSTEMS.tftl.defaults();
  const r = applyPurchase(d, [{ name: 'Walkie-talkie', qty: 1, price: 0 }], 'tftl');
  assert.equal(r.data.items.length, 1);
  assert.deepEqual(r.data.items[0], { name: 'Walkie-talkie', bonus: 1 });
  assert.equal(r.money, null);                         // no money field: the GM settles up
});

test('a ruleset with nowhere else to put it uses the notes', () => {
  const d = SYSTEMS.generic.defaults();
  const r = applyPurchase(d, [{ name: 'Crowbar', qty: 1, price: 10 }], 'generic');
  assert.equal(r.data.notes, 'Crowbar (10)');          // no currency to name, so just the price
  assert.equal(r.spent, 10);
});

test('Call of Cthulhu puts a bought gun in the gear box, not a half-filled row', () => {
  const d = SYSTEMS.coc7.defaults();
  const rows = d.weapons.length;
  const r = applyPurchase(d, [{ name: 'Shotgun', qty: 1, price: 40, kind: 'weapon' }], 'coc7');
  assert.equal(r.data.weapons.length, rows);
  assert.match(r.data.gear, /Shotgun/);
});

test('rubbish in the message is ignored', () => {
  const d = cpr();
  const r = applyPurchase(d, [{ name: '  ' }, null, { qty: 3 }], 'cpr');
  assert.equal(r.added, 0);
  assert.equal(r.summary, '');
  assert.equal(r.data.eddies, 1000);
});

test('the sheet it was called with is never changed', () => {
  const d = cpr();
  applyPurchase(d, [{ name: 'Cyberarm', qty: 1, price: 650, kind: 'cyberware' }], 'cpr');
  assert.equal(d.eddies, 1000);
  assert.equal(d.cyberware, '');
});

test('lines read the way a person would write them', () => {
  assert.equal(itemLine({ name: 'Flak Armour', qty: 1, price: 1400 }, 'eb'), 'Flak Armour (1400eb)');
  assert.equal(itemLine({ name: 'Road Flare (×5)', qty: 3, price: 15 }, 'eb'), '3× Road Flare (×5) (45eb)');
  assert.equal(itemLine({ name: 'Favour', qty: 1, price: 0 }, 'eb'), 'Favour');
  assert.equal(shopFor('nonsense').gear, 'notes');
});
