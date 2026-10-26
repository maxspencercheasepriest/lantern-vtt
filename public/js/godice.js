// GoDice bridge. Two drivers feed physical results into the shared dice engine:
//  - built-in (default): the Web Bluetooth client from Flick's GoDice extension (js/lib/godice-ble.js).
//    Bundled, nothing to download; reads standard d6 dice.
//  - particula: Particula's official GoDice API (public/vendor/godice.js, downloaded separately),
//    which also understands the d4/d8/d10/d12/d20 shells.
import { evaluate, diceNeeded } from '/shared/dice.js';
import { $, esc, toast, store } from './util.js';

const TYPE_SIDES = { D4: 4, D6: 6, D8: 8, D10: 10, D10X: 'pct', D12: 12, D20: 20 };
const COLOR_NAMES = ['Black', 'Red', 'Green', 'Blue', 'Yellow', 'Orange'];
const COLOR_HEX = ['#222', '#d33', '#3a3', '#36c', '#ec3', '#f80'];

const dice = new Map(); // id -> { id, inst, type, color, battery, connected, rolling, last }
const savedTypes = JSON.parse(localStorage.getItem('lantern.godice.types') || '{}');
let postFn = null; // (payload) => Promise — posts a loose roll

const settings = {
  get loose() { return $('#godice-loose')?.checked ?? true; },
  get d10Zero() { return $('#godice-d10-zero')?.checked ?? false; },
};

let driver = window.NativeGoDie ? 'builtin' : localStorage.getItem('lantern.godice.driver') || 'builtin'; // the app can only use the built-in driver
const DRIVER_NOTES = {
  builtin: 'Built in — reads standard d6 GoDice. Nothing to install.',
  particula: "Particula's official library — needed for d4, d8, d10, d12 and d20 shells.",
};

// Connection log, shown in the Dice tab, to help work out why a die keeps dropping
const log = [];
function logEvent(d, text) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  log.unshift(`${t}  ${d ? dieName(d) : 'GoDice'}: ${text}`);
  log.length = Math.min(log.length, 40);
  const el = $('#godice-log');
  if (el) el.textContent = log.join('\n');
}
function batteryCheck(d, b) {
  if (b == null) return;
  if (b <= 15 && !d.lowWarned) { d.lowWarned = true; toast(`${dieName(d)} battery is low (${b}%) — charge it soon, low dice drop out`, true); }
  if (b > 25) d.lowWarned = false;
}

const libLoaded = () => typeof GoDice !== 'undefined' && !window.__godiceMissing; // eslint-disable-line no-undef

export function physicalAvailable() {
  return [...dice.values()].some((d) => d.connected);
}

export function initGoDice({ postLooseRoll }) {
  postFn = postLooseRoll;
  for (const id of ['godice-loose', 'godice-d10-zero']) {
    const el = $(`#${id}`);
    const k = `lantern.${id}`;
    if (localStorage.getItem(k) !== null) el.checked = localStorage.getItem(k) === '1';
    el.onchange = () => localStorage.setItem(k, el.checked ? '1' : '0');
  }
  $('#godice-connect').onclick = connect;
  for (const b of document.querySelectorAll('#godice-driver [data-driver]')) {
    b.onclick = () => { driver = b.dataset.driver; localStorage.setItem('lantern.godice.driver', driver); renderList(); };
  }
  renderList();
}

function envProblem() {
  // Android app: dice go through Android's own Bluetooth, d6 only (no Web Bluetooth for Particula's library)
  if (window.NativeGoDie) return driver === 'builtin' ? null : "In the Android app GoDice use the built-in driver, which reads d6 dice. Switch to 'Built-in · d6'.";
  if (!('bluetooth' in navigator)) return "This browser doesn't support Web Bluetooth. Use Chrome or Edge on Windows, macOS, Android or ChromeOS — iPhone and iPad can't connect GoDice to web pages.";
  if (!window.isSecureContext) return 'Web Bluetooth needs HTTPS (or http://localhost). Put Lantern behind HTTPS to use GoDice from other machines — see the README.';
  if (driver === 'builtin') {
    return typeof GoDie === 'undefined' ? "Lantern's GoDice driver didn't load — refresh the page." : null; // eslint-disable-line no-undef
  }
  if (!libLoaded()) {
    return window.lanternDesktop
      ? 'The Particula library isn\'t installed. Use the built-in driver for d6 dice, or leave the table (Ctrl+W) and press "Download" under extra dice shells in the launcher.'
      : "The Particula library isn't installed on this server — use the built-in driver for d6 dice, or run `npm run get-godice` and refresh.";
  }
  return null;
}

