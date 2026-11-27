// 3D dice: plays back throws recorded by the server's physics, over the screen or on the map.
// The server has already rolled the numbers and painted each die so it lands on the right face, so every
// screen sees the same dice and the same result. Chat holds the roll card back until the dice stop.
import { store, call, toast, $ } from './util.js';
import { serverUrl } from './net.js';
import { dieShape, faceText, valuesFor, TOP_HEAVY } from '/shared/dice3d.js';
import { cleanDiceStyle, defaultStyle, FINISHES, pictureFace, styleFor, DIE_SLOTS } from '/shared/dicestyle.js';
import { mapView, setDiceHidden, tokenVisible } from './map.js';

const SCREEN = { w: 1000, h: 625 };   // the virtual table that 'screen' throws land on (matches the server)
const FOV = 38;
const LINGER = 2.4;                   // seconds the dice stay after stopping
const FADE = 0.6;

let THREE = null, renderer = null, canvas = null, broken = false;
const layers = {};                    // screen / table: { scene, camera }
const throws = new Set();
const pending = new Map();            // chat message id -> promise resolved when its dice stop
let running = false;
let sceneWaiters = [];                // run on the next scene update (tokens handed back to the map)

export const dice3dOn = () => { try { return localStorage.getItem('lantern.dice3d') !== 'off'; } catch { return true; } };

/** The chat card for this roll waits for its dice (or null if there aren't any). */
export function diceDone(id) { return pending.get(id) || null; }

export function initDice3d(socket) {
  store.on('scene', () => { const w = sceneWaiters; sceneWaiters = []; w.forEach((fn) => setTimeout(fn, 30)); });
  socket.on('dice:throw', (p) => {
    if (!dice3dOn() || broken || document.hidden) return;
    let done;
    const promise = new Promise((r) => (done = r));
    pending.set(p.id, promise);
    const finish = () => { pending.delete(p.id); done(); };
    setTimeout(finish, (p.duration + 1.5) * 1000); // never hold the chat for long, whatever happens
    start(p, finish).catch((e) => { console.warn('[dice]', e); if (!renderer) broken = true; finish(); });
  });
  socket.on('dice:knocked', (k) => {
    toast(`The dice knocked ${k.fallen ? `over ${k.fallen} of ` : ''}${k.count} token${k.count === 1 ? '' : 's'} about. Scene tab ▸ Put them back to undo.`);
    const b = $('#dice-putback'); if (b) b.disabled = false;
  });

  // this device: show 3D dice or not
  const local = $('#dice3d-local');
  if (local) {
    local.checked = dice3dOn();
    local.onchange = () => { try { localStorage.setItem('lantern.dice3d', local.checked ? 'on' : 'off'); } catch { /* private mode */ } };
  }
  // the GM's per-scene setting, in the Scene tab
  const mode = $('#dice-mode');
  if (mode) {
    mode.onchange = () => call(socket, 'scene:update', { id: store.scene.id, dice: mode.value }).catch((e) => toast(e.message, true));
    store.on('scene', () => { mode.value = store.scene?.dice || 'screen'; });
  }
  const back = $('#dice-putback');
  if (back) back.onclick = () => call(socket, 'dice:putback', {})
    .then((r) => { toast(`Put ${r.count} token${r.count === 1 ? '' : 's'} back`); back.disabled = true; })
    .catch((e) => toast(e.message, true));
}

// ---------- setting up ----------
async function ensure() {
  if (renderer) return;
  THREE = await import('/three/three.module.js');
  canvas = document.createElement('canvas');
  canvas.className = 'dice3d';
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  const env = studio(renderer);
  for (const k of ['screen', 'table']) {
    const scene = new THREE.Scene();
    scene.environment = env; // something for metal, gold leaf and gloss to reflect
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x30303a, 1.4));
    layers[k] = { scene, camera: new THREE.PerspectiveCamera(FOV, 1, 1, 10000) };
  }
}

/** A soft studio to reflect: a dim room with a few bright panels, blurred into an environment map. */
function studio(r) {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0x2a2620, side: THREE.BackSide })));
  for (const [x, y, z, w, h, c] of [[0, 9.5, 0, 12, 12, 0xfff2dc], [-9.5, 2, 3, 6, 8, 0xc8d8ff], [9.5, 0, -2, 5, 7, 0xffd9a8], [0, -3, 9.5, 8, 3, 0x8a7a66]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0);
    room.add(m);
  }
  const pm = new THREE.PMREMGenerator(r);
  const tex = pm.fromScene(room, 0.04).texture;
  pm.dispose();
  return tex;
}

/** Point a layer's camera so the table (z = 0) lines up with the screen: `ppu` pixels per unit, `cx/cy` the unit under the window centre. */
function aim(camera, ppu, cx, cy) {
  const W = innerWidth, H = innerHeight;
  const h = (H / ppu) / 2 / Math.tan((FOV * Math.PI) / 360);
  camera.aspect = W / H;
  camera.position.set(cx, cy, h);
  camera.near = h * 0.02; camera.far = h * 2;
  camera.up.set(0, 1, 0);
  camera.lookAt(cx, cy, 0);
  camera.updateProjectionMatrix();
}

function frameCameras() {
  // screen: the virtual table fitted over the map area (so chat stays readable)
  const v = mapView();
  const r = v && v.rect.width > 200 && v.rect.height > 200 ? v.rect : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const k = Math.min(r.width / SCREEN.w, r.height / SCREEN.h) * 0.94;
  const dx = innerWidth / 2 - (r.left + r.width / 2), dy = innerHeight / 2 - (r.top + r.height / 2);
  aim(layers.screen.camera, k, SCREEN.w / 2 + dx / k, -SCREEN.h / 2 - dy / k);
  // table: map pixels, lined up with the map as it's panned and zoomed right now
  if (v) {
    const wx = (innerWidth / 2 - v.rect.left - v.x) / v.zoom, wy = (innerHeight / 2 - v.rect.top - v.y) / v.zoom;
    aim(layers.table.camera, v.zoom, wx, -wy);
  }
}

