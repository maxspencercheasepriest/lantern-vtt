// Video and voice for everyone at the table: a WebRTC mesh (every participant connects to every other),
// set up through Lantern's server. Audio and video go directly between players, not through the server.
import { $, esc, store, call, toast } from './util.js';

let socket;
let myId = null;
let iceServers = [];
let relayMode = 'free'; // the GM's video relay setting, from av:join
let local = null; // MediaStream
const peers = new Map(); // id -> { pc, name, color, stream, polite, makingOffer, ignoreOffer, state, tile }
const prefs = loadPrefs();
let audioCtx = null;

function loadPrefs() {
  try { return { size: 'm', dock: 'right', mic: '', cam: '', ...JSON.parse(localStorage.getItem('lantern.video') || '{}') }; } catch { return { size: 'm', dock: 'right' }; }
}
const savePrefs = () => { try { localStorage.setItem('lantern.video', JSON.stringify(prefs)); } catch {} };
export const inCall = () => !!myId;

export function initVideo(s) {
  socket = s;
  $('#av-join').onclick = () => (inCall() ? leave() : join());
  // someone joined after us: they send the opening offer, we answer it
  socket.on('av:peer-joined', (p) => { if (inCall() && p.id !== myId) connect(p, false); });
  socket.on('av:peer-left', ({ id }) => drop(id));
  socket.on('av:state', ({ id, audio, video }) => { const p = peers.get(id); if (p) { p.state = { audio, video }; drawTile(id); } });
  socket.on('av:signal', ({ from, data }) => onSignal(from, data).catch((e) => console.warn('video signal', e)));
  // the server forgets us when the socket drops; rejoin the call after a reconnect
  store.on('joined', () => { if (local && myId) { const keep = local; myId = null; for (const id of [...peers.keys()]) drop(id); join(keep); } });
  renderDock();
}

function mediaProblem() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return window.isSecureContext ? "This browser can't use a camera." : 'Video needs HTTPS (or the Lantern desktop app) — the browser blocks cameras on plain http pages.';
  }
  return null;
}

