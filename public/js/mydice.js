// The Dice tab's "Your dice": pick colours, a pattern, a finish and a picture for the top face. Everyone sees your
// rolls in these dice. Saved with the campaign under your name (dice:style), and in this browser so a new
// campaign starts with them too.
import { store, call, toast, $, uploadImage } from './util.js';
import { FINISHES, PATTERNS, PRESETS, cleanDiceStyle, defaultStyle, inkFor } from '/shared/dicestyle.js';
import { previewDice } from './dice3d.js';

const KEY = 'lantern.diceStyle';
const local = () => { try { return cleanDiceStyle(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return null; } };
const remember = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

let style = null;
let socket = null;
let saveTimer = null;

export function initMyDice(sock) {
  socket = sock;
  const box = $('#mydice-preview');
  if (!box) return;
  $('#mydice-pattern').innerHTML = Object.entries(PATTERNS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#mydice-finish').innerHTML = Object.entries(FINISHES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
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

  // what this campaign has saved for you; if nothing yet, bring your dice from your last campaign
  socket.on('dice:style', (saved) => {
    const s = cleanDiceStyle(saved);
    if (s) { style = s; remember(s); show(); return; }
    const mine = local();
    style = mine;
    show();
    if (mine) send(mine);
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
  const box = $('#mydice-preview');
  if (box.offsetParent) previewDice(box, s).catch((e) => console.warn('[dice preview]', e));
}