// ---------- a throw ----------
async function start(p, finish) {
  await ensure();
  const onScene = p.mode === 'table' && store.scene?.id === p.sceneId && mapView();
  const layer = onScene ? layers.table : layers.screen;
  // where the throw's units go: map pixels (table) or the virtual screen table, fitted if it's another scene's map
  const group = new THREE.Group();
  let scale = p.s, ox = p.rect.x, oy = -p.rect.y;
  if (!onScene && p.mode === 'table') {
    const k = Math.min(SCREEN.w / p.rect.w, SCREEN.h / p.rect.h);
    scale = p.s * k;
    ox = (SCREEN.w - p.rect.w * k) / 2; oy = -(SCREEN.h - p.rect.h * k) / 2;
  }
  group.position.set(ox, oy, 0);
  group.scale.setScalar(scale);
  layer.scene.add(group);

  const aw = p.rect.w / p.s, ah = p.rect.h / p.s; // arena in units
  // light and a floor that only catches shadows
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(aw * 0.3, -ah * 0.1, 30);
  sun.target.position.set(aw * 0.5, -ah * 0.5, 0);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -aw; sc.right = aw; sc.top = ah; sc.bottom = -ah; sc.near = 1; sc.far = 80;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0015;
  group.add(sun, sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(aw * 1.2, ah * 1.2), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.position.set(aw / 2, -ah / 2, 0);
  floor.receiveShadow = true;
  group.add(floor);

  // the roller's own dice (Dice tab ▸ Your dice), or plain dice in their player colour
  // (a set from the dice designer can give each die its own look, and its own picture)
  const set = cleanDiceStyle(p.style) || defaultStyle(p.color);
  const looks = p.dice.map((d) => styleFor(set, d));
  const pics = await Promise.all(looks.map((st) => picture(st.picture)));
  const bodies = p.dice.map((d, i) => { const m = dieMesh(d, looks[i], pics[i]); group.add(m); return m; });
  // tokens being knocked about (only ones this person can see on the map they're looking at)
  const shown = onScene ? p.tokens.filter((t) => tokenVisible(t.id)) : [];
  const tokenMeshes = p.tokens.map((t) => {
    if (!shown.includes(t)) return null;
    const tok = store.scene.tokens.find((x) => x.id === t.id);
    const m = tokenMesh(tok, t);
    group.add(m);
    return m;
  });
  if (shown.length) setDiceHidden(shown.map((t) => t.id), true);
  const meshes = [...bodies, ...tokenMeshes];

  const th = { p, group, layer, meshes, bodies, t0: performance.now(), finish, shown, stopped: false, dispose: [] };
  throws.add(th);
  if (!running) { running = true; requestAnimationFrame(loop); }
}

function loop() {
  const now = performance.now();
  frameCameras();
  renderer.setSize(innerWidth, innerHeight, false);
  for (const th of throws) step(th, now);
  renderer.clear();
  for (const k of ['screen', 'table']) renderer.render(layers[k].scene, layers[k].camera);
  if (throws.size) requestAnimationFrame(loop);
  else { running = false; renderer.clear(); }
}

const qa = () => new THREE.Quaternion(), qb = () => new THREE.Quaternion();
function step(th, now) {
  const { p } = th;
  const t = (now - th.t0) / 1000;
  const fi = Math.min(t / p.dt, p.frames.length - 1);
  const i0 = Math.floor(fi), i1 = Math.min(i0 + 1, p.frames.length - 1), u = fi - i0;
  const f0 = p.frames[i0], f1 = p.frames[i1];
  const A = qa(), B = qb();
  th.meshes.forEach((m, k) => {
    if (!m) return;
    const o = k * 7;
    m.position.set(f0[o] + (f1[o] - f0[o]) * u, f0[o + 1] + (f1[o + 1] - f0[o + 1]) * u, f0[o + 2] + (f1[o + 2] - f0[o + 2]) * u);
    A.set(f0[o + 3], f0[o + 4], f0[o + 5], f0[o + 6]);
    B.set(f1[o + 3], f1[o + 4], f1[o + 5], f1[o + 6]);
    m.quaternion.slerpQuaternions(A, B, u);
  });
  if (!th.stopped && t >= p.duration) {
    th.stopped = true;
    th.finish();
    // dice that don't count (advantage, bonus dice…) go see-through
    th.bodies.forEach((m, k) => { if (!p.dice[k].kept) setOpacity(m, 0.35); });
    showTotal(th);
    // hand the tokens back to the map once the server has moved them
    if (th.shown.length) {
      const back = () => {
        if (th.handed) return; th.handed = true;
        setDiceHidden(th.shown.map((x) => x.id), false);
        th.meshes.slice(th.bodies.length).forEach((m) => m && th.group.remove(m));
      };
      sceneWaiters.push(back);
      setTimeout(back, 1500);
    }
  }
  // fade out and tidy up
  const end = p.duration + LINGER;
  if (t > end) {
    const a = Math.max(0, 1 - (t - end) / FADE);
    th.bodies.forEach((m, k) => setOpacity(m, a * (p.dice[k].kept ? 1 : 0.35)));
    if (a <= 0) {
      th.layer.scene.remove(th.group);
      th.group.traverse((o) => { o.geometry?.dispose?.(); for (const mt of [].concat(o.material || [])) { mt.map?.dispose?.(); mt.emissiveMap?.dispose?.(); mt.metalnessMap?.dispose?.(); mt.dispose?.(); } });
      th.label?.remove();
      throws.delete(th);
    }
  }
}

function setOpacity(mesh, a) {
  const base = mesh.userData.opacity ?? 1; // glass dice are see-through to start with
  for (const m of [].concat(mesh.material)) { m.transparent = a * base < 1; m.opacity = a * base; }
}

/** The total pops up above the dice for a moment. */
function showTotal(th) {
  const { p, bodies, layer } = th;
  if (!bodies.length || p.total == null) return;
  const c = new THREE.Vector3();
  bodies.forEach((m) => c.add(m.getWorldPosition(new THREE.Vector3())));
  c.divideScalar(bodies.length).project(layer.camera);
  const x = (c.x * 0.5 + 0.5) * innerWidth, y = (-c.y * 0.5 + 0.5) * innerHeight;
  const el = document.createElement('div');
  el.className = 'dice3d-total';
  el.textContent = p.successes ? `${p.total} success${p.total === 1 ? '' : 'es'}` : p.total;
  el.style.left = `${Math.max(40, Math.min(innerWidth - 40, x))}px`;
  el.style.top = `${Math.max(40, Math.min(innerHeight - 40, y - 70))}px`;
  el.style.setProperty('--c', p.color || '#e8a33d');
  document.body.appendChild(el);
  th.label = el;
}

// ---------- making dice ----------
const pictures = new Map();
/** The top-face picture, loaded once (and never holding a roll up for long). */
function picture(url) {
  if (!url) return Promise.resolve(null);
  if (!pictures.has(url)) {
    pictures.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => { pictures.delete(url); resolve(null); };
      img.src = serverUrl(url);
      setTimeout(() => resolve(null), 1500);
    }));
  }
  return pictures.get(url);
}

