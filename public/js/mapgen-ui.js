// The battlemap generator window (Scene bar → Generate), and the building alarm everyone hears.
import { $, store, call, toast, uploadImage, openWindow, esc } from './util.js';
import { MAP_KINDS, MAP_SIZES, generateMap } from '/shared/mapgen.js';
import { drawMap } from './mapgen-draw.js';
import { playSiren } from './sounds.js';

let socket;
const P = 70; // pixels per square in the saved map

export function initMapgen(s) {
  socket = s;
  // a hacked or tripped alarm on a generated map: red pulse and a siren for everyone on that scene
  socket.on('alarm', (a) => {
    toast(`ALARM: ${a.name}${store.isGM ? ` (${a.scene})` : ''}`, true);
    playSiren(4);
    const el = document.createElement('div');
    el.className = 'alarm-flash';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  });
}

export function openGenerator() {
  const w = openWindow('mapgen', { title: 'Generate a battlemap', width: 560, height: 680 });
  if (w.existed) return;
  const st = { kind: 'office', size: 'medium', seed: newSeed(), layout: null };
  const interiors = Object.entries(MAP_KINDS).filter(([, v]) => v.interior);
  const exteriors = Object.entries(MAP_KINDS).filter(([, v]) => !v.interior);
  const chips = (list) => list.map(([k, v]) => `<button class="chip" data-kind="${k}">${esc(v.label)}</button>`).join('');
  w.body.innerHTML = `
    <div class="mapgen">
      <div class="mg-row"><b>Inside</b><div class="chips">${chips(interiors)}</div></div>
      <div class="mg-row"><b>Outside</b><div class="chips">${chips(exteriors)}</div></div>
      <div class="mg-row"><b>Size</b><div class="chips">${Object.keys(MAP_SIZES).map((k) => `<button class="chip" data-size="${k}">${k[0].toUpperCase() + k.slice(1)} <small>${MAP_SIZES[k][0]}×${MAP_SIZES[k][1]}</small></button>`).join('')}</div></div>
      <div class="mg-preview"><canvas></canvas><div class="mg-title"></div></div>
      <div class="mg-row mg-actions"><button class="btn ghost" data-act="reroll">↻ Another one</button><span class="muted small mg-count"></span></div>
      <label class="check"><input type="checkbox" data-opt="fog"> Line-of-sight fog (walls block what players see)</label>
      <label class="check"><input type="checkbox" data-opt="security" checked> Wire it up for netrunning: the Thaw security console gets this building's doors, cameras, alarm and turrets</label>
      <label class="mg-name">Scene name <input data-opt="name" maxlength="60"></label>
      <button class="btn" data-act="make">Make the scene</button>
      <p class="muted small">Dots on the preview are security (only you see them): <span style="color:#4cf2ff">cameras</span>, <span style="color:#ffb43b">locks</span>, <span style="color:#ff3b3b">alarm</span>, <span style="color:#ff3bd4">turrets</span>.</p>
    </div>`;
  const body = w.body;
  const render = () => {
    st.layout = generateMap(st);
    body.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === st.kind));
    body.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', b.dataset.size === st.size));
    const big = drawMap(st.layout, 24, { devices: true });
    const c = body.querySelector('.mg-preview canvas');
    c.width = big.width; c.height = big.height;
    c.getContext('2d').drawImage(big, 0, 0);
    body.querySelector('.mg-title').textContent = st.layout.title;
    const devs = st.layout.devices.length, doors = st.layout.walls.filter((x) => x.kind === 'door').length;
    body.querySelector('.mg-count').textContent = `${st.layout.rooms.length ? `${st.layout.rooms.length} rooms · ` : ''}${doors} doors · ${devs} security systems`;
    body.querySelector('[data-opt="name"]').value = st.layout.title;
    body.querySelector('[data-opt="fog"]').checked = MAP_KINDS[st.kind].interior;
    body.querySelector('[data-opt="security"]').closest('label').hidden = !devs;
  };
  body.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { st.kind = b.dataset.kind; st.seed = newSeed(); render(); }));
  body.querySelectorAll('[data-size]').forEach((b) => (b.onclick = () => { st.size = b.dataset.size; render(); }));
  body.querySelector('[data-act="reroll"]').onclick = () => { st.seed = newSeed(); render(); };
  body.querySelector('[data-act="make"]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Drawing the map…';
    try {
      const id = await makeScene(st.layout, {
        name: body.querySelector('[data-opt="name"]').value.trim() || st.layout.title,
        fog: body.querySelector('[data-opt="fog"]').checked,
        security: body.querySelector('[data-opt="security"]').checked && st.layout.devices.length > 0,
      });
      toast('Scene made. Double-click it in the scene bar when you want everyone there.');
      w.close();
      return id;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = 'Make the scene';
    }
  };
  render();
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Draw the layout full size, upload it, and build the scene with its walls and devices. */
export async function makeScene(L, { name, fog, security }) {
  const canvas = drawMap(L, P);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.9));
  const type = blob.type || 'image/png'; // Safari can't make webp and hands back a png
  const file = new File([blob], `${L.kind}-${L.seed}.${type.split('/')[1]}`, { type });
  const url = await uploadImage(file);
  const px = (p) => [Math.round(p[0] * P), Math.round(p[1] * P)];
  const res = await call(socket, 'scene:build', {
    name, title: L.title,
    map: { image: url, width: canvas.width, height: canvas.height, gridSize: P },
    walls: L.walls.map((w) => ({ a: px(w.a), b: px(w.b), kind: w.kind, locked: !!w.locked, name: w.name })),
    devices: L.devices.map((d) => ({
      type: d.type, name: d.name, room: d.room, door: d.door, dir: d.dir,
      // turrets are tokens, placed by their top-left corner; everything else by its centre
      x: Math.round(d.x * P), y: Math.round(d.y * P),
    })),
    rooms: L.rooms.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h })),
    fog: fog ? 'sight' : 'off',
    security,
  });
  return res.id;
}