async function getMedia() {
  const video = { ...(prefs.cam ? { deviceId: { exact: prefs.cam } } : {}), width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };
  const audio = { ...(prefs.mic ? { deviceId: { exact: prefs.mic } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try { return await navigator.mediaDevices.getUserMedia({ video, audio }); } catch (e) {
    // no camera (or it's busy)? join with the microphone only
    try { const s = await navigator.mediaDevices.getUserMedia({ audio }); toast('No camera available — joined with sound only'); return s; } catch { throw e; }
  }
}

export async function join(reuse) {
  const problem = mediaProblem();
  if (problem) return toast(problem, true);
  try {
    local = reuse || (await getMedia());
  } catch (e) {
    return toast(e.name === 'NotAllowedError' ? 'Camera/microphone permission was refused. Allow it in your browser or system settings and try again.' : `Couldn't start the camera: ${e.message}`, true);
  }
  watchLevel(local, 'me');
  const hasVideo = local.getVideoTracks().length > 0;
  try {
    const r = await call(socket, 'av:join', { audio: true, video: hasVideo });
    myId = r.id;
    iceServers = r.iceServers || [];
    relayMode = r.relay || 'off';
    for (const p of r.peers) connect(p, true); // we're the newcomer: we make the opening offers
  } catch (e) {
    stopLocal();
    return toast(e.message, true);
  }
  prefs.camOff = prefs.camOff && hasVideo; prefs.micOff = !!prefs.micOff;
  applyLocalToggles();
  renderDock();
}

export async function leave() {
  await call(socket, 'av:leave', {}).catch(() => {});
  for (const id of [...peers.keys()]) drop(id);
  myId = null;
  stopLocal();
  renderDock();
}

function stopLocal() {
  local?.getTracks().forEach((t) => t.stop());
  local = null;
  levels.delete('me');
}

// ---------- connections ----------
// The newcomer makes the opening offer; the person already in the call adds their camera and mic while
// answering it, so the two never offer at once. Later changes use the "perfect negotiation" pattern,
// where either side may offer and the polite one gives way if they collide.
function connect(info, initiator) {
  if (peers.has(info.id)) return peers.get(info.id);
  const pc = new RTCPeerConnection({ iceServers });
  const p = { pc, name: info.name, color: info.color, stream: new MediaStream(), polite: myId > info.id, makingOffer: false, ignoreOffer: false, needTracks: !initiator, state: { audio: info.audio !== false, video: !!info.video }, since: Date.now(), retries: 0 };
  peers.set(info.id, p);
  const send = (data) => socket.emit('av:signal', { to: info.id, data });
  if (initiator) for (const t of local.getTracks()) pc.addTrack(t, local);
  pc.onnegotiationneeded = async () => {
    try { p.makingOffer = true; await pc.setLocalDescription(); send({ description: pc.localDescription }); }
    catch (e) { console.warn(e); } finally { p.makingOffer = false; }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) send({ candidate }); };
  pc.ontrack = ({ track }) => {
    p.stream.addTrack(track);
    if (track.kind === 'audio') watchLevel(p.stream, info.id);
    drawTile(info.id, true);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { p.since = null; p.retries = 0; }
    else if (!p.since) p.since = Date.now();
    if (pc.connectionState === 'failed') {
      p.retries++;
      pc.restartIce();
      if (p.retries === 1) toast(`Video link to ${info.name} dropped — retrying`, true);
      if (p.retries === 2) toast(stuckHint(info.name), true);
    }
    drawTile(info.id);
  };
  renderDock();
  return p;
}

async function onSignal(from, { description, candidate }) {
  if (!local || !myId) return;
  const p = peers.get(from) || connect({ id: from, name: '…', color: '#666' }, false);
  const { pc } = p;
  if (description) {
    const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
    p.ignoreOffer = !p.polite && collision;
    if (p.ignoreOffer) return;
    await pc.setRemoteDescription(description);
    if (p.needTracks) {
      // answering the opening offer: send our camera and mic back on the same connection
      p.needTracks = false;
      for (const t of local.getTracks()) pc.addTrack(t, local);
    }
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      socket.emit('av:signal', { to: from, data: { description: pc.localDescription } });
    }
  } else if (candidate) {
    try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
  }
}

function drop(id) {
  const p = peers.get(id);
  if (!p) return;
  p.pc.close();
  peers.delete(id);
  levels.delete(id);
  renderDock();
}

// ---------- local controls ----------
function applyLocalToggles() {
  if (!local) return;
  local.getAudioTracks().forEach((t) => { t.enabled = !prefs.micOff; });
  local.getVideoTracks().forEach((t) => { t.enabled = !prefs.camOff; });
  socket.emit('av:state', { audio: !prefs.micOff, video: local.getVideoTracks().length > 0 && !prefs.camOff });
  savePrefs();
  renderDock();
}

async function switchDevice(kind, deviceId) {
  prefs[kind] = deviceId;
  savePrefs();
  if (!local) return;
  try {
    const constraints = kind === 'cam' ? { video: { deviceId: { exact: deviceId } } } : { audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true } };
    const fresh = await navigator.mediaDevices.getUserMedia(constraints);
    const track = kind === 'cam' ? fresh.getVideoTracks()[0] : fresh.getAudioTracks()[0];
    const old = kind === 'cam' ? local.getVideoTracks()[0] : local.getAudioTracks()[0];
    if (old) { local.removeTrack(old); old.stop(); }
    local.addTrack(track);
    for (const p of peers.values()) {
      const sender = p.pc.getSenders().find((x) => x.track?.kind === track.kind) || p.pc.getSenders().find((x) => !x.track);
      if (sender) await sender.replaceTrack(track);
      else p.pc.addTrack(track, local);
    }
    if (kind === 'mic') watchLevel(local, 'me');
    applyLocalToggles();
  } catch (e) { toast(`Couldn't switch: ${e.message}`, true); }
}