/** A tiny repeatable random, so a pattern looks the same every frame and on every screen. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The die's surface: its colour and pattern over the whole texture. */
function paintBody(g, w, h, style, seed) {
  g.fillStyle = style.body;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  if (style.pattern === 'marble') {
    g.save();
    g.strokeStyle = style.body2;
    g.lineCap = 'round';
    for (let k = 0; k < Math.round((w * h) / 9000); k++) {
      g.globalAlpha = 0.25 + r() * 0.45;
      g.lineWidth = 2 + r() * 9;
      g.beginPath();
      let x = r() * w, y = r() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        const nx = x + (r() - 0.5) * w * 0.5, ny = y + (r() - 0.5) * h * 0.5;
        g.quadraticCurveTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120, nx, ny);
        x = nx; y = ny;
      }
      g.stroke();
    }
    g.restore();
  } else if (style.pattern === 'speckle') {
    g.save();
    g.fillStyle = style.body2;
    for (let k = 0; k < Math.round((w * h) / 140); k++) {
      g.globalAlpha = 0.4 + r() * 0.6;
      g.beginPath();
      g.arc(r() * w, r() * h, 0.8 + r() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  const out = FINISHES[style.finish]?.material ? paintMaterial(g, w, h, style, r) : {};
  // the dice designer: another material's pattern painted over this one, in its own colour
  if (style.overlay && FINISHES[style.overlay]?.material) {
    const more = paintMaterial(g, w, h, { ...style, finish: style.overlay, body2: style.overlayColor || FINISHES[style.overlay].colors[1] }, rng(seed + 7));
    for (const k of ['glow', 'metal']) {
      if (!more[k]) continue;
      if (!out[k]) { out[k] = more[k]; if (k === 'metal') out.metalCtx = more.metalCtx; continue; }
      const ctx = out[k].getContext('2d');
      ctx.save(); ctx.globalCompositeOperation = 'lighten'; ctx.drawImage(more[k], 0, 0); ctx.restore();
    }
    out.glowInk ||= more.glowInk;
  }
  return out;
}

const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};
const layer = (w, h, fill = '#000') => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, w, h); return [c, x]; };
/** A wandering line: veins, cracks, grain. */
function wander(g, r, x, y, steps, len, bend) {
  g.beginPath(); g.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let s = 0; s < steps; s++) { a += (r() - 0.5) * bend; x += Math.cos(a) * len; y += Math.sin(a) * len; g.lineTo(x, y); }
  g.stroke();
}

/** Ornamental scrollwork: little spirals and leaves, for engraved and gilded dice. `targets`: [[ctx, colour, alpha]…], all drawn the same. */
function filigree(targets, r, w, h, width) {
  for (const [ctx, color, alpha] of targets) { ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.lineCap = 'round'; }
  for (let k = 0; k < (w * h) / 900; k++) {
    const x = r() * w, y = r() * h, s = 5 + r() * 9, dir = r() < 0.5 ? 1 : -1;
    for (const [ctx] of targets) {
      ctx.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.08) {
        const a = dir * t * Math.PI * 3, rad = s * (1 - t * 0.85);
        const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
        t ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + s, y); ctx.quadraticCurveTo(x + s * 2, y - s * dir, x + s * 2.6, y + s * 0.3 * dir); ctx.stroke();
    }
  }
  for (const [ctx] of targets) ctx.restore();
}
/** Soft clouds of colour (nebulae, mottling, inner veins). */
function clouds(g, r, w, h, color, count, size, alpha) {
  for (let k = 0; k < count; k++) {
    const x = r() * w, y = r() * h, rad = size * (0.4 + r());
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = alpha * (0.5 + r() * 0.5); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalAlpha = 1;
}
/** Stars, drawn on the die and on its glow map. */
function stars(ctxs, r, w, h, count) {
  for (let k = 0; k < count; k++) {
    const x = r() * w, y = r() * h, s = r() < 0.05 ? 1.9 : 0.7, a = 0.4 + r() * 0.6;
    for (const ctx of ctxs) { ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); }
  }
  for (const ctx of ctxs) ctx.globalAlpha = 1;
}
/** Glowing cracks or veins, with a soft halo, on the die and its glow map. */
function glowingVeins(g, r, w, h, color, count, width) {
  const [gc, gl] = layer(w, h);
  for (let k = 0; k < count; k++) {
    const x = r() * w, y = r() * h, lw = width * (0.5 + r()), seed = Math.floor(r() * 1e9);
    for (const ctx of [g, gl]) { ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; wander(ctx, rng(seed), x, y, 9, 9, 1.4); }
  }
  const [hc, hl] = layer(w, h);
  hl.filter = 'blur(4px)'; hl.drawImage(gc, 0, 0); hl.filter = 'none';
  gl.globalCompositeOperation = 'lighter'; gl.globalAlpha = 0.7; gl.drawImage(hc, 0, 0);
  gl.globalCompositeOperation = 'source-over'; gl.globalAlpha = 1;
  return gc;
}

/**
 * The earnable materials (Iron to The First Dice): painted over your colours (each starts from its own).
 * Returns extra maps: `glow` (lights up by itself), `glowInk` (the numbers glow too), `glowAll` (the whole die
 * glows a little) and `metal` (where it's metal, when only part of it is), or nothing.
 */
