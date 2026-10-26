// The GM's audio player. The server holds what's playing (music, ambience layers) and sends its clock with
// every update; each client plays along at the right point, so late joiners hear the same bar of music.
// Sound goes through Web Audio so volumes work everywhere (iPhone and iPad Safari ignore <audio>.volume).
import { $, esc, store, call, toast, debounce } from './util.js';
import { serverUrl } from './net.js';

let socket;
let state = null;
let skew = 0; // server clock minus ours
const serverNow = () => Date.now() + skew;

// ---------- per-player volume ----------
const PREF_KEY = 'lantern.audio';
let prefs = { volume: 0.8, muted: false };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { /* private window */ }
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

// ---------- Web Audio graph ----------
let ctx = null;
let master = null;
function graph() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = prefs.muted ? 0 : prefs.volume;
  master.connect(ctx.destination);
  ctx.onstatechange = () => updateUnlock();
  return ctx;
}
const FADE = 0.8;

/** An <audio> element wired through its own gain node into the master volume. */
function makeVoice(url, { loop = false } = {}) {
  const el = new Audio();
  el.crossOrigin = 'anonymous'; // the Android app loads files from the GM's server, another origin
  el.preload = 'auto';
  el.loop = loop;
  el.src = serverUrl(url);
  const v = { el, url, gain: null, target: 0 };
  const c = graph();
  if (c) {
    v.gain = c.createGain();
    v.gain.gain.value = 0;
    c.createMediaElementSource(el).connect(v.gain).connect(master);
  }
  return v;
}
function setVoiceVolume(v, vol, fade = FADE) {
  v.target = vol;
  if (v.gain) {
    const g = v.gain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(vol, t + fade);
  } else {
    v.el.volume = Math.max(0, Math.min(1, vol * (prefs.muted ? 0 : prefs.volume)));
  }
}
function fadeOutAndDrop(v) {
  if (!v) return;
  setVoiceVolume(v, 0, FADE);
  setTimeout(() => { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); }, FADE * 1000 + 100);
}
let blocked = false;
function start(v) {
  const p = v.el.play();
  if (p?.catch) p.catch((e) => { if (e?.name === 'NotAllowedError') { blocked = true; updateUnlock(); } });
}

// ---------- music ----------
let music = null; // { el, url, id, ... }
const track = (id) => state?.tracks.find((t) => t.id === id) || null;

function musicPos() {
  const m = state.music;
  let pos = m.playing ? m.offset + (serverNow() - m.startedAt) / 1000 : m.offset;
  const t = track(m.trackId);
  const dur = t?.duration || (music?.el.duration > 0 && Number.isFinite(music.el.duration) ? music.el.duration : 0);
  if (m.repeat === 'one' && dur) pos %= dur;
  return Math.max(0, pos);
}

function syncMusic() {
  const m = state.music;
  const t = track(m.trackId);
  if (!t || !m.playing) {
    if (music && !music.el.paused) {
      const v = music;
      setVoiceVolume(v, 0, 0.4);
      setTimeout(() => { if (!state.music.playing || state.music.trackId !== v.id) v.el.pause(); }, 450);
    }
    if (music && music.id !== m.trackId) { fadeOutAndDrop(music); music = null; }
    return;
  }
  if (!music || music.id !== t.id) {
    fadeOutAndDrop(music);
    music = makeVoice(t.url);
    music.id = t.id;
    const v = music;
    v.el.addEventListener('loadedmetadata', () => {
      if (music !== v) return;
      if (store.isGM && !track(v.id)?.duration && Number.isFinite(v.el.duration)) {
        call(socket, 'audio:track', { id: v.id, duration: v.el.duration }).catch(() => {}); // lets the server move the playlist on
      }
      v.el.currentTime = Math.min(musicPos(), Math.max(0, v.el.duration - 0.25) || 0);
      start(v);
      setVoiceVolume(v, m.volume);
    }, { once: true });
    v.el.addEventListener('ended', () => { if (music === v) renderNowPlaying(); });
  } else {
    if (music.el.readyState >= 1) {
      const pos = musicPos();
      if (music.el.paused || Math.abs(music.el.currentTime - pos) > 1.5) music.el.currentTime = pos;
      if (music.el.paused) start(music);
      setVoiceVolume(music, m.volume, 0.3);
    }
  }
  music.el.loop = m.repeat === 'one';
}