// ---------- speaking indicator ----------
const levels = new Map(); // id -> { analyser, data }
function watchLevel(stream, id) {
  try {
    if (!stream.getAudioTracks().length) return;
    audioCtx ||= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const src = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    levels.set(id, { analyser, data: new Uint8Array(analyser.fftSize) });
    tickLevels();
  } catch { /* no indicator then */ }
}
let ticking = false;
function tickLevels() {
  if (ticking) return;
  ticking = true;
  const loop = () => {
    if (!levels.size) { ticking = false; return; }
    for (const [id, l] of levels) {
      l.analyser.getByteTimeDomainData(l.data);
      let sum = 0;
      for (const v of l.data) sum += (v - 128) ** 2;
      const loud = Math.sqrt(sum / l.data.length) > 6;
      const muted = id === 'me' ? prefs.micOff : peers.get(id)?.state.audio === false;
      document.querySelector(`.vtile[data-id="${id}"]`)?.classList.toggle('speaking', loud && !muted);
    }
    setTimeout(() => requestAnimationFrame(loop), 120);
  };
  loop();
}

// ---------- the dock ----------
function renderDock() {
  const btn = $('#av-join');
  btn.classList.toggle('on', inCall());
  btn.textContent = inCall() ? 'Leave video' : 'Join video';
  const dock = $('#video-dock');
  if (!inCall()) { dock.hidden = true; dock.innerHTML = ''; return; }
  dock.hidden = false;
  dock.className = `video-dock size-${prefs.size} dock-${prefs.dock}${prefs.collapsed ? ' collapsed' : ''}`;
  if (!dock.querySelector('.vbar')) {
    dock.innerHTML = `<div class="vbar">
        <button data-v="mic" title="Mute / unmute (Ctrl+D)"></button>
        <button data-v="cam" title="Camera on / off (Ctrl+E)"></button>
        <button data-v="devices" title="Choose camera and microphone">⚙</button>
        <button data-v="size" title="Tile size">⤢</button>
        <button data-v="dock" title="Move to the side / bottom">⇆</button>
        <button data-v="collapse" title="Hide the videos"></button>
        <button data-v="leave" class="leave" title="Leave the call">Leave</button>
      </div><div class="vdev" hidden></div><div class="vtiles"></div>`;
    dock.querySelector('.vbar').onclick = onBar;
  }
  const bar = dock.querySelector('.vbar');
  const hasCam = !!local?.getVideoTracks().length;
  bar.querySelector('[data-v=mic]').textContent = prefs.micOff ? '🔇' : '🎤';
  bar.querySelector('[data-v=mic]').classList.toggle('off', !!prefs.micOff);
  bar.querySelector('[data-v=cam]').textContent = hasCam ? (prefs.camOff ? '📷̸' : '📷') : '—';
  bar.querySelector('[data-v=cam]').classList.toggle('off', !hasCam || !!prefs.camOff);
  bar.querySelector('[data-v=collapse]').textContent = prefs.collapsed ? '▸' : '▾';
  const tiles = dock.querySelector('.vtiles');
  const ids = ['me', ...peers.keys()];
  for (const el of [...tiles.children]) if (!ids.includes(el.dataset.id)) el.remove();
  for (const id of ids) drawTile(id);
}

function drawTile(id, newTrack) {
  const tiles = document.querySelector('#video-dock .vtiles');
  if (!tiles) return;
  const me = id === 'me';
  const p = me ? null : peers.get(id);
  if (!me && !p) return;
  let tile = tiles.querySelector(`.vtile[data-id="${id}"]`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'vtile';
    tile.dataset.id = id;
    tile.innerHTML = '<video autoplay playsinline></video><div class="vavatar"></div><div class="vname"></div>';
    tile.onclick = () => tile.classList.toggle('pinned');
    tiles.append(tile);
  }
  const video = tile.querySelector('video');
  const stream = me ? local : p.stream;
  if (video.srcObject !== stream || newTrack) { video.srcObject = stream; video.play?.().catch(() => {}); }
  video.muted = me; // never play yourself back
  tile.classList.toggle('me', me);
  const name = me ? `${store.me} (you)` : p.name;
  const color = me ? store.color : p.color;
  const camOn = me ? !!local?.getVideoTracks().length && !prefs.camOff : p.state.video !== false && p.stream.getVideoTracks().length > 0;
  const micOn = me ? !prefs.micOff : p.state.audio !== false;
  tile.classList.toggle('nocam', !camOn);
  const av = tile.querySelector('.vavatar');
  av.textContent = (name || '?').trim()[0]?.toUpperCase() || '?';
  av.style.background = color || '#555';
  const st = !me && p.pc.connectionState;
  const stuck = st && st !== 'connected' && p.since && Date.now() - p.since > 15000;
  tile.querySelector('.vname').innerHTML = `${micOn ? '' : '<span title="Muted">🔇</span> '}${esc(name)}${st && !['connected', 'new'].includes(st) ? ` <small title="${stuck ? esc(stuckHint(name)) : ''}">${stuck ? "can't connect" : esc(st)}</small>` : ''}`;
  tile.classList.toggle('stuck', !!stuck);
}