function paintMaterial(g, w, h, style, r) {
  const f = style.finish, out = {};
  if (f === 'iron') {
    clouds(g, r, w, h, '#000', (w * h) / 1500, 18, 0.35);
    clouds(g, r, w, h, style.body2, (w * h) / 2500, 14, 0.35);
    g.strokeStyle = style.body2; g.lineWidth = 0.7;
    for (let k = 0; k < (w * h) / 900; k++) { g.globalAlpha = 0.25 + r() * 0.3; const x = r() * w, y = r() * h, a = r() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (4 + r() * 14), y + Math.sin(a) * (4 + r() * 14)); g.stroke(); }
  } else if (f === 'oak') {
    g.strokeStyle = style.body2;
    for (let y = 0; y < h; y += 2 + r() * 4) {
      g.globalAlpha = 0.2 + r() * 0.45; g.lineWidth = 0.8 + r() * 2.4;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 14) g.lineTo(x, y + Math.sin(x / 60 + y / 35) * 5 + (r() - 0.5) * 1.5);
      g.stroke();
    }
    for (let k = 0; k < (w * h) / 80000; k++) { g.globalAlpha = 0.55; g.lineWidth = 2; g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 10, 3 + r() * 4, 0, 0, Math.PI * 2); g.stroke(); }
  } else if (f === 'copper') {
    const [mc, m] = layer(w, h, '#fff');
    clouds(g, r, w, h, '#000', (w * h) / 3000, 16, 0.25);
    // verdigris: green patina where the metal has weathered (not shiny there)
    for (let k = 0; k < (w * h) / 1800; k++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 18;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, style.body2); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.55 + r() * 0.4; g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      const mg = m.createRadialGradient(x, y, 0, x, y, rad);
      mg.addColorStop(0, '#000'); mg.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = mg; m.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    out.metal = mc;
  } else if (f === 'bone') {
    for (let k = 0; k < (w * h) / 60; k++) { g.globalAlpha = 0.08 + r() * 0.2; g.fillStyle = style.body2; g.beginPath(); g.arc(r() * w, r() * h, 0.5 + r() * 1.3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = style.body2;
    for (let k = 0; k < (w * h) / 9000; k++) { g.globalAlpha = 0.55 + r() * 0.3; g.lineWidth = 0.8 + r() * 1.2; wander(g, r, r() * w, r() * h, 14, 6, 1.5); }
  } else if (f === 'garnet') {
    clouds(g, r, w, h, style.body2, (w * h) / 2200, 22, 0.45);
    g.strokeStyle = style.body2; g.lineWidth = 1.5;
    for (let k = 0; k < (w * h) / 6000; k++) { g.globalAlpha = 0.35 + r() * 0.3; wander(g, r, r() * w, r() * h, 10, 7, 1.0); }
    stars([g], r, w, h, (w * h) / 900); // glints
  } else if (f === 'jade') {
    clouds(g, r, w, h, '#000', (w * h) / 2500, 20, 0.3);
    g.strokeStyle = style.body2; g.lineCap = 'round';
    for (let k = 0; k < (w * h) / 5000; k++) { g.globalAlpha = 0.25 + r() * 0.35; g.lineWidth = 2 + r() * 7; wander(g, r, r() * w, r() * h, 6, 18, 0.8); }
  } else if (f === 'silver') {
    clouds(g, r, w, h, '#fff', (w * h) / 3000, 16, 0.25);
    filigree([[g, style.body2, 0.75]], r, w, h, 1.4);
  } else if (f === 'obsidian') {
    clouds(g, r, w, h, '#2a2a34', (w * h) / 3000, 20, 0.35);
    out.glow = glowingVeins(g, r, w, h, style.body2, (w * h) / 7000, 2);
    out.glowInk = true;
  } else if (f === 'arcane') {
    clouds(g, r, w, h, style.body2, (w * h) / 2000, 40, 0.5);
    clouds(g, r, w, h, '#3a7aff', (w * h) / 5000, 30, 0.35);
    const [gc, gl] = layer(w, h);
    stars([g, gl], r, w, h, (w * h) / 140);
    out.glow = gc;
  } else if (f === 'dragonbone') {
    // scales: overlapping arcs, darker in the gaps and lighter on the rims
    for (let y = 0, row = 0; y < h + 12; y += 9, row++) {
      for (let x = (row % 2) * 7; x < w + 14; x += 14) {
        g.globalAlpha = 0.55; g.strokeStyle = '#000'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, 8, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
        g.globalAlpha = 0.45; g.strokeStyle = style.body2; g.lineWidth = 1; g.beginPath(); g.arc(x, y - 1, 7, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      }
    }
    g.globalAlpha = 1;
  } else if (f === 'celestial') {
    clouds(g, r, w, h, style.body2, (w * h) / 2600, 34, 0.45);
    const [gc, gl] = layer(w, h);
    stars([g, gl], r, w, h, (w * h) / 110);
    out.glow = gc;
  } else if (f === 'eldritch') {
    clouds(g, r, w, h, '#ffffff', (w * h) / 3000, 26, 0.3);
    g.strokeStyle = style.body2; g.lineCap = 'round';
    for (let k = 0; k < (w * h) / 3500; k++) { g.globalAlpha = 0.4 + r() * 0.4; g.lineWidth = 1 + r() * 3.5; wander(g, r, r() * w, r() * h, 12, 8, 1.7); }
  } else if (f === 'royal') {
    const [mc, m] = layer(w, h);
    clouds(g, r, w, h, '#000', (w * h) / 3000, 18, 0.25);
    filigree([[g, style.body2, 0.95], [m, '#fff', 1]], r, w, h, 1.6);
    out.metal = mc;
    out.metalCtx = m;
  } else if (f === 'void') {
    clouds(g, r, w, h, style.body2, (w * h) / 9000, 30, 0.22);
    const [gc, gl] = layer(w, h);
    stars([g, gl], r, w, h, (w * h) / 700);
    out.glow = gc;
    out.glowInk = true;
  } else if (f === 'first') {
    clouds(g, r, w, h, '#fff6d0', (w * h) / 2500, 18, 0.35);
    filigree([[g, style.body2, 0.7]], r, w, h, 1.5);
    const [gc] = layer(w, h);
    out.glow = gc;
    out.glowInk = true;
    out.glowAll = 0.3; // the whole die glows faintly gold
  // the creator materials (Lantern Plus: earned by publishing, updating and reviews)
  } else if (f === 'stone') {
    for (let k = 0; k < (w * h) / 60; k++) { g.globalAlpha = 0.08 + r() * 0.18; g.fillStyle = r() < 0.5 ? style.body2 : r() < 0.5 ? '#000' : '#fff'; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
    g.strokeStyle = style.body2; g.lineWidth = 1.2;
    for (let k = 0; k < (w * h) / 40000; k++) { g.globalAlpha = 0.35 + r() * 0.3; wander(g, r, r() * w, r() * h, 30, 6, 0.9); }
  } else if (f === 'wood') {
    g.strokeStyle = style.body2;
    for (let y = 0; y < h; y += 3 + r() * 5) {
      g.globalAlpha = 0.15 + r() * 0.4; g.lineWidth = 0.8 + r() * 2.2;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / 70 + y / 40) * 4 + (r() - 0.5) * 1.5);
      g.stroke();
    }
    for (let k = 0; k < (w * h) / 90000; k++) { g.globalAlpha = 0.5; g.lineWidth = 2; g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 10, 3 + r() * 4, 0, 0, Math.PI * 2); g.stroke(); }
  } else if (f === 'ivory') {
    g.globalAlpha = 0.55; g.fillStyle = '#e9dfc8'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < (w * h) / 55; k++) { g.globalAlpha = 0.1 + r() * 0.25; g.fillStyle = style.body2; g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * 1.4, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = style.body2; g.lineWidth = 0.8;
    for (let k = 0; k < (w * h) / 25000; k++) { g.globalAlpha = 0.45; wander(g, r, r() * w, r() * h, 18, 5, 1.6); }
  } else if (f === 'goldleaf') {
    const [mc, m] = layer(w, h);
    m.fillStyle = '#fff';
    for (let k = 0; k < (w * h) / 650; k++) {
      const x = r() * w, y = r() * h, s = 2 + r() * 8;
      const pts = Array.from({ length: 6 }, (_, v) => { const a = (v / 6) * Math.PI * 2 + r() * 0.6, q = s * (0.5 + r() * 0.6); return [x + Math.cos(a) * q, y + Math.sin(a) * q]; });
      g.globalAlpha = 1; g.fillStyle = mixHex('#d4af37', '#f6e27a', r());
      for (const ctx of [g, m]) { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fill(); }
    }
    out.metal = mc;
  } else if (f === 'galaxy') {
    for (let k = 0; k < (w * h) / 6000; k++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 70;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, style.body2); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.25 + r() * 0.3; g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const [gc, gl] = layer(w, h);
    for (let k = 0; k < (w * h) / 120; k++) {
      const x = r() * w, y = r() * h, s = r() < 0.04 ? 1.8 : 0.7, a = 0.4 + r() * 0.6;
      for (const ctx of [g, gl]) { ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill(); }
    }
    gl.globalAlpha = 1;
    out.glow = gc;
  } else if (f === 'molten') {
    g.globalAlpha = 0.6; g.fillStyle = '#000'; g.fillRect(0, 0, w, h); // cooled crust
    const [gc, gl] = layer(w, h);
    for (let k = 0; k < (w * h) / 5000; k++) {
      const x = r() * w, y = r() * h, lw = 1.5 + r() * 3.5, seed = Math.floor(r() * 1e9);
      for (const ctx of [g, gl]) { ctx.globalAlpha = 1; ctx.strokeStyle = style.body2; ctx.lineWidth = lw; ctx.lineJoin = 'round'; wander(ctx, rng(seed), x, y, 9, 9, 1.4); }
    }
    // a soft halo round the cracks
    const [hc, hl] = layer(w, h);
    hl.filter = 'blur(4px)'; hl.drawImage(gc, 0, 0); hl.filter = 'none';
    gl.globalCompositeOperation = 'lighter'; gl.globalAlpha = 0.7; gl.drawImage(hc, 0, 0);
    gl.globalCompositeOperation = 'source-over'; gl.globalAlpha = 1;
    out.glow = gc;
  } else if (f === 'runes') {
    const [gc, gl] = layer(w, h);
    // runes: little angular glyphs, faint on the die and glowing faintly
    for (let k = 0; k < (w * h) / 1600; k++) {
      const x = r() * w, y = r() * h, s = 4 + r() * 6;
      const pts = Array.from({ length: 3 + Math.floor(r() * 3) }, () => [x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s * 2]);
      for (const ctx of [g, gl]) {
        ctx.globalAlpha = ctx === g ? 0.5 : 0.35; ctx.strokeStyle = style.body2; ctx.lineWidth = 1.2;
        ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
      }
    }
    gl.globalAlpha = 1;
    out.glow = gc;
    out.glowInk = true; // the numbers glow too
  // the game master materials (Lantern Plus: earned by running sessions)
  } else if (f === 'lantern') {
    // amber glass with a flame inside: warm bright cores that light up by themselves
    clouds(g, r, w, h, '#5a2204', (w * h) / 3000, 22, 0.35);
    const [gc, gl] = layer(w, h);
    for (let k = 0; k < (w * h) / 4500; k++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 26;
      for (const [ctx, a] of [[g, 0.55], [gl, 0.9]]) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, '#fff3c0'); gr.addColorStop(0.35, style.body2); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a * (0.6 + r() * 0.4); ctx.fillStyle = gr; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    gl.globalAlpha = 1;
    out.glow = gc;
    out.glowAll = 0.12;
  } else if (f === 'ink') {
    // parchment, blotted and scratched with ink
    clouds(g, r, w, h, '#b79c66', (w * h) / 2200, 24, 0.35);
    g.fillStyle = style.body2;
    for (let k = 0; k < (w * h) / 9000; k++) {
      const x = r() * w, y = r() * h, rad = 3 + r() * 9;
      g.globalAlpha = 0.75 + r() * 0.25; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      for (let d = 0; d < 6; d++) { const a = r() * Math.PI * 2, q = rad * (1.3 + r() * 1.8); g.beginPath(); g.arc(x + Math.cos(a) * q, y + Math.sin(a) * q, 0.6 + r() * 1.8, 0, Math.PI * 2); g.fill(); }
    }
    g.strokeStyle = style.body2; g.lineCap = 'round';
    for (let k = 0; k < (w * h) / 6000; k++) { g.globalAlpha = 0.25 + r() * 0.35; g.lineWidth = 0.6 + r() * 1.4; wander(g, r, r() * w, r() * h, 8, 6, 0.5); }
  } else if (f === 'keeper') {
    // tooled leather with gilt scrollwork
    const [mc, m] = layer(w, h);
    for (let k = 0; k < (w * h) / 40; k++) { g.globalAlpha = 0.08 + r() * 0.15; g.fillStyle = r() < 0.6 ? '#000' : '#4a6a52'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    g.strokeStyle = '#000'; g.lineWidth = 0.8;
    for (let k = 0; k < (w * h) / 7000; k++) { g.globalAlpha = 0.3; wander(g, r, r() * w, r() * h, 6, 7, 1.2); }
    filigree([[g, style.body2, 0.9], [m, '#fff', 1]], r, w, h, 1.3);
    out.metal = mc;
    out.metalCtx = m;
  // the seasonal materials (Lantern Plus: earned by playing in that season)
  } else if (f === 'frost') {
    // ice crystals: little six-armed stars with branches, and glints
    clouds(g, r, w, h, '#7fb4d8', (w * h) / 3000, 24, 0.3);
    const [gc, gl] = layer(w, h);
    for (let k = 0; k < (w * h) / 2600; k++) {
      const x = r() * w, y = r() * h, s = 4 + r() * 10, turn = r() * Math.PI;
      for (const [ctx, a] of [[g, 0.85], [gl, 0.5]]) {
        ctx.globalAlpha = a; ctx.strokeStyle = style.body2; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
        for (let arm = 0; arm < 6; arm++) {
          const an = turn + (arm * Math.PI) / 3, ex = x + Math.cos(an) * s, ey = y + Math.sin(an) * s;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
          const mx = x + Math.cos(an) * s * 0.6, my = y + Math.sin(an) * s * 0.6;
          for (const side of [-1, 1]) { ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(an + side * 0.7) * s * 0.35, my + Math.sin(an + side * 0.7) * s * 0.35); }
          ctx.stroke();
        }
      }
    }
    stars([g, gl], r, w, h, (w * h) / 500);
    out.glow = gc;
  } else if (f === 'blossom') {
    // cherry blossom: five-petalled flowers scattered over soft pink
    clouds(g, r, w, h, '#ffffff', (w * h) / 3000, 26, 0.35);
    for (let k = 0; k < (w * h) / 1500; k++) {
      const x = r() * w, y = r() * h, s = 2.5 + r() * 4.5, turn = r() * Math.PI, pale = r() < 0.4;
      g.globalAlpha = 0.6 + r() * 0.4; g.fillStyle = pale ? '#fff4f7' : style.body2;
      for (let p = 0; p < 5; p++) { const a = turn + (p * Math.PI * 2) / 5; g.beginPath(); g.ellipse(x + Math.cos(a) * s, y + Math.sin(a) * s, s * 0.9, s * 0.55, a, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1; g.fillStyle = '#f2c84a'; g.beginPath(); g.arc(x, y, s * 0.35, 0, Math.PI * 2); g.fill();
    }
  } else if (f === 'sunburst') {
    // rays out from bright suns, which glow
    const [gc, gl] = layer(w, h);
    for (let k = 0; k < (w * h) / 9000; k++) {
      const x = r() * w, y = r() * h, len = 20 + r() * 40;
      g.strokeStyle = style.body2; g.lineCap = 'round';
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) { g.globalAlpha = 0.35 + r() * 0.3; g.lineWidth = 1 + r() * 2.5; g.beginPath(); g.moveTo(x + Math.cos(a) * len * 0.25, y + Math.sin(a) * len * 0.25); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); }
      for (const [ctx, a] of [[g, 0.8], [gl, 1]]) {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, len * 0.45);
        gr.addColorStop(0, '#fff7cf'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a; ctx.fillStyle = gr; ctx.fillRect(x - len, y - len, len * 2, len * 2);
      }
    }
    gl.globalAlpha = 1;
    out.glow = gc;
  } else if (f === 'harvest') {
    // pumpkin skin: dark ribs and a few fallen leaves; the numbers glow like a carved face
    for (let x = 0; x < w; x += 10 + r() * 8) {
      g.globalAlpha = 0.3 + r() * 0.2; g.strokeStyle = style.body2; g.lineWidth = 2 + r() * 3;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 12) g.lineTo(x + Math.sin(y / 45 + x) * 3, y);
      g.stroke();
    }
    clouds(g, r, w, h, '#ffb050', (w * h) / 4000, 20, 0.3);
    for (let k = 0; k < (w * h) / 9000; k++) {
      const x = r() * w, y = r() * h, s = 3 + r() * 5, a = r() * Math.PI;
      g.globalAlpha = 0.85; g.fillStyle = ['#8a1a0a', '#d89a1a', '#5a3a10'][Math.floor(r() * 3)];
      g.beginPath(); g.ellipse(x, y, s * 1.6, s * 0.7, a, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.6; g.strokeStyle = '#2a1404'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x - Math.cos(a) * s * 1.6, y - Math.sin(a) * s * 1.6); g.lineTo(x + Math.cos(a) * s * 1.6, y + Math.sin(a) * s * 1.6); g.stroke();
    }
    const [gc] = layer(w, h);
    out.glow = gc;
    out.glowInk = true;
  }
  g.globalAlpha = 1;
  return out;
}

