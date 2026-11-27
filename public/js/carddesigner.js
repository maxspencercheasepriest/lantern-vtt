// The character card designer: a trading card of one of your characters — their picture, name, what they are, the
// numbers that matter in their game — framed in any theme's artwork and colours. Makes a 600×840 PNG to show in chat,
// keep with the character, or download. At the table it's a window (openCardDesigner, Sheets tab); Lantern Plus
// mounts it on its account pages for vault characters (mountCardDesigner).
import { openWindow, call, toast, $, $$, esc, uploadImage, store } from './util.js';
import { serverUrl } from './net.js';
import { THEMES } from '/shared/themes.js';
import { cardFacts, cleanCardDesign, cardColors, CARD_LAYOUTS, CARD_SYSTEM_NAMES } from '/shared/cards.js';
import { artOf, pictureOf } from './themes.js';

const CW = 600, CH = 840;
const SERIF = '"Fraunces", Georgia, "Times New Roman", serif', SANS = '"IBM Plex Sans", Arial, sans-serif';

const images = new Map();
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!images.has(src)) {
    images.set(src, new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => { images.delete(src); resolve(null); };
      im.src = src.startsWith('/') ? serverUrl(src) : src;
    }));
  }
  return images.get(src);
}
/** A theme's artwork as a picture (both sides, like the backdrop), for the card's background. */
function themeArt(id) {
  if (THEMES[id]?.pictures) {
    return Promise.all([loadImage(pictureOf(id, 'left')), loadImage(pictureOf(id, 'right'))]).then(([l, r]) => {
      if (!l || !r) return null;
      const c = document.createElement('canvas');
      c.width = 840; c.height = 1000;
      const g = c.getContext('2d');
      g.fillStyle = THEMES[id].bg; g.fillRect(0, 0, 840, 1000);
      // each picture cropped to its own half, around its subject
      const half = (im, x, focus) => {
        const fx = parseFloat(focus) / 100, k = Math.max(420 / im.naturalWidth, 1000 / im.naturalHeight);
        const sw = 420 / k, sh = 1000 / k, sx = Math.max(0, Math.min(im.naturalWidth - sw, (im.naturalWidth - sw) * (Number.isFinite(fx) ? fx : 0.5)));
        g.drawImage(im, sx, im.naturalHeight - sh, sw, sh, x, 0, 420, 1000);
      };
      half(l, 0, THEMES[id].focus?.left ?? '0%');
      half(r, 420, THEMES[id].focus?.right ?? '100%');
      return c;
    });
  }
  const art = artOf(id);
  if (!art) return Promise.resolve(null);
  const inner = art.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 1000" preserveAspectRatio="xMidYMax slice"><g>${inner}</g><g transform="translate(840 0) scale(-1 1)">${inner}</g></svg>`;
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}
const light = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150; };

function cover(g, im, x, y, w, h, d) {
  const k = Math.max(w / im.naturalWidth, h / im.naturalHeight) * d.zoom;
  const iw = im.naturalWidth * k, ih = im.naturalHeight * k;
  g.drawImage(im, x + (w - iw) / 2 + d.ox * w * 0.5, y + (h - ih) / 2 + d.oy * h * 0.5, iw, ih);
}
function fit(g, txt, max, size, weight, family) {
  let s = size;
  g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(txt).width > max && s > 12) { s -= 1; g.font = `${weight} ${s}px ${family}`; }
  return s;
}