/** What to try when two people's video won't link up. */
function stuckHint(name) {
  return relayMode === 'off'
    ? `Video to ${name} can't get through — one of you is probably on mobile data or a strict network. The GM can turn on the video relay in the Scene tab, then you both Leave and Join video again.`
    : `Video to ${name} still can't get through, even with the relay. Try Leave and Join video again, or switch one of you from mobile data to Wi-Fi.`;
}
// keep "connecting…" labels honest while links are trying
setInterval(() => { for (const [id, p] of peers) if (p.pc.connectionState !== 'connected') drawTile(id); }, 3000);

async function onBar(e) {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  const v = b.dataset.v;
  if (v === 'mic') { prefs.micOff = !prefs.micOff; applyLocalToggles(); }
  if (v === 'cam') { if (local?.getVideoTracks().length) { prefs.camOff = !prefs.camOff; applyLocalToggles(); } else toast('No camera in this call', true); }
  if (v === 'size') { prefs.size = { s: 'm', m: 'l', l: 's' }[prefs.size] || 'm'; savePrefs(); renderDock(); }
  if (v === 'dock') { prefs.dock = prefs.dock === 'right' ? 'bottom' : 'right'; savePrefs(); renderDock(); }
  if (v === 'collapse') { prefs.collapsed = !prefs.collapsed; savePrefs(); renderDock(); }
  if (v === 'leave') leave();
  if (v === 'devices') {
    const box = $('#video-dock .vdev');
    if (!box.hidden) { box.hidden = true; return; }
    const devs = await navigator.mediaDevices.enumerateDevices();
    const opts = (kind, cur) => devs.filter((d) => d.kind === kind).map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`)}</option>`).join('');
    const curCam = local?.getVideoTracks()[0]?.getSettings().deviceId || prefs.cam;
    const curMic = local?.getAudioTracks()[0]?.getSettings().deviceId || prefs.mic;
    box.innerHTML = `<label>Camera <select data-kind="cam">${opts('videoinput', curCam) || '<option>None found</option>'}</select></label>
      <label>Microphone <select data-kind="mic">${opts('audioinput', curMic) || '<option>None found</option>'}</select></label>`;
    box.querySelectorAll('select').forEach((s) => (s.onchange = () => switchDevice(s.dataset.kind, s.value)));
    box.hidden = false;
  }
}

// keyboard shortcuts while in a call (like most video apps)
addEventListener('keydown', (e) => {
  if (!inCall() || !(e.ctrlKey || e.metaKey) || e.target.closest?.('input, textarea')) return;
  if (e.key.toLowerCase() === 'd') { e.preventDefault(); prefs.micOff = !prefs.micOff; applyLocalToggles(); }
  if (e.key.toLowerCase() === 'e') { e.preventDefault(); if (local?.getVideoTracks().length) { prefs.camOff = !prefs.camOff; applyLocalToggles(); } }
});

/** For troubleshooting from the console: connection state of every link. */
export const debugPeers = () => [...peers].map(([id, p]) => ({
  name: p.name, polite: p.polite, conn: p.pc.connectionState, ice: p.pc.iceConnectionState, signalling: p.pc.signalingState,
  tracks: p.stream.getTracks().map((t) => `${t.kind}:${t.readyState}${t.muted ? ':muted' : ''}`),
}));