// ---------- ambience ----------
const ambience = new Map(); // id -> voice
function syncAmbience() {
  const on = new Set(state.ambience.filter((id) => track(id)));
  for (const [id, v] of ambience) if (!on.has(id)) { fadeOutAndDrop(v); ambience.delete(id); }
  for (const id of on) {
    const t = track(id);
    let v = ambience.get(id);
    if (!v) {
      v = makeVoice(t.url, { loop: true });
      ambience.set(id, v);
      v.el.addEventListener('loadedmetadata', () => {
        // start each layer somewhere in the loop so stacked ambience doesn't all begin on the same beat
        if (v.el.duration > 4 && Number.isFinite(v.el.duration)) v.el.currentTime = Math.random() * v.el.duration;
      }, { once: true });
      start(v);
      setVoiceVolume(v, t.volume, 2);
    } else {
      if (v.el.paused) start(v);
      if (Math.abs(v.target - t.volume) > 0.001) setVoiceVolume(v, t.volume, 0.3);
    }
  }
}

// ---------- sound effects ----------
function playEffect({ url, volume }) {
  const v = makeVoice(url);
  setVoiceVolume(v, volume, 0.01);
  start(v);
  v.el.addEventListener('ended', () => { v.el.removeAttribute('src'); v.el.load(); }, { once: true });
}

// ---------- browsers that won't play until clicked ----------
function wantsSound() {
  return !!state && (state.music.playing || state.ambience.length > 0);
}
function updateUnlock() {
  const el = $('#audio-unlock');
  if (!el) return;
  el.hidden = !(wantsSound() && !prefs.muted && (blocked || ctx?.state === 'suspended'));
}
function unlock() {
  const c = graph();
  c?.resume?.().catch(() => {});
  blocked = false;
  if (state) { syncMusic(); syncAmbience(); }
  updateUnlock();
}

// ---------- panel ----------
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const REPEAT_LABEL = { all: ['🔁', 'Repeat the playlist'], one: ['🔂', 'Repeat this track'], off: ['➡️', 'Play the list once, then stop'] };
const NEXT_REPEAT = { all: 'one', one: 'off', off: 'all' };

function renderNowPlaying() {
  if (!state) return;
  const m = state.music;
  const t = track(m.trackId);
  const amb = state.ambience.map((id) => track(id)?.name).filter(Boolean);
  const bits = [];
  if (t && m.playing) bits.push(`♪ ${esc(t.name)}`);
  else if (t && m.offset > 0.5) bits.push(`<span class="muted">♪ ${esc(t.name)} (paused)</span>`);
  if (amb.length) bits.push(`<span class="muted">Ambience:</span> ${amb.map(esc).join(', ')}`);
  $('#audio-now').innerHTML = bits.length ? bits.join('<br>') : '<span class="muted">Nothing playing.</span>';
  const badge = $('#audio-badge');
  if (badge) badge.hidden = !(m.playing || state.ambience.length);
}

function renderProgress() {
  if (!state || !store.isGM) return;
  const m = state.music;
  const t = track(m.trackId);
  const bar = $('#audio-seek');
  if (!bar || bar.dataset.dragging) return;
  const dur = t?.duration || (music?.el.duration > 0 && Number.isFinite(music.el.duration) ? music.el.duration : 0);
  const pos = t ? musicPos() : 0;
  bar.max = Math.max(1, Math.round(dur));
  bar.value = Math.min(bar.max, Math.round(pos));
  bar.disabled = !t || !dur;
  $('#audio-time').textContent = t ? `${fmt(pos)} / ${dur ? fmt(dur) : '–:––'}` : '';
}

const sendVolume = new Map();
function volumeSender(id) {
  if (!sendVolume.has(id)) sendVolume.set(id, debounce((v) => call(socket, 'audio:track', { id, volume: v }).catch((e) => toast(e.message, true)), 150));
  return sendVolume.get(id);
}
const sendMusicVolume = debounce((v) => call(socket, 'audio:music', { action: 'volume', value: v }).catch((e) => toast(e.message, true)), 150);

