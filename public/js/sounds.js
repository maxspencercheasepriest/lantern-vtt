// Table sounds, made on the fly with Web Audio (no sound files): dice clattering for rolls and a pen
// scratching on paper for chat messages. Each player turns them on or off and sets the volume for themselves.
import { $, store } from './util.js';

const KEY = 'lantern.sounds';
let prefs = { on: true, volume: 0.6 };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* private window */ }
const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

let ctx = null;
let noise = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // one second of white noise, reused by every sound
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// browsers only allow sound after the player has interacted with the page
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (prefs.on) audio(); }, { once: true, capture: true });

const rand = (a, b) => a + Math.random() * (b - a);

/** A short filtered noise burst: the basic "click" of a die hitting the table or a pen stroke. */
function burst(c, out, t, { dur, freq, q, gain, type = 'bandpass', attack = 0.002, grain = null }) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let chain = src.connect(f).connect(g);
  if (grain) {
    // paper grain: wobble the level quickly so it rasps rather than hisses
    const wob = c.createGain();
    wob.gain.value = 1;
    const lfo = c.createOscillator();
    lfo.frequency.value = grain;
    const depth = c.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(wob.gain);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    chain = chain.connect(wob);
  }
  chain.connect(out);
  src.start(t, Math.random() * 0.5, dur + 0.05);
  return { f, g };
}
/** A tiny resonant knock, so the dice sound like hard plastic rather than static. */
function knock(c, out, t, freq, gain) {
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.05);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + 0.08);
}

let limiter = null;
function master(c) {
  if (!limiter) {
    // keeps a big handful of dice from clipping
    limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.1;
    limiter.connect(c.destination);
  }
  const g = c.createGain();
  g.gain.value = prefs.volume;
  g.connect(limiter);
  return g;
}

/** Dice tumbling across a table: a quick flurry of clacks that slows and fades, more dice = more clacks. */
export function playDice(count = 2) {
  const c = audio();
  if (!c) return;
  const out = master(c);
  const now = c.currentTime + 0.01;
  const dice = Math.max(1, Math.min(6, count));
  for (let d = 0; d < dice; d++) {
    let t = now + rand(0, 0.06);
    let gap = rand(0.035, 0.06);
    let level = rand(0.5, 0.8);
    const pitch = rand(1800, 3200);
    const hits = 5 + Math.floor(rand(0, 4));
    for (let i = 0; i < hits; i++) {
      burst(c, out, t, { dur: rand(0.02, 0.04), freq: pitch * rand(0.85, 1.2), q: rand(2, 5), gain: level * 0.6 });
      knock(c, out, t, pitch / rand(3.5, 5), level * 0.25);
      t += gap;
      gap *= rand(1.15, 1.4);   // bounces get further apart…
      level *= rand(0.65, 0.85); // …and quieter
    }
  }
  // a little table rumble under the clatter
  burst(c, out, now, { dur: 0.35, freq: 220, q: 0.7, gain: 0.12, type: 'lowpass', attack: 0.01 });
}

/** A pen scratching a few quick words onto paper. */
export function playPen() {
  const c = audio();
  if (!c) return;
  const out = master(c);
  let t = c.currentTime + 0.01;
  const strokes = 3 + Math.floor(rand(0, 3));
  for (let i = 0; i < strokes; i++) {
    const dur = rand(0.07, 0.16);
    const { f } = burst(c, out, t, { dur, freq: rand(2500, 4200), q: rand(0.8, 1.6), gain: rand(0.12, 0.2), attack: 0.015, grain: rand(35, 70) });
    // the nib's pitch drifts as it moves across the paper
    f.frequency.linearRampToValueAtTime(rand(2000, 5000), t + dur);
    t += dur + rand(0.03, 0.09);
  }
}

const diceIn = (m) => (m.result?.parts || []).reduce((a, p) => a + (p.dice?.length || 0), 0) || 2;

export function initSounds(socket) {
  socket.on('chat', (m) => {
    if (!prefs.on || document.hidden) return;
    if (m.kind === 'roll') {
      // your own physical dice already made a noise on the table
      if (m.from === store.me && m.source && m.source !== 'digital') return;
      playDice(diceIn(m));
    } else if (m.kind === 'text') {
      playPen();
    }
  });

  const btn = $('#sound-toggle');
  const vol = $('#sound-volume');
  const sync = () => {
    btn.textContent = prefs.on ? '🔊' : '🔇';
    btn.title = prefs.on ? 'Sounds on (click to mute)' : 'Sounds off (click to turn on)';
    btn.setAttribute('aria-pressed', String(prefs.on));
    vol.value = Math.round(prefs.volume * 100);
    vol.hidden = !prefs.on;
  };
  btn.onclick = () => { prefs.on = !prefs.on; savePrefs(); sync(); if (prefs.on) playDice(2); };
  vol.oninput = () => { prefs.volume = vol.value / 100; savePrefs(); };
  vol.onchange = () => playPen();
  sync();
}