async function connect() {
  const problem = envProblem();
  if (problem) return toast(problem, true);
  if (driver === 'builtin') {
    try {
      wireBuiltin(await (window.NativeGoDie || GoDie).request()); // eslint-disable-line no-undef
    } catch (e) {
      if (e?.name !== 'NotFoundError') toast(`Couldn't connect: ${e?.message || e}`, true);
    }
    return;
  }
  /* global GoDice */
  const inst = new GoDice();
  wire(inst);
  try {
    await inst.requestDevice();
  } catch (e) {
    if (e?.name !== 'NotFoundError') toast(`Couldn't connect: ${e?.message || e}`, true); // NotFoundError = picker closed
  }
}

function wire(inst) {
  inst.onDiceConnected = (id) => {
    const d = dice.get(id) || { id, type: savedTypes[id] || 'D6', color: null, battery: null, last: null };
    Object.assign(d, { inst, connected: true, rolling: false });
    dice.set(id, d);
    inst.setDieType(GoDice.diceTypes[d.type]);
    try { inst.getDiceColor(); } catch {}
    setTimeout(() => { try { inst.getBatteryLevel(); } catch {} }, 400);
    flash(d, [0, 120, 255]);
    logEvent(d, d.reconnecting ? 'reconnected' : 'connected');
    d.reconnecting = false;
    // keep the battery reading fresh (and the link busy) while connected
    clearInterval(d.keepAlive);
    d.keepAlive = setInterval(() => { if (d.connected) try { inst.getBatteryLevel(); } catch {} }, 60000);
    renderList();
  };
  inst.onDiceDisconnected = (id) => {
    const d = dice.get(id);
    if (!d) return;
    const was = d.connected;
    d.connected = false; d.rolling = false;
    logEvent(d, `disconnected${d.battery != null ? ` (battery ${d.battery}%)` : ''}`);
    if (was) toast(`${dieName(d)} dropped out — reconnecting…`, true);
    renderList();
    reconnectParticula(d);
  };
  inst.onDiceColor = (id, c) => { const d = dice.get(id); if (d) { d.color = c; renderList(); } };
  inst.onBatteryLevel = (id, b) => { const d = dice.get(id); if (d) { d.battery = b; batteryCheck(d, b); renderList(); } };
  inst.onRollStart = (id) => { const d = dice.get(id); if (d) { d.rolling = true; renderList(); } bumpLoose(); };
  inst.onStable = (id, value) => landed(id, value);
  inst.onTiltStable = (id) => {
    const d = dice.get(id);
    if (d) { d.rolling = false; renderList(); }
    toast(`${d ? dieName(d) : 'A die'} landed tilted — roll it again`);
  };
  // onFakeStable (shaken, not rolled) and onMoveStable (nudged to another face) are ignored on purpose
  inst.onFakeStable = (id) => { const d = dice.get(id); if (d) { d.rolling = false; renderList(); } };
}

// Particula's library has a reconnect loop but never starts it itself
function reconnectParticula(d) {
  if (d.reconnecting || d.removed) return;
  d.reconnecting = true;
  renderList();
  d.inst.attemptReconnect(d.id, d.inst).catch((e) => { d.reconnecting = false; logEvent(d, `reconnect failed: ${e?.message || e}`); renderList(); });
}

// Built-in driver: a GoDie is an EventTarget (events: status, battery, colour, rollstart, stable, nudge, removed)
function wireBuiltin(die) {
  const id = die.id;
  const d = dice.get(id) || { id, color: null, battery: null, last: null };
  Object.assign(d, { inst: die, driver: 'builtin', type: 'D6', connected: true, rolling: false });
  dice.set(id, d);
  const on = (type, fn) => die.addEventListener(type, (e) => { fn(e.detail || {}); renderList(); });
  on('status', ({ state, attempt, error }) => {
    const was = d.connected;
    const wasReconnecting = d.reconnecting;
    d.connected = state === 'connected';
    d.reconnecting = state === 'reconnecting' || state === 'retry' || (state === 'disconnected' && was) || (state === 'connecting' && wasReconnecting);
    if (state === 'connected') logEvent(d, wasReconnecting ? 'reconnected' : 'connected');
    if (state === 'disconnected' && was) {
      logEvent(d, `disconnected${d.battery != null ? ` (battery ${d.battery}%)` : ''}`);
      toast(`${dieName(d)} dropped out — reconnecting…`, true);
    }
    if (state === 'retry' && (attempt <= 3 || attempt % 10 === 0)) logEvent(d, `reconnect attempt ${attempt} failed: ${error}`);
  });
  on('battery', ({ battery }) => { d.battery = battery; batteryCheck(d, battery); });
  on('colour', ({ colour }) => { const i = COLOR_NAMES.findIndex((n) => n.toLowerCase() === colour); d.color = i >= 0 ? i : null; });
  on('rollstart', () => { d.rolling = true; bumpLoose(); });
  on('stable', ({ value }) => landed(id, value));
  on('nudge', () => { d.rolling = false; }); // tilted or pushed to another face — not a roll
  on('removed', () => { dice.delete(id); });
  logEvent(d, 'connected');
  flash(d, [0, 120, 255]);
  renderList();
}

