// The GM's audio player: uploaded tracks, the music that's playing, and the ambience layers that are on.
// The server keeps this state and every client plays along, so everyone hears the same thing.
//
//   track:  { id, name, url, kind: 'music' | 'ambience' | 'effect', duration (seconds, 0 = unknown), volume 0–1 }
//   music:  { trackId, playing, startedAt (server ms when the current stretch started), offset (seconds into the
//             track at startedAt), repeat: 'all' | 'one' | 'off', shuffle, volume 0–1 }
//   ambience: ids of ambience tracks that are looping right now

export const KINDS = ['music', 'ambience', 'effect'];
export const REPEATS = ['all', 'one', 'off'];
export const MAX_TRACKS = 300;

export function freshAudio() {
  return {
    tracks: [],
    music: { trackId: null, playing: false, startedAt: 0, offset: 0, repeat: 'all', shuffle: false, volume: 0.8 },
    ambience: [],
  };
}

const clamp01 = (v, d = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; };

/** Saved state from disk: keep the tracks and settings, but nothing is playing after a restart. */
export function loadAudio(saved) {
  const a = freshAudio();
  if (!saved || typeof saved !== 'object') return a;
  a.tracks = Array.isArray(saved.tracks) ? saved.tracks.filter((t) => t && t.id && t.url).slice(0, MAX_TRACKS) : [];
  const m = saved.music || {};
  a.music.repeat = REPEATS.includes(m.repeat) ? m.repeat : 'all';
  a.music.shuffle = !!m.shuffle;
  a.music.volume = clamp01(m.volume, 0.8);
  if (a.tracks.some((t) => t.id === m.trackId)) { a.music.trackId = m.trackId; a.music.offset = Math.max(0, Number(m.offset) || 0); }
  return a;
}

/** What gets saved: the current position is frozen into `offset`. */
export function saveAudio(a, now = Date.now()) {
  return { tracks: a.tracks, music: { ...a.music, playing: false, offset: musicPosition(a, now), startedAt: 0 }, ambience: [] };
}

export function cleanTrack({ id, name, url, kind, duration, volume }) {
  return {
    id, url,
    name: String(name || 'Untitled').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'Untitled',
    kind: KINDS.includes(kind) ? kind : 'music',
    duration: Math.max(0, Math.min(24 * 3600, Number(duration) || 0)),
    volume: clamp01(volume, 1),
  };
}

export const trackById = (a, id) => a.tracks.find((t) => t.id === id) || null;
export const musicTracks = (a) => a.tracks.filter((t) => t.kind === 'music');

/** Seconds into the current music track (wrapping when it repeats one track). */
export function musicPosition(a, now = Date.now()) {
  const m = a.music;
  let pos = m.playing ? m.offset + (now - m.startedAt) / 1000 : m.offset;
  const t = trackById(a, m.trackId);
  if (m.repeat === 'one' && t?.duration) pos %= t.duration;
  return Math.max(0, pos);
}

export function playMusic(a, trackId, now = Date.now(), at = 0) {
  if (!trackById(a, trackId)) throw new Error('No such track');
  Object.assign(a.music, { trackId, playing: true, startedAt: now, offset: Math.max(0, Number(at) || 0) });
}
export function pauseMusic(a, now = Date.now()) {
  if (!a.music.playing) return;
  a.music.offset = musicPosition(a, now);
  a.music.playing = false;
}
export function resumeMusic(a, now = Date.now()) {
  if (!a.music.trackId || a.music.playing) return;
  a.music.playing = true;
  a.music.startedAt = now;
}
export function stopMusic(a) {
  Object.assign(a.music, { playing: false, offset: 0, startedAt: 0 });
}
export function seekMusic(a, seconds, now = Date.now()) {
  a.music.offset = Math.max(0, Number(seconds) || 0);
  a.music.startedAt = now;
}

/** The track after the current one in the music list (or a random other one when shuffling). */
export function nextMusicId(a, { wrap = true, rnd = Math.random } = {}) {
  const list = musicTracks(a);
  if (!list.length) return null;
  const i = list.findIndex((t) => t.id === a.music.trackId);
  if (a.music.shuffle && list.length > 1) {
    const others = list.filter((t) => t.id !== a.music.trackId);
    return others[Math.floor(rnd() * others.length)].id;
  }
  if (i + 1 < list.length) return list[i + 1].id;
  return wrap ? list[0].id : null;
}
export function prevMusicId(a) {
  const list = musicTracks(a);
  if (!list.length) return null;
  const i = list.findIndex((t) => t.id === a.music.trackId);
  return list[i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length].id;
}

/**
 * When the current track should end, in server ms, or null (paused, repeating one track, or length unknown).
 * The server sets a timer for this and moves the playlist on.
 */
export function musicEndsAt(a) {
  const m = a.music;
  const t = trackById(a, m.trackId);
  if (!m.playing || !t?.duration || m.repeat === 'one') return null;
  return m.startedAt + (t.duration - m.offset) * 1000;
}

/** The current track has finished: move on according to the repeat setting. */
export function advanceMusic(a, now = Date.now(), rnd = Math.random) {
  const next = a.music.repeat === 'off' ? nextMusicId(a, { wrap: false, rnd }) : nextMusicId(a, { rnd });
  if (next) playMusic(a, next, now);
  else stopMusic(a);
}

export function removeTrack(a, id) {
  const t = trackById(a, id);
  if (!t) return null;
  a.tracks = a.tracks.filter((x) => x.id !== id);
  a.ambience = a.ambience.filter((x) => x !== id);
  if (a.music.trackId === id) { a.music.trackId = null; stopMusic(a); }
  return t;
}

export function setAmbience(a, id, on) {
  const t = trackById(a, id);
  if (!t) throw new Error('No such track');
  a.ambience = a.ambience.filter((x) => x !== id);
  if (on) a.ambience.push(id);
}
