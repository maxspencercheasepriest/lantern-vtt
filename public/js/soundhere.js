// Which devices make the table's sound. Online, everyone hears it on their own device. Round one table,
// five laptops playing the same dice rattle a beat apart is a mess, so the GM can have only their device
// play it. Anyone joining from elsewhere can still choose to hear it.
import { store } from './util.js';

const KEY = 'lantern.soundAnyway';
export const soundMode = () => store.settings?.soundOn || 'all';
export function hearAnyway() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
export function setHearAnyway(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private window */ } store.emit('soundhere'); }
/** Should this device play the table's sound (dice, chat, the GM's music, the alarm)? */
export const soundHere = () => store.isGM || soundMode() === 'all' || hearAnyway();