const dieName = (d) => `${d.color != null ? COLOR_NAMES[d.color] : 'GoDice'} ${d.type}`;

function flash(d, rgb) {
  try {
    if (d.driver === 'builtin') d.inst.pulse(rgb, 1, 25, 5);
    else d.inst.pulseLed(1, 25, 5, rgb);
  } catch {}
}

function landed(id, raw) {
  const d = dice.get(id);
  if (!d) return;
  d.rolling = false;
  const kind = TYPE_SIDES[d.type];
  let value = Number(raw);
  if (kind === 10 && value === 0 && !settings.d10Zero) value = 10;
  d.last = kind === 'pct' ? String(value).padStart(2, '0') : value;
  renderList();
  const reading = { die: d, kind, value, raw: Number(raw), at: Date.now() };
  if (active) active.offer(reading);
  else if (settings.loose) queueLoose(reading);
}

// ---------- physical roll in progress ----------
let active = null;

class PhysicalRoll {
  constructor(need, label, exprText, pctOK) {
    this.exprText = exprText;
    this.pctOK = pctOK; // percentile roll: any d10 (or a D10X tens die) will do
    this.label = label;
    this.expected = need.map((sides) => ({ sides, value: null }));
    this.extras = [];
    this.waiters = []; // { sides, resolve, tens?, units? }
    this.spare = [];   // readings that arrived before the engine asked for them
    this.sources = new Set();
    this.autoDigital = false;
    this.cancelled = false;
  }

  // dice engine calls this for each die it needs
  roller = (sides) => new Promise((resolve, reject) => {
    if (this.cancelled) return reject(new Error('cancelled'));
    if (this.autoDigital) return resolve(this.record(sides, secureRandom(sides), 'digital'));
    const w = { sides, resolve, reject };
    // use a reading that already arrived, if it fits
    const i = this.spare.findIndex((r) => this.fits(w, r));
    this.waiters.push(w);
    if (i >= 0) { const [r] = this.spare.splice(i, 1); this.feed(w, r); }
    renderTray();
  });

  offer(reading) {
    const w = this.waiters.find((x) => this.fits(x, reading));
    if (w) return this.feed(w, reading);
    // nothing waiting for it right now — hold briefly (dice rolled together land in any order)
    this.spare.push(reading);
    setTimeout(() => { this.spare = this.spare.filter((r) => r !== reading); }, 2500);
    const wanted = [...new Set(this.waiters.map((x) => (x.sides === 100 ? 'd%' : `d${x.sides}`)))];
    if (wanted.length && !this.waiters.some((x) => this.fits(x, reading))) {
      toast(`Waiting for ${wanted.join(' / ')} — that ${dieName(reading.die)} isn't needed`);
    }
  }

  feed(w, r) {
    if (w.sides === 100) {
      if (r.kind === 'pct') w.tens = r.raw;
      else w.units = r.raw % 10; // raw 0–9 face
      flash(r.die, [0, 255, 0]);
      if (w.tens == null || w.units == null) return renderTray();
      const v = w.tens + w.units === 0 ? 100 : w.tens + w.units;
      return this.resolveWaiter(w, v, 'godice');
    }
    flash(r.die, [0, 255, 0]);
    if (w.sides === 10 && r.kind === 'pct') return this.resolveWaiter(w, r.raw / 10 || 10, 'godice'); // D10X: tens digit
    this.resolveWaiter(w, r.value, 'godice');
  }

  fits(w, r) {
    if (w.sides === 10 && this.pctOK && r.kind === 'pct') return true;
    return fits(w, r);
  }

  resolveWaiter(w, value, source) {
    this.waiters = this.waiters.filter((x) => x !== w);
    w.resolve(this.record(w.sides, value, source));
    renderTray();
  }