/** Draw a card. `facts` from cardFacts(), `photo` and `art` are loaded pictures (or null). */
export function renderCard(cv, facts, d, photo, art, { systemName = '', player = '' } = {}) {
  const g = cv.getContext('2d');
  const [frame, accent, ink, bg, body] = cardColors(d);
  g.clearRect(0, 0, CW, CH);
  const R = 30;
  g.save();
  g.beginPath(); g.roundRect(0, 0, CW, CH, R); g.clip();
  g.fillStyle = bg; g.fillRect(0, 0, CW, CH);
  if (art) { g.globalAlpha = d.layout === 'full' ? 0.25 : 0.55; g.drawImage(art, 0, 0, CW, CH); g.globalAlpha = 1; }

  // how much room the words and numbers need, from the bottom up; the picture gets the rest
  const n = d.showStats ? facts.stats.length : 0, perRow = n > 6 ? Math.ceil(n / 2) : n || 1, rows = n ? Math.ceil(n / perRow) : 0;
  g.font = `italic 400 20px ${SERIF}`;
  const tagLines = [];
  if (d.tagline) { let cur = ''; for (const w of d.tagline.split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (g.measureText(t).width > CW - 110) { tagLines.push(cur); cur = w; } else cur = t; } if (cur) tagLines.push(cur); }
  const tl = tagLines.slice(0, 3);
  const need = 64 + 26 + (facts.subtitle ? 34 : 0) + (rows ? rows * 70 + 6 : 0) + (n && facts.extras.length ? 32 : 0) + (tl.length ? tl.length * 26 + 8 : 0);
  const textTop = Math.max(380, CH - 62 - need);
  if (d.layout === 'full') {
    if (photo) cover(g, photo, 0, 0, CW, CH, d);
    const fade = g.createLinearGradient(0, textTop - 160, 0, CH);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.35, 'rgba(0,0,0,0.75)'); fade.addColorStop(1, 'rgba(0,0,0,0.92)');
    g.fillStyle = fade; g.fillRect(0, 0, CW, CH);
  } else if (d.layout === 'framed') {
    // an oval portrait in a double ring
    const ry = (textTop - 60) / 2, rx = Math.min(200, ry * 0.85), cx = CW / 2, cy = 34 + ry;
    g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = body; g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    if (photo) cover(g, photo, cx - rx, cy - ry, rx * 2, ry * 2, d);
    g.restore();
    for (const [w, c, r] of [[12, frame, 0], [3, accent, 12]]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.ellipse(cx, cy, rx + r, ry + r, 0, 0, Math.PI * 2); g.stroke(); }
  } else {
    // classic: the picture in the top half, under a frame line
    const x = 34, y = 34, w = CW - 68, h = textTop - 52;
    g.save(); g.beginPath(); g.roundRect(x, y, w, h, 16); g.clip();
    g.fillStyle = body; g.fillRect(x, y, w, h);
    if (photo) cover(g, photo, x, y, w, h, d);
    const sh = g.createLinearGradient(0, y + h * 0.6, 0, y + h);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = sh; g.fillRect(x, y, w, h);
    g.restore();
    g.strokeStyle = accent; g.lineWidth = 3; g.beginPath(); g.roundRect(x, y, w, h, 16); g.stroke();
  }
  if (!photo && d.layout !== 'full') {
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.font = `600 140px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((facts.name[0] || '?').toUpperCase(), CW / 2, (textTop + 20) / 2);
  }

  // the name on a ribbon
  const ribH = 64, ribY = textTop;
  g.fillStyle = frame;
  g.beginPath(); g.moveTo(14, ribY); g.lineTo(CW - 14, ribY); g.lineTo(CW - 34, ribY + ribH / 2); g.lineTo(CW - 14, ribY + ribH); g.lineTo(14, ribY + ribH); g.lineTo(34, ribY + ribH / 2); g.closePath(); g.fill();
  g.strokeStyle = accent; g.lineWidth = 2; g.stroke();
  g.fillStyle = light(frame) ? '#17130e' : ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  fit(g, facts.name, CW - 120, 40, 700, SERIF);
  g.fillText(facts.name, CW / 2, ribY + ribH / 2 + 2);
  let y = ribY + ribH + 26;
  if (facts.subtitle) {
    g.fillStyle = accent; fit(g, facts.subtitle, CW - 80, 21, 500, SANS);
    g.fillText(facts.subtitle, CW / 2, y); y += 34;
  }
  // the numbers that matter
  if (n) {
    const bw = Math.min(96, (CW - 80 - (perRow - 1) * 8) / perRow), bh = 62;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, n - row * perRow);
      const x0 = (CW - (inRow * bw + (inRow - 1) * 8)) / 2 + col * (bw + 8), y0 = y + row * (bh + 8);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.roundRect(x0, y0, bw, bh, 10); g.fill();
      g.strokeStyle = frame; g.lineWidth = 2; g.stroke();
      const [label, value] = facts.stats[i];
      g.fillStyle = accent; g.font = `600 13px ${SANS}`; g.fillText(label, x0 + bw / 2, y0 + 15);
      g.fillStyle = ink; fit(g, value, bw - 10, 26, 700, SERIF); g.fillText(value, x0 + bw / 2, y0 + 42);
    }
    y += rows * (bh + 8) + 14;
    if (facts.extras.length) {
      const line = facts.extras.map(([k, v]) => `${k} ${v}`).join('   ·   ');
      g.fillStyle = ink; fit(g, line, CW - 80, 19, 600, SANS); g.fillText(line, CW / 2, y); y += 30;
    }
  }
  if (tl.length) {
    g.fillStyle = ink; g.globalAlpha = 0.9; g.font = `italic 400 20px ${SERIF}`;
    tl.forEach((l, i) => g.fillText(`${i === 0 ? '“' : ''}${l}${i === tl.length - 1 ? '”' : ''}`, CW / 2, y + 2 + i * 26));
    g.globalAlpha = 1;
  }
  // the foot: game and player
  g.fillStyle = accent; g.font = `600 14px ${SANS}`; g.globalAlpha = 0.85;
  g.textAlign = 'left'; g.fillText(systemName.toUpperCase(), 40, CH - 34);
  g.textAlign = 'right'; g.fillText(player ? `${player.toUpperCase()} · LANTERN` : 'LANTERN', CW - 40, CH - 34);
  g.globalAlpha = 1; g.textAlign = 'center';
  g.restore();
  // the frame
  g.strokeStyle = frame; g.lineWidth = 16; g.beginPath(); g.roundRect(8, 8, CW - 16, CH - 16, R - 6); g.stroke();
  g.strokeStyle = accent; g.lineWidth = 2; g.beginPath(); g.roundRect(20, 20, CW - 40, CH - 40, R - 14); g.stroke();
  for (const [cx, cy] of [[20, 20], [CW - 20, 20], [20, CH - 20], [CW - 20, CH - 20]]) { g.fillStyle = accent; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill(); }
}

// ---------- the designer ----------
let ctx = null, root = null, sheetId = null, design = cleanCardDesign({});

/** At the table: your characters (the GM: anyone's), with Show in chat and Keep with the character. */
export function openCardDesigner({ socket }) {
  const w = openWindow('card-designer', { title: 'Character cards', width: 900, height: 760 });
  if (w.existed) return;
  mountCardDesigner(w.body, {
    sheets: () => (store.sheets || []).filter((s) => store.isGM || s.owner === store.me),
    upload: uploadImage,
    player: (s) => s.owner || '',
    startTheme: () => store.settings?.theme,
    actions: [
      { label: 'Show in chat', run: async (c) => { await call(socket, 'card:show', { sheetId: c.sheetId, image: c.image }); toast('Shown in chat'); } },
      { label: 'Keep with the character', run: async (c) => { await call(socket, 'sheet:card', { sheetId: c.sheetId, image: c.image, design: c.design }); toast('Kept with the character'); } },
    ],
  });
}

/**
 * Put the designer in `el`. `c`: sheets() → [{ id, system, data, owner }]; upload(file) → '/uploads/…';
 * player(sheet) → a name for the foot; startTheme() → a theme to begin with; actions: [{ label, run(card) }] where
 * card = { sheetId, image (uploaded PNG), design }.
 */
export function mountCardDesigner(el, c) {
  ctx = c; root = el;
  const list = ctx.sheets();
  sheetId = list[0]?.id || null;
  design = cleanCardDesign({ ...(list[0]?.data?.card?.design || {}), theme: list[0]?.data?.card?.design?.theme || (ctx.startTheme?.() && ctx.startTheme() !== 'none' ? ctx.startTheme() : 'fantasy') });
  el.innerHTML = `
    <div class="cd">
      <div class="cd-stage"><canvas class="cd-canvas" width="${CW}" height="${CH}" aria-label="The card"></canvas><p class="muted small">Drag the picture to move it, scroll to zoom.</p></div>
      <div class="cd-controls">
        <label class="wide">Character <select id="cd-sheet"></select></label>
        <label>Theme <select data-c="theme">${Object.entries(THEMES).filter(([k]) => k !== 'none').map(([k, t]) => `<option value="${k}">${t.icon} ${esc(t.name)}</option>`).join('')}</select></label>
        <label>Layout <select data-c="layout">${Object.entries(CARD_LAYOUTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Frame <input type="color" data-c="c1"></label>
        <label>Lettering <input type="color" data-c="c2"></label>
        <label class="wide">Picture <span class="cd-row"><label class="btn ghost file small-btn">Another picture…<input type="file" accept="image/*" hidden id="cd-photo"></label><button type="button" class="btn ghost small-btn" id="cd-portrait">Use the portrait</button><input type="range" min="0.3" max="4" step="0.01" data-c="zoom" aria-label="Zoom"></span></label>
        <label class="wide">A line about them <input data-c="tagline" maxlength="90" placeholder="“Never trust a quiet library.”"></label>
        <label class="wide cd-check"><input type="checkbox" data-c="showStats"> Show their numbers</label>
        <div class="wide cd-acts">
          ${(ctx.actions || []).map((a, i) => `<button type="button" class="btn${i === 0 ? ' primary' : ''} small-btn" data-act="${i}">${esc(a.label)}</button>`).join('')}
          <button type="button" class="btn ghost small-btn" id="cd-download">Download</button>
        </div>
        <p class="muted small wide" id="cd-note"></p>
      </div>
    </div>`;
  fillSheets();
  $('#cd-sheet', el).onchange = (e) => {
    sheetId = e.target.value;
    const s = sheet();
    design = cleanCardDesign({ ...design, ...(s?.data?.card?.design || {}), photo: s?.data?.card?.design?.photo || null, zoom: 1, ox: 0, oy: 0 });
    show(); draw();
  };
  for (const x of $$('[data-c]', el)) {
    x.addEventListener(x.tagName === 'SELECT' || x.type === 'checkbox' ? 'change' : 'input', () => {
      const f = x.dataset.c;
      const v = x.type === 'checkbox' ? x.checked : x.type === 'range' ? Number(x.value) : x.value;
      const next = { ...design, [f]: v };
      if (f === 'theme') { next.c1 = null; next.c2 = null; } // a new theme in its own colours
      design = cleanCardDesign(next);
      if (f === 'theme') show();
      draw();
    });
  }
  $('#cd-photo', el).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { design = cleanCardDesign({ ...design, photo: await ctx.upload(file), zoom: 1, ox: 0, oy: 0 }); show(); draw(); } catch (err) { toast(err.message || "That picture didn't upload", true); }
  };
  $('#cd-portrait', el).onclick = () => { design = cleanCardDesign({ ...design, photo: null, zoom: 1, ox: 0, oy: 0 }); show(); draw(); };
  $('#cd-download', el).onclick = async () => {
    const blob = await pngOf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(facts().name || 'card').replace(/[^\w -]+/g, '').trim() || 'card'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  el.querySelector('.cd-acts').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !sheet()) return;
    b.disabled = true;
    try {
      const image = await ctx.upload(new File([await pngOf()], 'card.png', { type: 'image/png' }));
      await ctx.actions[+b.dataset.act].run({ sheetId, image, design });
    } catch (err) { toast(err.message || "That didn't work", true); } finally { b.disabled = false; }
  };
  const cv = $('.cd-canvas', el);
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, ox = design.ox, oy = design.oy, k = 2 / cv.clientWidth;
    const move = (ev) => { design = { ...design, ox: Math.max(-1.5, Math.min(1.5, ox + (ev.clientX - sx) * k)), oy: Math.max(-1.5, Math.min(1.5, oy + (ev.clientY - sy) * k)) }; draw(); };
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); design = { ...design, zoom: Math.min(5, Math.max(0.3, design.zoom * (e.deltaY < 0 ? 1.06 : 0.94))) }; show(); draw(); }, { passive: false });
  show(); draw();
}

/** The list of characters changed (a new sheet): refresh it, if the designer's open. */
export function cardDesignerSheets() { if (root?.isConnected) { fillSheets(); draw(); } }

const sheet = () => ctx.sheets().find((s) => s.id === sheetId) || null;
const facts = () => { const s = sheet(); return cardFacts(s?.system, s?.data || {}); };

function fillSheets() {
  const list = ctx.sheets();
  if (!list.some((s) => s.id === sheetId)) sheetId = list[0]?.id || null;
  $('#cd-sheet', root).innerHTML = list.length ? list.map((s) => `<option value="${s.id}"${s.id === sheetId ? ' selected' : ''}>${esc(s.data?.name || 'Unnamed')}${CARD_SYSTEM_NAMES[s.system] ? ` (${esc(CARD_SYSTEM_NAMES[s.system])})` : ''}</option>`).join('') : '<option value="">No characters yet</option>';
  $('#cd-note', root).textContent = list.length ? '' : 'Make a character sheet first (or roll a quick character), then come back.';
}

function show() {
  if (!root?.isConnected) return;
  const [frame, accent] = cardColors(design);
  for (const x of $$('[data-c]', root)) {
    const f = x.dataset.c;
    if (x.type === 'checkbox') x.checked = !!design[f];
    else if (f === 'c1') x.value = frame;
    else if (f === 'c2') x.value = accent;
    else x.value = design[f] ?? '';
  }
}

let ticket = 0;
async function draw() {
  if (!root?.isConnected) return;
  const t = ++ticket;
  const s = sheet();
  const [photo, art] = await Promise.all([loadImage(design.photo || s?.data?.portrait || null), themeArt(design.theme)]);
  if (t !== ticket || !root?.isConnected) return;
  renderCard($('.cd-canvas', root), facts(), design, photo, art, { systemName: CARD_SYSTEM_NAMES[s?.system] || '', player: s ? ctx.player?.(s) || '' : '' });
}

function pngOf() {
  return new Promise((resolve, reject) => $('.cd-canvas', root).toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture"))), 'image/png'));
}