/** A die with its own numbers painted on: one texture, a square of it per face. */
function dieMesh(d, style, pic) {
  const shape = dieShape(d.sides);
  const n = shape.faces.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), cell = 128;
  const cv = document.createElement('canvas');
  cv.width = cols * cell; cv.height = rows * cell;
  const g = cv.getContext('2d');
  const extra = paintBody(g, cv.width, cv.height, style, d.sides * 31 + (d.value | 0));
  const picAt = pic && !shape.readDown ? pictureFace(d.labels, d.sides, d.kind) : -1;
  const fin = FINISHES[style.finish] || FINISHES.gloss;
  // a rim round each face: the material's own (Royal, Keeper's seal…), or one from another material in the designer
  const rimMat = style.rim && FINISHES[style.rim];
  const rimColor = rimMat ? rimMat.colors[1] : style.body2;
  if (rimMat && rimMat.metalness >= 0.6 && !extra.metal) {
    // a metal rim on a die that isn't metal: a metal map that's only the rims
    const [mc, m] = layer(cv.width, cv.height);
    extra.metal = mc; extra.metalCtx = m; extra.rimOnlyMetal = true;
  }
  const serif = style.font ? style.font === 'serif' : fin.serif;
  const font = serif ? '600 SIZEpx "Fraunces", Georgia, "Times New Roman", serif' : '700 SIZEpx "IBM Plex Sans", Arial, sans-serif';
  g.fillStyle = style.ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';

  const pos = [], uv = [];
  const V = shape.vertices;
  shape.faces.forEach((f, k) => {
    const nrm = shape.normals[k];
    const c = [0, 0, 0];
    for (const i of f) for (let a = 0; a < 3; a++) c[a] += V[i][a] / f.length;
    // the face's own up: towards its far corner (d10 kites, triangles) or an edge (d6)
    const far = f.reduce((best, i) => (dist(V[i], c) > dist(V[best], c) + 1e-6 ? i : best), f[0]);
    let upv = d.sides === 6 ? sub(mid(V[f[0]], V[f[1]]), c) : sub(V[far], c);
    if (d.sides === 10) upv = sub(V[far], c);
    upv = normalise(upv);
    const right = normalise(cross(upv, nrm));
    const rad = Math.max(...f.map((i) => dist(V[i], c)));
    const col = k % cols, row = Math.floor(k / cols);
    const cx = col * cell + cell / 2, cy = row * cell + cell / 2, half = cell * 0.47;
    const toUV = (p3) => {
      const q = sub(p3, c);
      const a = dot(q, right) / rad, b = dot(q, upv) / rad;
      return [(cx + a * half) / cv.width, 1 - (cy - b * half) / cv.height];
    };
    // triangles (fan) with uvs
    for (let j = 1; j + 1 < f.length; j++) {
      for (const i of [f[0], f[j], f[j + 1]]) { pos.push(...V[i]); uv.push(...toUV(V[i])); }
    }
    if (style.pattern === 'split') {
      // two-tone: each face shades from one colour to the other
      const gr = g.createLinearGradient(cx - half, cy - half, cx + half, cy + half);
      gr.addColorStop(0, style.body); gr.addColorStop(1, style.body2);
      g.save(); g.fillStyle = gr; g.fillRect(col * cell, row * cell, cell, cell); g.restore();
      g.fillStyle = style.ink;
    }
    // a rim round the face (gilded, engraved): on the die, and on the metal map when the rim is the only metal
    if (fin.edges || rimMat) {
      const pts = f.map((i) => { const q = sub(V[i], c); return [cx + (dot(q, right) / rad) * half, cy - (dot(q, upv) / rad) * half]; });
      const metalRim = extra.metalCtx && (!rimMat || rimMat.metalness >= 0.6 || rimMat.edges);
      for (const [ctx, col] of [[g, rimColor], ...(metalRim ? [[extra.metalCtx, '#fff']] : [])]) {
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = cell * 0.05; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
        ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
      g.fillStyle = style.ink;
    }
    // the top face's picture, in place of its number
    if (k === picAt) {
      const rr = half * ({ 6: 0.8, 8: 0.5, 10: 0.5, 12: 0.62, 20: 0.46 }[d.sides] || 0.5);
      const dy = d.sides === 8 || d.sides === 20 ? cell * 0.06 : 0;
      const sc = Math.max((rr * 2) / pic.width, (rr * 2) / pic.height);
      g.save();
      g.beginPath(); g.arc(cx, cy + dy, rr, 0, Math.PI * 2); g.clip();
      g.drawImage(pic, cx - (pic.width * sc) / 2, cy + dy - (pic.height * sc) / 2, pic.width * sc, pic.height * sc);
      g.restore();
      g.fillStyle = style.ink;
      return;
    }
    // numbers
    if (shape.readDown) {
      // d4: by each corner, the number you'd read with that corner on top
      for (const i of f) {
        const opp = shape.faces.findIndex((ff) => !ff.includes(i));
        const q = sub(V[i], c);
        const a = dot(q, right) / rad, b = dot(q, upv) / rad;
        g.save();
        g.translate(cx + a * half * 0.55, cy - b * half * 0.55);
        g.rotate(Math.atan2(a, b));
        g.font = font.replace('SIZE', cell * 0.26);
        g.fillText(faceText(d.kind, d.sides, d.labels[opp]), 0, 0);
        g.restore();
      }
    } else {
      const text = faceText(d.kind, d.sides, d.labels[k]);
      const size = { 6: 0.5, 8: 0.36, 10: 0.36, 12: 0.38, 20: 0.3 }[d.sides] * cell * (text.length > 1 ? 0.85 : 1);
      g.font = font.replace('SIZE', size);
      const dy = d.sides === 8 || d.sides === 20 ? cell * 0.06 : d.sides === 10 ? -cell * 0.02 : 0; // sit in the middle of a triangle
      g.fillText(text, cx, cy + dy);
      // 6 and 9 get a line under them so you can tell which way up they are
      if ((text === '6' || text === '9') && d.sides > 6) {
        const w = g.measureText(text).width;
        g.fillRect(cx - w / 2, cy + dy + size * 0.42, w, Math.max(3, size * 0.07));
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const opts = { map: tex, roughness: fin.roughness, metalness: fin.metalness, flatShading: true };
  const canvasTex = (c, srgb) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  if (extra.glowAll) {
    // the whole die glows a little (The First Dice)
    const gl = extra.glow.getContext('2d');
    gl.globalAlpha = extra.glowAll; gl.drawImage(cv, 0, 0); gl.globalAlpha = 1;
  }
  if (extra.glowInk) {
    // the numbers light up (Obsidian, Void, The First Dice)
    const gl = extra.glow.getContext('2d');
    const src = g.getImageData(0, 0, cv.width, cv.height), dst = gl.getImageData(0, 0, cv.width, cv.height);
    const ink = parseInt(style.ink.slice(1), 16), ir = (ink >> 16) & 255, ig = (ink >> 8) & 255, ib = ink & 255;
    for (let i = 0; i < src.data.length; i += 4) {
      const dd = Math.abs(src.data[i] - ir) + Math.abs(src.data[i + 1] - ig) + Math.abs(src.data[i + 2] - ib);
      if (dd < 60) { dst.data[i] = src.data[i]; dst.data[i + 1] = src.data[i + 1]; dst.data[i + 2] = src.data[i + 2]; }
    }
    gl.putImageData(dst, 0, 0);
  }
  if (extra.glow) Object.assign(opts, { emissiveMap: canvasTex(extra.glow, true), emissive: new THREE.Color('#ffffff'), emissiveIntensity: { obsidian: 1.5, void: 1.6, first: 1.2, molten: 1.6, lantern: 1.3, harvest: 1.5 }[style.finish] || { obsidian: 1.5, void: 1.6, molten: 1.6 }[style.overlay] || 1.1 });
  if (extra.metal) Object.assign(opts, { metalnessMap: canvasTex(extra.metal), metalness: 1, roughness: extra.rimOnlyMetal ? Math.min(fin.roughness, 0.4) : 0.4 });
  const mat = fin.material && fin.roughness <= 0.2 ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 1, clearcoatRoughness: 0.06 }) // gems and glassy stone
    : style.finish === 'pearl' ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 1, clearcoatRoughness: 0.15, iridescence: 0.7, iridescenceIOR: 1.6, sheen: 0.6, sheenColor: new THREE.Color(style.body2) })
    : style.finish === 'gloss' || style.finish === 'glass' ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 0.8, clearcoatRoughness: 0.1 })
    : new THREE.MeshStandardMaterial(opts);
  if (style.finish === 'metal') mat.envMapIntensity = 1.5;
  if (fin.material && fin.metalness >= 0.6) mat.envMapIntensity = { silver: 3, first: 2.6 }[style.finish] || 2; // bright metal: silver, gold, iron, dragonbone
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  if (fin.opacity) { mesh.userData.opacity = fin.opacity; setOpacity(mesh, 1); }
  return mesh;
}

