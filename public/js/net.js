// Where the Lantern server is. On the web and in the desktop app the page comes from the server itself,
// so this is empty and every path is relative. The Android app carries its own copy of the interface and
// talks to the GM's server at the address the player typed in (window.lanternApp is set by app-shell.js).
export const APP = window.lanternApp || null;
export const SERVER = (APP?.server || '').replace(/\/+$/, '');
/** Turn a server path such as /uploads/abc.jpg or /api/upload into a full URL when running in the app. */
export const serverUrl = (p) => (typeof p === 'string' && p.startsWith('/') ? SERVER + p : p);