  record(sides, value, source) {
    this.sources.add(source);
    const slot = this.expected.find((e) => e.sides === sides && e.value == null);
    if (slot) { slot.value = value; slot.source = source; } else this.extras.push({ sides, value, source });
    return value;
  }

  manual(value) {
    const w = this.waiters[0];
    if (!w) return;
    let v = Math.round(Number(value));
    if (this.pctOK && w.sides === 10 && v === 0) v = 10; // percentile dice: 0 is fine
    if (!(v >= 1 && v <= w.sides)) return toast(`Enter ${this.pctOK && w.sides === 10 ? '0–9' : `1–${w.sides}`}`, true);
    this.resolveWaiter(w, v, 'manual');
  }

  rollRestDigitally() {
    this.autoDigital = true;
    for (const w of [...this.waiters]) this.resolveWaiter(w, secureRandom(w.sides), 'digital');
  }

  cancel() {
    this.cancelled = true;
    for (const w of this.waiters) w.reject(new Error('cancelled'));
    this.waiters = [];
  }
}

function fits(w, r) {
  if (w.sides === 100) return (r.kind === 'pct' && w.tens == null) || (r.kind === 10 && w.units == null);
  return r.kind === w.sides;
}

function secureRandom(sides) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / sides) * sides;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return (buf[0] % sides) + 1;
}

/** Roll a parsed expression with physical dice. Resolves { result, sources } or null if cancelled. */
export async function rollPhysical(parsed, label) {
  const pct = parsed.terms.some((t) => t.type === 'pct');
  const out = await withPhysical(label, diceNeeded(parsed), parsed.expr, pct, (roller) => evaluate(parsed, roller));
  return out;
}

/** Physical dice for anything else (e.g. pushing a roll): fn(roller) builds the result. Resolves the result or null. */
export async function rollPhysicalWith(label, need, fn) {
  const out = await withPhysical(label, need, need.map((x) => `d${x}`).join(' '), false, fn);
  return out?.result || null;
}

async function withPhysical(label, need, exprText, pctOK, fn) {
  if (active) { toast('Finish the roll in progress first', true); return null; }
  active = new PhysicalRoll(need, label, exprText, pctOK);
  const roll = active;
  renderTray();
  try {
    const result = await fn(roll.roller);
    return { result, sources: [...roll.sources] };
  } catch (e) {
    if (e.message !== 'cancelled') toast(e.message, true);
    return null;
  } finally {
    if (active === roll) active = null;
    renderTray();
  }
}

function renderTray() {
  const tray = $('#dice-tray');
  if (!active) { tray.hidden = true; tray.innerHTML = ''; return; }
  const a = active;
  const firstWant = new Map(); // sides -> index of first unfilled expected slot that is being waited on
  const waitingSides = new Set(a.waiters.map((w) => w.sides));
  const slot = (s, i, list) => {
    const label = s.sides === 100 ? 'd%' : `d${s.sides}`;
    if (s.value != null) return `<div class="slot done" title="${esc(s.source)}">${esc(s.value)}<small>${label}</small></div>`;
    let want = false;
    if (waitingSides.has(s.sides) && !firstWant.has(s.sides)) { firstWant.set(s.sides, i); want = true; }
    return `<div class="slot ${want ? 'want' : ''}">${label}</div>`;
  };
  const extraWaits = a.waiters.filter((w) => !a.expected.some((e) => e.sides === w.sides && e.value == null));
  const w0 = a.waiters[0];
  let hint = 'Roll your GoDice';
  if (w0?.sides === 100) hint = 'Roll the d10 (units) and the d% / D10X die (tens)';
  if (extraWaits.length) hint = `Roll again — ${extraWaits.map((w) => `d${w.sides}`).join(', ')} bonus die`;
  tray.innerHTML = `
    <div class="title"><span>${esc(a.label)}</span><span class="muted mono">${esc(a.exprText)}</span></div>
    <div class="muted small">${esc(hint)}</div>
    <div class="slots">${a.expected.map(slot).join('')}${a.extras.map((s) => slot(s)).join('')}${extraWaits.map((w) => `<div class="slot want">d${w.sides}</div>`).join('')}</div>
    <div class="actions">
      <input type="number" min="1" placeholder="value" aria-label="Enter a value by hand" id="tray-manual">
      <button class="btn" id="tray-enter">Enter</button>
      <button class="btn" id="tray-digital">Roll rest digitally</button>
      <button class="btn ghost danger" id="tray-cancel">Cancel</button>
    </div>`;
  tray.hidden = false;
  const input = $('#tray-manual');
  $('#tray-enter').onclick = () => { a.manual(input.value); input.value = ''; };
  input.onkeydown = (e) => { if (e.key === 'Enter') { a.manual(input.value); input.value = ''; } };
  $('#tray-digital').onclick = () => a.rollRestDigitally();
  $('#tray-cancel').onclick = () => a.cancel();
}

