import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SB from '../soundboard.js';

const withTracks = () => {
  const a = SB.freshAudio();
  a.tracks = [
    SB.cleanTrack({ id: 'm1', url: '/uploads/a.mp3', name: 'Tavern', kind: 'music', duration: 100 }),
    SB.cleanTrack({ id: 'm2', url: '/uploads/b.mp3', name: 'Battle', kind: 'music', duration: 50 }),
    SB.cleanTrack({ id: 'r1', url: '/uploads/c.ogg', name: 'Rain', kind: 'ambience' }),
    SB.cleanTrack({ id: 'f1', url: '/uploads/d.wav', name: 'Door', kind: 'effect' }),
  ];
  return a;
};

test('position follows the server clock, pausing and seeking', () => {
  const a = withTracks();
  SB.playMusic(a, 'm1', 1000);
  assert.equal(SB.musicPosition(a, 11000), 10);
  SB.pauseMusic(a, 21000);
  assert.equal(SB.musicPosition(a, 99999), 20);
  SB.resumeMusic(a, 30000);
  assert.equal(SB.musicPosition(a, 35000), 25);
  SB.seekMusic(a, 90, 40000);
  assert.equal(SB.musicEndsAt(a), 40000 + 10 * 1000);
});

test('playlist moves on, repeats and stops', () => {
  const a = withTracks();
  SB.playMusic(a, 'm1', 0);
  SB.advanceMusic(a, 100000);
  assert.equal(a.music.trackId, 'm2');
  SB.advanceMusic(a, 150000); // repeat all wraps
  assert.equal(a.music.trackId, 'm1');
  a.music.repeat = 'off';
  SB.playMusic(a, 'm2', 0);
  SB.advanceMusic(a, 50000);
  assert.equal(a.music.playing, false);
  a.music.repeat = 'one';
  SB.playMusic(a, 'm2', 0);
  assert.equal(SB.musicEndsAt(a), null); // loops on the clients, no server timer
  assert.equal(SB.musicPosition(a, 70000), 20); // 70 s into a 50 s loop
  a.music.repeat = 'all'; a.music.shuffle = true;
  SB.playMusic(a, 'm1', 0);
  assert.equal(SB.nextMusicId(a), 'm2'); // only one other track to shuffle to
  assert.equal(SB.prevMusicId(withTracks()), 'm2');
});

test('ambience, removing tracks, saving and loading', () => {
  const a = withTracks();
  SB.setAmbience(a, 'r1', true);
  SB.setAmbience(a, 'r1', true);
  assert.deepEqual(a.ambience, ['r1']);
  SB.playMusic(a, 'm1', 0);
  const saved = JSON.parse(JSON.stringify(SB.saveAudio(a, 30000)));
  assert.equal(saved.music.offset, 30);
  const loaded = SB.loadAudio(saved);
  assert.equal(loaded.music.playing, false);
  assert.equal(loaded.music.trackId, 'm1');
  assert.equal(SB.musicPosition(loaded), 30);
  assert.deepEqual(loaded.ambience, []);
  SB.removeTrack(a, 'm1');
  assert.equal(a.music.trackId, null);
  SB.removeTrack(a, 'r1');
  assert.deepEqual(a.ambience, []);
  assert.throws(() => SB.playMusic(a, 'nope'));
  assert.equal(SB.cleanTrack({ id: 'x', url: '/u', name: '<b>hi</b>', kind: 'weird', volume: 7 }).kind, 'music');
  assert.equal(SB.cleanTrack({ id: 'x', url: '/u', volume: 7 }).volume, 1);
});
