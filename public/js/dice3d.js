// 3D dice: plays back throws recorded by the server's physics, over the screen or on the map.
// The server has already rolled the numbers and painted each die so it lands on the right face, so every
// screen sees the same dice and the same result. Chat holds the roll card back until the dice stop.
import { store, call, toast, $ } from './util.js';
import { serverUrl } from './net.js';
import { dieShape, faceText, TOP_HEAVY } from '/shared/dice3d.js';
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
  for (const k of ['screen', 'table']) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x30303a, 1.4));
    layers[k] = { scene, camera: new THREE.PerspectiveCamera(FOV, 1, 1, 10000) };
  }
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

  const ink = inkFor(p.color);
  const bodies = p.dice.map((d) => { const m = dieMesh(d, p.color, ink); group.add(m); return m; });
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
      th.group.traverse((o) => { o.geometry?.dispose?.(); for (const mt of [].concat(o.material || [])) { mt.map?.dispose?.(); mt.dispose?.(); } });
      th.label?.remove();
      throws.delete(th);
    }
  }
}

function setOpacity(mesh, a) {
  for (const m of [].concat(mesh.material)) { m.transparent = a < 1; m.opacity = a; }
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
function inkFor(hex) {
  const n = parseInt(String(hex || '#e8a33d').slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#141418' : '#ffffff';
}

/** A die with its own numbers painted on: one texture, a square of it per face. */
function dieMesh(d, color, ink) {
  const shape = dieShape(d.sides);
  const n = shape.faces.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), cell = 128;
  const cv = document.createElement('canvas');
  cv.width = cols * cell; cv.height = rows * cell;
  const g = cv.getContext('2d');
  g.fillStyle = color || '#e8a33d';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = ink;
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
        g.font = `700 ${cell * 0.26}px "IBM Plex Sans", Arial, sans-serif`;
        g.fillText(faceText(d.kind, d.sides, d.labels[opp]), 0, 0);
        g.restore();
      }
    } else {
      const text = faceText(d.kind, d.sides, d.labels[k]);
      const size = { 6: 0.5, 8: 0.36, 10: 0.36, 12: 0.38, 20: 0.3 }[d.sides] * cell * (text.length > 1 ? 0.85 : 1);
      g.font = `700 ${size}px "IBM Plex Sans", Arial, sans-serif`;
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.05, flatShading: true }));
  mesh.castShadow = true;
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