// ---------- loose rolls (dice rolled outside a check) ----------
let loose = [];
let looseTimer = null;
function queueLoose(r) {
  loose.push(r);
  bumpLoose();
}
function bumpLoose() {
  if (!loose.length) return;
  clearTimeout(looseTimer);
  looseTimer = setTimeout(flushLoose, 1300);
}
function flushLoose() {
  if ([...dice.values()].some((d) => d.rolling)) return bumpLoose();
  const readings = loose.filter((r) => r.kind !== 'pct');
  loose = [];
  if (!readings.length) return;
  const bySides = new Map();
  for (const r of readings) {
    if (!bySides.has(r.kind)) bySides.set(r.kind, []);
    bySides.get(r.kind).push(r.value);
  }
  const groups = [...bySides.entries()].sort((a, b) => b[0] - a[0]);
  const parts = groups.map(([sides, vals]) => ({
    type: 'dice', sign: 1, count: vals.length, sides,
    dice: vals.map((v) => ({ sides, chain: [v], value: v, kept: true })),
    subtotal: vals.reduce((x, y) => x + y, 0),
  }));
  const result = {
    expr: groups.map(([s, v]) => `${v.length}d${s}`).join('+'),
    total: parts.reduce((x, p) => x + p.subtotal, 0),
    parts, flags: [],
  };
  postFn?.({ result, sources: ['godice'], label: 'GoDice' });
}

// ---------- list UI ----------
function renderList() {
  for (const b of document.querySelectorAll('#godice-driver [data-driver]')) b.classList.toggle('active', b.dataset.driver === driver);
  const note = $('#godice-driver-note');
  if (note) note.textContent = DRIVER_NOTES[driver];
  const problem = envProblem();
  const status = $('#godice-status');
  status.textContent = problem || (dice.size ? '' : 'No dice connected yet. Wake a die by rolling it, then connect.');
  $('#godice-connect').disabled = !!problem;
  const ul = $('#godice-list');
  ul.innerHTML = [...dice.values()].map((d) => `
    <li data-id="${esc(d.id)}" class="${d.rolling ? 'rolling' : ''} ${d.connected ? '' : 'off'}">
      <span class="dot" style="background:${d.color != null ? COLOR_HEX[d.color] : '#666'}"></span>
      <span class="meta">${esc(dieName(d))}<small>${d.connected ? (d.battery != null ? `Battery ${d.battery}%` : 'Connected') : d.reconnecting ? 'Reconnecting… roll it to wake it' : 'Disconnected'}</small></span>
      ${d.driver === 'builtin'
        ? '<span class="shell muted small" title="The built-in driver reads d6 dice">d6</span>'
        : `<select aria-label="Shell">${Object.keys(TYPE_SIDES).map((t) => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select>`}
      <span class="last">${d.last ?? ''}</span>
    </li>`).join('');
  for (const li of ul.children) {
    const d = dice.get(li.dataset.id);
    const sel = li.querySelector('select');
    if (sel) sel.onchange = (e) => {
      d.type = e.target.value;
      savedTypes[d.id] = d.type;
      localStorage.setItem('lantern.godice.types', JSON.stringify(savedTypes));
      try { d.inst.setDieType(GoDice.diceTypes[d.type]); } catch {}
      renderList();
    };
    li.querySelector('.dot').onclick = () => flash(d, [255, 180, 0]);
    li.querySelector('.dot').title = 'Flash this die';
    li.querySelector('.meta').ondblclick = () => {
      if (d.connected) return;
      if (d.driver === 'builtin') d.inst.connect().catch((e) => toast(`Couldn't reconnect: ${e.message}`, true));
      else { d.reconnecting = false; reconnectParticula(d); }
    };
    if (!d.connected && !d.reconnecting) li.querySelector('.meta small').textContent = 'Disconnected — double-click to reconnect';
  }
  const n = [...dice.values()].filter((d) => d.connected).length;
  const badge = $('#godice-badge');
  badge.hidden = !n;
  badge.textContent = n;
  store.emit('godice', n);
}
