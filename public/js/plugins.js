// Game plugins at the table (shared/plugin.js says what's in one; plugins.js on the server installs them). A
// plugin is a description, not code: its sheet is drawn here from its sections, its rolls go through Lantern's
// dice engine with its outcome table, its rules join the Rules tab, its stamps join the Draw tool, and its panels
// are sandboxed pages in Library ▸ Props. Library ▸ Plugins is where the GM adds them and turns them on.
import { $, esc, store, call, toast, openWindow, extButtons, runExt } from './util.js';
import { serverUrl } from './net.js';
import { registerSystem, unregisterSystem } from './systems.js';
import { RULESET_INFO, REFERENCES } from '/rules/references.js';
import { CARD_PLUGINS, CARD_SYSTEM_NAMES } from '/shared/cards.js';
import { defaultsFor, rowFor, rollFor, pluginCardFacts } from '/shared/plugin.js';
import { roll } from './rolls.js';

let socket;
let active = [];          // this campaign's plugins (from the server)
const registered = new Set();

const get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? a : a[k]), o);

export function initPlugins(s) {
  socket = s;
  socket.on('plugins', (list) => { apply(list || []); store.emit('plugins', active); renderSection(); });
  store.on('ext', (kind) => { if (kind === 'plugin') renderSection(); });
  $('#plugin-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) install(file);
  };
  const drop = $('.lib-sec[data-sec="plugins"]');
  drop.addEventListener('dragover', (e) => { if (store.isGM) { e.preventDefault(); drop.classList.add('drop'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop'));
  drop.addEventListener('drop', (e) => {
    drop.classList.remove('drop');
    const f = e.dataTransfer?.files?.[0];
    if (!f || !store.isGM) return;
    e.preventDefault();
    install(f);
  });
  $('#plugin-list').addEventListener('click', onListClick);
  $('#plugin-example').href = serverUrl('/api/plugins/example.zip');
}

/** The plugins in play: their rulesets, sheets, rules and cards. */
function apply(list) {
  for (const id of registered) { unregisterSystem(id); delete RULESET_INFO[id]; delete REFERENCES[id]; delete CARD_PLUGINS[id]; delete CARD_SYSTEM_NAMES[id]; }
  registered.clear();
  active = list;
  for (const p of list) {
    const id = p.ruleset || `p:${p.key}`;
    registered.add(id);
    RULESET_INFO[id] = { name: p.name, blurb: p.system?.about || p.about.slice(0, 140), plugin: p.key, rulesOnly: !p.system };
    if (p.rules.length) REFERENCES[id] = p.rules;
    if (p.system) {
      registerSystem(id, compile(p));
      CARD_PLUGINS[id] = (d) => pluginCardFacts(p.system, d);
      CARD_SYSTEM_NAMES[id] = p.name;
    }
  }
}

/** Quick rolls for the Dice tab, from every plugin in play: [{ name, run() }]. */
export function pluginQuickRolls() {
  return active.flatMap((p) => p.quickRolls.map((q) => ({
    name: q.name, plugin: p.name,
    run: () => {
      const r = q.roll ? p.rolls[q.roll] : { dice: q.dice, label: q.name, outcome: q.outcome };
      const x = rollFor(r, {}, { label: q.name });
      if (x.error) return toast(x.error, true);
      return roll(x.expr, { label: x.label, meta: r.outcome ? { outcome: r.outcome } : {} });
    },
  })));
}

/** Map stamps from every plugin in play: [{ name, shape, size, color }]. */
export const pluginStamps = () => active.flatMap((p) => p.stamps);

// ---------- a plugin's sheet ----------
const val = (d, path) => get(d, path) ?? '';
function control(f, path, d) {
  const v = val(d, path);
  if (f.type === 'number') return `<input type="number" data-bind="${esc(path)}" value="${esc(v)}" min="${f.min}" max="${f.max}">`;
  if (f.type === 'textarea') return `<textarea data-bind="${esc(path)}" rows="3">${esc(v)}</textarea>`;
  if (f.type === 'select') return `<select data-bind="${esc(path)}">${f.options.map((o) => `<option ${String(v) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (f.type === 'check') return `<input type="checkbox" data-bind="${esc(path)}" ${v ? 'checked' : ''}>`;
  if (f.type === 'track') {
    const n = Number(v) || 0;
    return `<span class="pl-track">${Array.from({ length: f.max }, (_, i) => `<button type="button" class="${i < n ? 'on' : ''}" data-set="${esc(path)}:${i + 1 === n ? i : i + 1}" title="${i + 1}"></button>`).join('')}</span>`;
  }
  return `<input data-bind="${esc(path)}" value="${esc(v)}">`;
}
const rollButton = (f, path) => (f.roll ? `<button class="rollbtn" data-roll="r:${esc(f.roll)}:${esc(path)}" title="Roll ${esc(f.label)}">🎲</button>` : '');
function fieldHtml(f, path, d) {
  if (f.type === 'check') return `<label class="check small pl-check">${control(f, path, d)} ${esc(f.label)}</label>`;
  return `<label class="f${f.wide ? ' wide' : ''}">${esc(f.label)}<span class="pl-in">${control(f, path, d)}${rollButton(f, path)}</span></label>`;
}

function compile(p) {
  const sys = p.system;
  const lists = sys.sections.filter((s) => s.list).map((s) => s.list);
  let lastData = {};
  const labelOf = (path) => {
    for (const s of sys.sections) {
      const f = (s.fields || []).find((x) => x.key === path);
      if (f) return f.label;
      if (s.list && path.startsWith(`${s.list.key}.`)) {
        const [i, k] = path.slice(s.list.key.length + 1).split('.'); // gear.0.uses → the row's name and the field
        const row = (get(lastData, s.list.key) || [])[i];
        const fl = s.list.fields.find((x) => x.key === k)?.label || k;
        return row?.name && k !== 'name' ? `${row.name} (${fl})` : fl;
      }
    }
    return '';
  };
  return {
    id: p.ruleset, name: p.name, plugin: p.key,
    defaults: () => defaultsFor(sys),
    rows: Object.fromEntries(lists.map((l) => [l.key, () => rowFor(l)])),
    bar: sys.hp ? (d) => ({ cur: Number(get(d, sys.hp.cur)) || 0, max: Number(get(d, sys.hp.max)) || 0 }) : undefined,
    initMod: (d) => (sys.init.mod ? Number(get(d, sys.init.mod)) || 0 : 0),
    render(d) {
      for (const l of lists) if (!Array.isArray(get(d, l.key))) { /* an older sheet: start the list */ const ks = l.key.split('.'); let x = d; for (const k of ks.slice(0, -1)) x = x[k] ||= {}; x[ks.at(-1)] = []; }
      const portrait = `<div class="portrait" data-portrait style="${d.portrait ? `background-image:url('${esc(serverUrl(d.portrait))}')` : ''}">${d.portrait ? '' : 'Add<br>portrait'}</div>`;
      // health goes up by the name unless a section already has it
      const inSections = sys.hp && sys.sections.some((x) => (x.fields || []).some((f) => f.key === sys.hp.cur));
      const hp = sys.hp && !inSections ? `${fieldHtml({ label: 'Health', type: 'number', min: 0, max: 9999 }, sys.hp.cur, d)}${fieldHtml({ label: 'Most', type: 'number', min: 0, max: 9999 }, sys.hp.max, d)}` : '';
      return `
      <div class="hdr">${portrait}
        <div class="fields">
          <label class="f">Name<input data-bind="name" value="${esc(d.name ?? '')}" class="name-input"></label>
          ${hp}
        </div>
      </div>
      ${sys.sections.map((s) => {
        if (s.list) {
          const rows = get(d, s.list.key) || [];
          return `<fieldset><legend>${esc(s.title || s.list.label)}</legend>
            <div class="list">${rows.map((row, i) => `<div class="li pl-row" style="grid-template-columns:${s.list.fields.map((f) => (f.type === 'track' ? 'auto' : f.type === 'number' || f.type === 'check' ? '64px' : '1fr')).join(' ')} 24px">
              ${s.list.fields.map((f) => `<span class="pl-in">${control(f, `${s.list.key}.${i}.${f.key}`, d)}${rollButton(f, `${s.list.key}.${i}.${f.key}`)}</span>`).join('')}
              <button class="del" data-del="${esc(s.list.key)}:${i}" title="Remove">✕</button></div>`).join('')}</div>
            <button class="add" data-add="${esc(s.list.key)}">+ ${esc(s.list.label)}</button>
          </fieldset>`;
        }
        return `<fieldset><legend>${esc(s.title)}</legend>
          <div class="pl-grid" style="--cols:${s.columns}">${s.fields.map((f) => fieldHtml(f, f.key, d)).join('')}</div>
          ${s.rolls.length ? `<div class="pl-rolls">${s.rolls.map((r) => `<button class="btn small-btn" data-roll="r:${esc(r.roll)}:@${esc(r.label)}">🎲 ${esc(r.label)}</button>`).join('')}</div>` : ''}
        </fieldset>`;
      }).join('')}
      <p class="muted small">${esc(p.name)} · a plugin${p.author ? ` by ${esc(p.author)}` : ''}</p>`;
    },
    roll(kind, arg, d) {
      if (kind !== 'r') return null;
      lastData = d;
      const at = String(arg).indexOf(':');
      const id = at < 0 ? String(arg) : String(arg).slice(0, at), where = at < 0 ? '' : String(arg).slice(at + 1);
      const r = p.rolls[id];
      const label = where.startsWith('@') ? where.slice(1) : labelOf(where) || id;
      const value = where && !where.startsWith('@') ? get(d, where) : 0;
      const x = rollFor(r, d, { value, label });
      if (x.error) return x;
      return { expr: x.expr, label: x.label, meta: r.outcome ? { outcome: r.outcome } : {} };
    },
  };
}

// ---------- Library ▸ Plugins ----------
async function install(file) {
  if (!/\.zip$/i.test(file.name)) return toast('A plugin is a .zip with a plugin.json inside', true);
  const fd = new FormData();
  fd.append('file', file);
  toast('Adding the plugin…');
  try {
    const res = await fetch(serverUrl('/api/plugins'), { method: 'POST', body: fd, headers: { 'x-upload-token': store.uploadToken } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "That plugin didn't install");
    toast(`${data.name} is on for this campaign`);
    renderSection();
  } catch (e) { toast(e.message, true); }
}

const hasLine = (h) => [h.system && 'a character sheet and ruleset', h.rolls && `${h.rolls} roll${h.rolls === 1 ? '' : 's'}`, h.rules && `${h.rules} rules page${h.rules === 1 ? '' : 's'}`, h.stamps && `${h.stamps} map stamp${h.stamps === 1 ? '' : 's'}`, h.panels && `${h.panels} panel${h.panels === 1 ? '' : 's'}`].filter(Boolean).join(', ');

let installed = [];
export async function renderSection() {
  const box = $('#plugin-list');
  if (!box) return;
  $('#plugin-gm').hidden = !store.isGM;
  if (!store.isGM) {
    box.innerHTML = active.length ? active.map((p) => `<div class="pl-item on"><div><b>${esc(p.name)}</b> <span class="muted small">${esc(p.version)}${p.author ? ` · ${esc(p.author)}` : ''}</span><p class="small">${esc(p.about)}</p></div></div>`).join('')
      : '<p class="muted">No plugins in this campaign. The GM can add them here.</p>';
    return;
  }
  try { installed = (await call(socket, 'plugins:list', {})).plugins; } catch (e) { box.innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
  box.innerHTML = installed.length ? installed.map((p) => `<div class="pl-item${p.on ? ' on' : ''}" data-key="${p.key}">
      <div class="grow"><b>${esc(p.name)}</b> <span class="muted small">${esc(p.version)}${p.author ? ` · by ${esc(p.author)}` : ''}</span>
        <p class="small">${esc(p.about)}</p>
        <p class="muted small">Adds ${esc(hasLine(p.has) || 'nothing yet')}.${p.licence ? ` Licence: ${esc(p.licence)}.` : ''}</p></div>
      <div class="pl-acts">
        <label class="check small"><input type="checkbox" data-on ${p.on ? 'checked' : ''}> On in this campaign</label>
        ${p.on && p.has.system && store.settings?.ruleset !== `p:${p.key}` ? '<button class="btn small-btn" data-play>Play this game</button>' : ''}
        <a class="btn ghost small-btn" href="${serverUrl(`/api/plugins/${p.key}.zip?t=${encodeURIComponent(store.uploadToken || '')}`)}" download>Download</a>
        ${extButtons('plugin', { plugin: p }, 'btn ghost small-btn')}
        <button class="btn ghost small-btn danger" data-remove>Remove</button>
      </div></div>`).join('')
    : '<p class="muted">No plugins on this server yet. Add one above, or start from the example.</p>';
}

async function onListClick(e) {
  const item = e.target.closest('[data-key]');
  if (!item) return;
  const key = item.dataset.key;
  const p = installed.find((x) => x.key === key);
  const x = e.target.closest('[data-ext]');
  if (x) return runExt(x, { plugin: p }); // an add-on's button (Lantern Plus: Publish…)
  try {
    if (e.target.matches('[data-on]')) {
      await call(socket, 'plugins:enable', { key, on: e.target.checked });
      toast(e.target.checked ? `${p.name} is on` : `${p.name} is off`);
    } else if (e.target.closest('[data-play]')) {
      await call(socket, 'settings:update', { ruleset: `p:${key}` });
      toast(`This campaign plays ${p.name} now`);
    } else if (e.target.closest('[data-remove]')) {
      if (!confirm(`Remove ${p.name} from this server? Sheets made with it keep their numbers, but can't be drawn without it.`)) return;
      await call(socket, 'plugins:remove', { key });
      toast(`${p.name} removed`);
    } else return;
  } catch (er) { toast(er.message, true); if (e.target.matches('[data-on]')) e.target.checked = !e.target.checked; }
  renderSection();
}

/** How to make a plugin, in a window (the GM's ? in Library ▸ Plugins). */
export function openPluginHelp() {
  const w = openWindow('plugin-help', { title: 'Making a plugin', width: 620, height: 680 });
  w.body.innerHTML = `<div class="pl-help">
    <p>A plugin is a folder with a <code>plugin.json</code> in it, zipped. It describes a game; Lantern does the rest, so a plugin can't break the table or reach anyone's computer. The quickest start is to download the example, change it and zip it again.</p>
    <h3>What a plugin can add</h3>
    <ul>
      <li><b>A character sheet and ruleset</b> (<code>system</code>): sections of fields (text, number, list, tick box, a track of boxes, a long text) and lists of rows. Pick the game in the Scene tab once it's on.</li>
      <li><b>Dice mechanics</b> (<code>rolls</code>): dice in Lantern's notation with <code>{value}</code> for the number in the field the 🎲 is by, and an <b>outcome</b> table that names the result (<i>It works, at a cost</i>) — even a critical when enough dice show the same face.</li>
      <li><b>Quick rolls</b> for the Dice tab, <b>rules pages</b> in Markdown for the Rules tab, and <b>map stamps</b> (circle, square, cone and line, sized in squares) for the Draw tool.</li>
      <li><b>Panels</b>: your own HTML pages, sealed off like props, with the campaign's shared storage and <code>window.lantern</code> to roll dice and post in chat. Find them in Library ▸ Props.</li>
    </ul>
    <h3>Good to know</h3>
    <ul>
      <li>Each installed version stays as it was. A new version installs alongside the old: turn it on and press <b>Play this game</b>, and the campaign's sheets move over to it.</li>
      <li>Only put in what you have the right to share — your own words, or openly licensed rules (and say so in <code>licence</code>).</li>
    </ul>
  </div>`;
}