function trackRow(t) {
  const m = state.music;
  const playingMusic = t.kind === 'music' && m.trackId === t.id;
  const ambOn = t.kind === 'ambience' && state.ambience.includes(t.id);
  const btn = t.kind === 'music'
    ? `<button class="iconbtn a-act" data-a="play" title="Play this track">${playingMusic && m.playing ? '🔊' : '▶'}</button>`
    : t.kind === 'ambience'
      ? `<button class="iconbtn a-act ${ambOn ? 'on' : ''}" data-a="amb" title="${ambOn ? 'Stop this loop' : 'Loop this'}" aria-pressed="${ambOn}">${ambOn ? '◼' : '∞'}</button>`
      : '<button class="iconbtn a-act" data-a="fx" title="Play for everyone">💥</button>';
  return `
    <li class="a-track ${playingMusic ? 'current' : ''} ${ambOn ? 'on' : ''}" data-id="${esc(t.id)}">
      ${btn}
      <input class="a-name" value="${esc(t.name)}" maxlength="80" aria-label="Track name">
      <span class="a-dur muted small">${t.duration ? fmt(t.duration) : ''}</span>
      <button class="iconbtn a-del" title="Delete">✕</button>
      ${t.kind === 'music' ? '' : `<input type="range" class="a-vol" min="0" max="100" value="${Math.round(t.volume * 100)}" aria-label="Volume for ${esc(t.name)}">`}
      <select class="a-kind small" aria-label="Kind">${['music', 'ambience', 'effect'].map((k) => `<option value="${k}" ${k === t.kind ? 'selected' : ''}>${k === 'effect' ? 'Sound effect' : k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
    </li>`;
}

function renderGM() {
  const box = $('#audio-gm');
  if (!store.isGM || !state) return;
  // don't rebuild while the GM is dragging a slider or typing a name
  if (box.contains(document.activeElement) && document.activeElement.matches('input, select')) { box.dataset.stale = '1'; return; }
  delete box.dataset.stale;
  const m = state.music;
  const lists = { music: [], ambience: [], effect: [] };
  for (const t of state.tracks) lists[t.kind]?.push(t);
  const [rIcon, rTitle] = REPEAT_LABEL[m.repeat] || REPEAT_LABEL.all;
  $('#audio-transport').innerHTML = `
    <div class="row a-buttons">
      <button class="iconbtn" data-m="prev" title="Previous">⏮</button>
      <button class="iconbtn big" data-m="${m.playing ? 'pause' : m.trackId ? 'resume' : 'first'}" title="${m.playing ? 'Pause' : 'Play'}">${m.playing ? '⏸' : '▶'}</button>
      <button class="iconbtn" data-m="next" title="Next">⏭</button>
      <button class="iconbtn" data-m="stop" title="Stop">⏹</button>
      <button class="iconbtn" data-m="repeat" title="${rTitle}">${rIcon}</button>
      <button class="iconbtn ${m.shuffle ? 'on' : ''}" data-m="shuffle" title="Shuffle" aria-pressed="${m.shuffle}">🔀</button>
      <input type="range" id="audio-music-vol" min="0" max="100" value="${Math.round(m.volume * 100)}" title="Music volume for everyone" aria-label="Music volume">
    </div>
    <div class="row"><input type="range" id="audio-seek" min="0" max="1" value="0" aria-label="Position"><span id="audio-time" class="muted small mono"></span></div>`;
  const list = (k, empty) => (lists[k].length ? lists[k].map(trackRow).join('') : `<li class="muted small">${empty}</li>`);
  $('#audio-music').innerHTML = list('music', 'Add some music: battle themes, tavern tunes, creeping dread.');
  $('#audio-ambience').innerHTML = list('ambience', 'Loops to layer up: rain, a crackling fire, wind, a crowd.');
  $('#audio-effects').innerHTML = list('effect', 'One-off sounds: a door slam, a scream, thunder.');
  renderProgress();
}

function render() {
  renderNowPlaying();
  renderGM();
  updateUnlock();
}

async function uploadAll(files, kind) {
  const status = $('#audio-upload-status');
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    // measure the length first, so the server can move the playlist on by itself
    const duration = await new Promise((resolve) => {
      const a = new Audio();
      const url = URL.createObjectURL(f);
      const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(a.duration);
      a.onerror = () => done(0);
      setTimeout(() => done(0), 8000);
      a.src = url;
    });
    await new Promise((resolve) => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('duration', String(duration || 0));
      fd.append('file', f);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', serverUrl('/api/audio'));
      xhr.setRequestHeader('x-upload-token', store.uploadToken);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) status.textContent = `Uploading ${i + 1} of ${list.length}: ${f.name} (${Math.round((e.loaded / e.total) * 100)}%)`; };
      xhr.onload = () => {
        if (xhr.status >= 400) {
          let msg = 'Upload failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* not JSON */ }
          toast(`${f.name}: ${msg}`, true);
        }
        resolve();
      };
      xhr.onerror = () => { toast(`${f.name}: upload failed`, true); resolve(); };
      xhr.send(fd);
    });
  }
  status.textContent = '';
}

function wireGM() {
  const box = $('#audio-gm');
  $('#audio-file').onchange = (e) => { const files = e.target.files; if (files.length) uploadAll(files, $('#audio-kind').value); e.target.value = ''; };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('.a-track');
    const id = row?.dataset.id;
    const err = (e2) => toast(e2.message, true);
    if (b.dataset.m) {
      const m = state.music;
      const a = b.dataset.m;
      if (a === 'first') { const first = state.tracks.find((t) => t.kind === 'music'); if (first) call(socket, 'audio:music', { action: 'play', id: first.id }).catch(err); return; }
      if (a === 'repeat') return void call(socket, 'audio:music', { action: 'repeat', value: NEXT_REPEAT[m.repeat] }).catch(err);
      if (a === 'shuffle') return void call(socket, 'audio:music', { action: 'shuffle', value: !m.shuffle }).catch(err);
      return void call(socket, 'audio:music', { action: a }).catch(err);
    }
    if (b.id === 'audio-stop-all') return void call(socket, 'audio:stop-all', {}).catch(err);
    if (!id) return;
    if (b.classList.contains('a-del')) {
      if (confirm(`Delete "${track(id)?.name}"?`)) call(socket, 'audio:delete', { id }).catch(err);
      return;
    }
    const act = b.dataset.a;
    if (act === 'play') {
      const m = state.music;
      if (m.trackId === id && m.playing) call(socket, 'audio:music', { action: 'pause' }).catch(err);
      else if (m.trackId === id) call(socket, 'audio:music', { action: 'resume' }).catch(err);
      else call(socket, 'audio:music', { action: 'play', id }).catch(err);
    }
    if (act === 'amb') call(socket, 'audio:ambience', { id, on: !state.ambience.includes(id) }).catch(err);
    if (act === 'fx') call(socket, 'audio:effect', { id }).catch(err);
  });
  box.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'audio-music-vol') { sendMusicVolume(el.value / 100); if (music) setVoiceVolume(music, el.value / 100, 0.1); }
    if (el.classList.contains('a-vol')) {
      const id = el.closest('.a-track').dataset.id;
      volumeSender(id)(el.value / 100);
      const v = ambience.get(id);
      if (v) setVoiceVolume(v, el.value / 100, 0.1);
    }
    if (el.id === 'audio-seek') { el.dataset.dragging = '1'; $('#audio-time').textContent = `${fmt(+el.value)} / ${fmt(+el.max)}`; }
  });
  box.addEventListener('change', (e) => {
    const el = e.target;
    const id = el.closest('.a-track')?.dataset.id;
    const err = (e2) => toast(e2.message, true);
    if (el.id === 'audio-seek') {
      delete el.dataset.dragging;
      call(socket, 'audio:music', { action: 'seek', at: +el.value }).catch(err);
    }
    if (el.classList.contains('a-name') && id) call(socket, 'audio:track', { id, name: el.value }).catch(err);
    if (el.classList.contains('a-kind') && id) call(socket, 'audio:track', { id, kind: el.value }).catch(err);
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('a-name')) e.target.blur(); });
  // re-render once the GM has finished with a control
  box.addEventListener('focusout', () => setTimeout(() => { if (box.dataset.stale && !box.contains(document.activeElement)) renderGM(); }, 0));
  // drop files straight onto the panel
  const panel = $('[data-panel="audio"]');
  panel.addEventListener('dragover', (e) => { if (store.isGM && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); panel.classList.add('drop'); } });
  panel.addEventListener('dragleave', () => panel.classList.remove('drop'));
  panel.addEventListener('drop', (e) => {
    panel.classList.remove('drop');
    if (!store.isGM || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    uploadAll([...e.dataTransfer.files].filter((f) => /^audio\//.test(f.type) || /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/i.test(f.name)), $('#audio-kind').value);
  });
}

export function initAudio(s) {
  socket = s;
  socket.on('audio', (a) => {
    skew = a.serverNow - Date.now();
    state = a;
    syncMusic();
    syncAmbience();
    render();
  });
  socket.on('audio:effect', (fx) => { if (!prefs.muted) playEffect(fx); });

  // my own volume
  const vol = $('#audio-my-vol');
  const mute = $('#audio-mute');
  const syncMine = () => {
    vol.value = Math.round(prefs.volume * 100);
    mute.textContent = prefs.muted ? '🔇' : '🔊';
    mute.title = prefs.muted ? 'Unmute the GM\'s audio' : 'Mute the GM\'s audio (just for you)';
    if (master) master.gain.setTargetAtTime(prefs.muted ? 0 : prefs.volume, ctx.currentTime, 0.05);
    for (const v of [music, ...ambience.values()]) if (v && !v.gain) setVoiceVolume(v, v.target, 0);
  };
  vol.oninput = () => { prefs.volume = vol.value / 100; if (prefs.muted && prefs.volume > 0) prefs.muted = false; savePrefs(); syncMine(); };
  mute.onclick = () => { prefs.muted = !prefs.muted; savePrefs(); syncMine(); unlock(); };
  syncMine();

  $('#audio-unlock').onclick = unlock;
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (blocked || ctx?.state === 'suspended') unlock(); }, { capture: true });
  wireGM();
  setInterval(renderProgress, 1000);
}