/** A token as a chunky playing piece: its picture on top, its colour round the side. */
function tokenMesh(tok, t) {
  const geo = new THREE.CylinderGeometry(t.r, t.r, t.h, 40);
  geo.translate(0, -t.h * (TOP_HEAVY - 0.5), 0); // same weighting as the server's physics
  const side = new THREE.MeshStandardMaterial({ color: tok?.color || '#c0392b', roughness: 0.6 });
  const bottom = new THREE.MeshStandardMaterial({ color: '#202024', roughness: 0.8 });
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const paint = (im) => {
    g.save();
    // the cylinder's top is turned a quarter relative to the map; turn the picture to match
    g.translate(128, 128); g.rotate(-Math.PI / 2); g.translate(-128, -128);
    g.fillStyle = tok?.color || '#c0392b';
    g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    if (im) {
      g.save(); g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.clip();
      const k = Math.max(236 / im.naturalWidth, 236 / im.naturalHeight);
      g.drawImage(im, 128 - (im.naturalWidth * k) / 2, 128 - (im.naturalHeight * k) / 2, im.naturalWidth * k, im.naturalHeight * k);
      g.restore();
    } else {
      g.fillStyle = '#fff'; g.font = '600 92px "IBM Plex Sans", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText((tok?.label || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''), 128, 132);
    }
    g.restore();
    top.map.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  paint(null);
  if (tok?.image) { const im = new Image(); im.onload = () => paint(im); im.src = serverUrl(tok.image); }
  const mesh = new THREE.Mesh(geo, [side, top, bottom]);
  mesh.castShadow = true;
  return mesh;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const normalise = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------- previews: the Dice tab's (a d20 and a d6) and the dice designer's (the whole set) ----------
const previews = new Map(); // canvas → its renderer and dice
const SET_ROW = [['d4', 4, 'd'], ['d6', 6, 'd'], ['d8', 8, 'd'], ['d10', 10, 'd'], ['d100', 10, 'tens'], ['d12', 12, 'd'], ['d20', 20, 'd']];
/**
 * Show `style` spinning in `cv` (a canvas). Call again with a new style to repaint; it pauses while the canvas is
 * hidden. `{ set: true }` shows the whole set in a row, each die in its own look; `focus` ('d20'…) lifts one die.
 */
export async function previewDice(cv, style, { set = false, focus = null } = {}) {
  if (!THREE) THREE = await import('/three/three.module.js');
  let pv = previews.get(cv);
  if (!pv) {
    const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.environment = studio(r);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x30303a, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3, 4, 6);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 100);
    camera.position.set(0, 0, 7.5);
    pv = { cv, r, scene, camera, dice: [], t0: performance.now(), ticket: 0, set: false, focus: null };
    previews.set(cv, pv);
    const tick = () => {
      if (!cv.isConnected) { previews.delete(cv); r.dispose(); return; }
      requestAnimationFrame(tick);
      if (!cv.offsetParent) return; // hidden: don't spend anything
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * r.getPixelRatio()) || cv.height !== Math.round(h * r.getPixelRatio())) {
        r.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
        if (pv.set) camera.position.z = Math.max(6.4, 33 / camera.aspect);
      }
      const t = (performance.now() - pv.t0) / 1000;
      pv.dice.forEach((m, i) => {
        m.rotation.set(0.5 + Math.sin(t * 0.4 + i) * 0.35, t * (0.6 + (i % 3) * 0.15), 0.2);
        const lift = m.userData.slot === pv.focus ? 1 : 0;
        m.userData.lift = (m.userData.lift || 0) + (lift - (m.userData.lift || 0)) * 0.15;
        m.position.y = m.userData.y + m.userData.lift * 0.35;
        m.scale.setScalar(m.userData.size * (1 + m.userData.lift * 0.18));
      });
      r.render(pv.scene, camera);
    };
    requestAnimationFrame(tick);
  }
  pv.focus = focus;
  // only the latest change counts: quick changes (dragging a colour) mustn't pile dice up
  const ticket = ++pv.ticket;
  const row = set ? SET_ROW : [['d20', 20, 'd'], ['d6', 6, 'd']];
  const looks = row.map(([, sides, kind]) => styleFor(style, { sides, kind }));
  const pics = await Promise.all(looks.map((st) => picture(st.picture)));
  if (ticket !== pv.ticket) return;
  if (pv.set !== set) { pv.set = set; pv.cv.width = 0; } // makes the tick re-fit the camera
  for (const m of pv.dice) { pv.scene.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.emissiveMap?.dispose(); m.material.metalnessMap?.dispose(); m.material.dispose(); }
  pv.dice = row.map(([slot, sides, kind], i) => {
    const values = valuesFor(kind, sides);
    const top = kind === 'tens' ? 0 : sides;
    const m = dieMesh({ sides, kind, value: top, labels: values }, looks[i], pics[i]);
    const x = set ? (i - (row.length - 1) / 2) * 2.4 : [-1.2, 1.35][i];
    const size = set ? ({ 4: 1.1, 6: 0.95, 20: 1.2 }[sides] || 1.08) : sides === 6 ? 0.95 : 1.15;
    m.position.set(x, 0, 0);
    Object.assign(m.userData, { slot, y: 0, size });
    m.scale.setScalar(size);
    m.rotation.y = i;
    pv.scene.add(m);
    return m;
  });
}
