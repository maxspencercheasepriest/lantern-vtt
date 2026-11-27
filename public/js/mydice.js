// The Dice tab's "Your dice": pick colours, a pattern, a finish and a picture for the top face (the dice designer,
// dicedesigner.js, does a whole set and mixes materials). Everyone sees your
// rolls in these dice. Saved with the campaign under your name (dice:style), and in this browser so a new
// campaign starts with them too.
import { store, call, toast, $, esc, uploadImage } from './util.js';
import { FINISHES, PATTERNS, PRESETS, cleanDiceStyle, defaultStyle, inkFor, groupOf } from '/shared/dicestyle.js';
import { previewDice } from './dicepaint.js';
import { openDesigner, designerUnlocks, designerRefresh } from './dicedesigner.js';
import { tokenDesignerUnlocks } from './tokendesigner.js';
import { THEMES } from '/shared/themes.js';

const KEY = 'lantern.diceStyle';
const local = () => { try { return cleanDiceStyle(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return null; } };
const remember = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

let style = null;
let unlocks = null; // { locked: { finish: 'how to earn it' } } from an add-on, or null: everything's there

/** The Finish list: the everyday finishes, then the materials (locked ones say how to earn them). */
function fillFinishes() {
  const sel = $('#mydice-finish');
  if (!sel) return;
  const opt = ([k, v]) => {
    const lock = unlocks?.locked?.[k];
    return `<option value="${k}"${lock ? ' disabled' : ''}>${lock ? `🔒 ${v.label} — ${esc(lock)}` : v.label}</option>`;
  };
  const all = Object.entries(FINISHES);
  const groups = [['finish', 'Finishes'], ['material', 'Materials'], ['gm', 'Game master materials'], ['season', 'Seasonal materials'], ['creator', 'Creator materials']];
  sel.innerHTML = groups.map(([g, label]) => `<optgroup label="${label}">${all.filter(([k]) => groupOf(k) === g).map(opt).join('')}</optgroup>`).join('');
  const note = $('#mydice-unlocks');
  const left = Object.keys(unlocks?.locked || {}).length;
  if (note) { note.hidden = !unlocks; note.textContent = unlocks ? (left ? `${Object.values(FINISHES).filter((v) => v.material).length - left} of ${Object.values(FINISHES).filter((v) => v.material).length} materials unlocked. Play, run games, publish and get reviews to earn the rest; seasonal ones only in their season.` : 'Every material unlocked. 🎉') : ''; }
}
let socket = null;
let saveTimer = null;
/** Materials still to earn (from an add-on), or null: for the token designer's rims too. */
export const myUnlocks = () => unlocks;

export function initMyDice(sock) {
  socket = sock;
  const box = $('#mydice-preview');
  if (!box) return;
  $('#mydice-pattern').innerHTML = Object.entries(PATTERNS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  fillFinishes();
  $('#mydice-presets').innerHTML = PRESETS.map((p, i) => `<button type="button" data-i="${i}" title="${p.name}" style="--a:${p.body};--b:${p.body2}"></button>`).join('');
  $('#mydice-presets').onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) set({ ...PRESETS[+b.dataset.i], picture: style?.picture || null });
  };
  for (const id of ['body', 'body2', 'ink', 'pattern', 'finish']) {
    $(`#mydice-${id}`).addEventListener(id.startsWith('body') || id === 'ink' ? 'input' : 'change', () => {
      const next = { ...current(), [id]: $(`#mydice-${id}`).value };
      // a new colour with the old automatic numbers: keep the numbers readable
      if (id === 'body' && current().ink === inkFor(current().body)) next.ink = inkFor(next.body);
      // a material starts in its own colours (Oak in oak brown, Jade in green…); change them after if you like
      const mat = id === 'finish' && FINISHES[next.finish]?.colors;
      if (mat) Object.assign(next, { body: mat[0], body2: mat[1], ink: mat[2], pattern: 'plain' });
      set(next);
    });
  }
  $('#mydice-pic').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { set({ ...current(), picture: await uploadImage(file) }); } catch (err) { toast(err.message || "That picture didn't upload", true); }
  };
  $('#mydice-pic-clear').onclick = () => set({ ...current(), picture: null });
  // the game's theme has dice to match
  const match = $('#mydice-match');
  const showMatch = () => { const t = THEMES[store.settings?.theme]; match.hidden = !t?.dice; if (t?.dice) match.textContent = `${t.icon} Dice to match the game (${t.name})`; };
  store.on('settings', showMatch);
  match.onclick = () => { const t = THEMES[store.settings?.theme]; if (t?.dice) set({ ...t.dice, picture: current().picture || null }); };
  $('#mydice-designer').onclick = () => openDesigner({ get: current, apply: set, unlocks: () => unlocks, socket });

  // what this campaign has saved for you; if nothing yet, bring your dice from your last campaign
  socket.on('dice:style', (saved) => {
    const s = cleanDiceStyle(saved);
    if (s) { style = s; remember(s); show(); return; }
    const mine = local();
    style = mine;
    show();
    if (mine) send(mine);
  });
  // materials still to earn (Lantern Plus), and the moment one unlocks
  socket.on('dice:unlocks', (u) => {
    unlocks = u && typeof u === 'object' ? u : null;
    fillFinishes();
    show();
    designerUnlocks();
    tokenDesignerUnlocks();
    for (const f of unlocks?.fresh || []) {
      if (FINISHES[f]) toast(`🎲 New dice unlocked: ${FINISHES[f].label}! Pick it in Dice ▸ Your dice.`);
    }
  });
  // the preview only runs while the Dice tab is open
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-tab="dice"]')) setTimeout(show, 30); });
}

const current = () => style || defaultStyle(store.color || '#e8a33d');

function set(s) {
  const clean = cleanDiceStyle(s);
  if (!clean) return;
  style = clean;
  remember(clean);
  show();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => send(clean), 400); // dragging a colour picker sends many changes
}

function send(s) {
  call(socket, 'dice:style', { style: s }).catch((e) => toast(e.message, true));
}

function show() {
  const s = current();
  $('#mydice-body').value = s.body;
  $('#mydice-body2').value = s.body2;
  $('#mydice-ink').value = s.ink;
  $('#mydice-pattern').value = s.pattern;
  $('#mydice-finish').value = s.finish;
  $('#mydice-body2').closest('label').style.opacity = s.pattern === 'plain' ? 0.5 : 1;
  $('#mydice-pic-clear').hidden = !s.picture;
  const own = Object.keys(s.dice || {});
  const mixed = $('#mydice-mixed');
  mixed.hidden = !own.length && !s.overlay && !s.rim;
  mixed.textContent = [own.length ? `Your ${own.join(', ')} ${own.length === 1 ? 'has a look' : 'have looks'} of ${own.length === 1 ? 'its' : 'their'} own` : '', s.overlay ? `${FINISHES[s.overlay].label} painted over` : '', s.rim ? `${FINISHES[s.rim].label} rims` : ''].filter(Boolean).join(' · ') + ' (see the dice designer).';
  designerRefresh();
  const box = $('#mydice-preview');
  if (box.offsetParent) previewDice(box, s).catch((e) => console.warn('[dice preview]', e));
}
