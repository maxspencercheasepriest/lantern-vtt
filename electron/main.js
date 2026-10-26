// Lantern VTT desktop shell: a launcher to host or join a game, the table window,
// a Bluetooth picker for GoDice, and local storage for settings and campaigns.
import { app, BrowserWindow, ipcMain, Menu, shell, dialog, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const DATA_DIR = path.join(USER_DATA, 'campaigns');
const VENDOR_DIR = path.join(USER_DATA, 'vendor');
const GODICE_FILE = path.join(VENDOR_DIR, 'godice.js');
const GODICE_URL = 'https://raw.githubusercontent.com/ParticulaCode/GoDiceJavaScriptAPI/main/godice.js';

// Web Bluetooth (GoDice) is on by default in Chromium on Windows/macOS but behind this flag on Linux;
// setting it everywhere keeps behaviour the same across platforms.
app.commandLine.appendSwitch('enable-experimental-web-platform-features');

// ---------- settings ----------
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
let settings = {
  name: '', room: 'campaign', port: 3000, gmPassword: '', joinAddress: '', recent: [], mode: 'host',
  ...loadSettings(),
};
function saveSettings() {
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/** "192.168.1.20:3000" / "http://host" → "http://192.168.1.20:3000" */
function toOrigin(addr) {
  let a = String(addr || '').trim();
  if (!a) return null;
  if (!/^https?:\/\//i.test(a)) a = `http://${a}`;
  try {
    const u = new URL(a);
    if (u.protocol === 'http:' && !u.port) u.port = '3000';
    return u.origin;
  } catch { return null; }
}

// Web Bluetooth only works on secure pages. Pages from servers we've joined over plain
// http are marked trustworthy here — this has to happen before the app is ready, which is
// why joining a brand-new address restarts the app once.
const STARTUP_TRUSTED = [...new Set((settings.recent || []).map(toOrigin).filter(Boolean))];
if (STARTUP_TRUSTED.length) {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', STARTUP_TRUSTED.join(','));
}

// ---------- windows ----------
let launcherWin = null;
let tableWin = null;
let hosted = null; // { port, close }
let pickerWin = null;
let bluetoothCallback = null;
const icon = path.join(__dirname, 'icon.png');

function openLauncher() {
  if (launcherWin) return launcherWin.focus();
  launcherWin = new BrowserWindow({
    width: 560, height: 720, resizable: true, minWidth: 460, minHeight: 600,
    title: 'Lantern VTT', backgroundColor: '#121214', icon, show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'launcher-preload.cjs') },
  });
  launcherWin.setMenu(null);
  launcherWin.loadFile(path.join(__dirname, 'launcher.html'));
  launcherWin.once('ready-to-show', () => launcherWin.show());
  launcherWin.on('closed', () => { launcherWin = null; });
}

let currentAutoJoin = null;
function openTable(origin, autoJoin) {
  currentAutoJoin = autoJoin;
  const url = new URL(origin);
  url.searchParams.set('room', autoJoin.room);
  tableWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Lantern VTT', backgroundColor: '#121214', icon, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'table-preload.cjs'),
    },
  });
  tableWin.maximize();
  tableWin.setMenu(tableMenu());
  tableWin.loadURL(url.toString());
  tableWin.once('ready-to-show', () => tableWin.show());

  tableWin.webContents.on('did-fail-load', (e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    dialog.showMessageBox(tableWin, {
      type: 'error', title: "Couldn't reach the table",
      message: `Couldn't connect to ${origin}`,
      detail: `${desc}\n\nCheck the address and port, that the GM is hosting, and that their router forwards the port to their PC.`,
    }).then(() => tableWin?.close());
  });

  // links open in the real browser
  tableWin.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });

  // GoDice: Electron has no built-in Bluetooth chooser, so we show our own
  tableWin.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    bluetoothCallback = callback;
    if (!pickerWin) openPicker();
    pickerWin.webContents.send('devices', devices.map((d) => ({ id: d.deviceId, name: d.deviceName || 'Unknown device' })));
  });
  tableWin.webContents.session.setBluetoothPairingHandler((details, callback) => {
    callback({ confirmed: details.pairingKind === 'confirm' });
  });

  tableWin.on('closed', () => {
    tableWin = null;
    if (pickerWin) pickerWin.close();
    openLauncher(); // open first, so the app doesn't think every window has gone
    stopHosting();
  });
  launcherWin?.close();
}

function openPicker() {
  pickerWin = new BrowserWindow({
    parent: tableWin, modal: true, width: 380, height: 440, resizable: false,
    title: 'Connect a GoDice', backgroundColor: '#1d1d21', icon, show: false,
    minimizable: false, maximizable: false,
    webPreferences: { preload: path.join(__dirname, 'picker-preload.cjs') },
  });
  pickerWin.setMenu(null);
  pickerWin.loadFile(path.join(__dirname, 'picker.html'));
  pickerWin.once('ready-to-show', () => pickerWin.show());
  pickerWin.on('closed', () => {
    pickerWin = null;
    if (bluetoothCallback) { bluetoothCallback(''); bluetoothCallback = null; } // closed = cancelled
  });
}
ipcMain.on('picker:choose', (e, id) => {
  if (bluetoothCallback) { bluetoothCallback(id || ''); bluetoothCallback = null; }
  pickerWin?.close();
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function tableMenu() {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
        { label: 'Hosting info…', enabled: true, click: showHostingInfo },
        { label: 'Open campaign folder', click: () => shell.openPath(DATA_DIR) },
        { type: 'separator' },
        { label: 'Leave table', accelerator: 'CmdOrCtrl+W', click: () => tableWin?.close() },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'GoDice JavaScript API', click: () => shell.openExternal('https://github.com/ParticulaCode/GoDiceJavaScriptAPI') },
        { label: `Lantern VTT ${app.getVersion()}`, enabled: false },
      ],
    },
  ]);
}

function showHostingInfo() {
  if (!hosted) {
    return dialog.showMessageBox(tableWin, { type: 'info', title: 'Hosting', message: "You joined someone else's game, so there's nothing to share from here." });
  }
  const lan = lanAddresses().map((a) => `   ${a}:${hosted.port}`).join('\n') || '   (no network found)';
  dialog.showMessageBox(tableWin, {
    type: 'info', title: 'Hosting info',
    message: `Players join with one of these addresses and room "${settings.room}"`,
    detail: `Same network (home Wi-Fi / LAN):\n${lan}\n\nOver the internet: forward TCP port ${hosted.port} on your router to this PC, then give players your public IP followed by :${hosted.port}.\n\nIf Windows asked about the firewall, allow Lantern on private networks (and public if players come in from outside).`,
  });
}

// ---------- hosting ----------
async function stopHosting() {
  if (!hosted) return;
  const h = hosted;
  hosted = null;
  await h.close().catch(() => {});
}

// ---------- launcher IPC ----------
ipcMain.handle('launcher:state', () => ({
  settings: { ...settings },
  lan: lanAddresses(),
  dataDir: DATA_DIR,
  godice: fs.existsSync(GODICE_FILE),
  version: app.getVersion(),
}));

ipcMain.handle('launcher:host', async (e, opts) => {
  const name = String(opts.name || '').trim();
  const room = String(opts.room || '').trim().toLowerCase();
  const port = Number(opts.port) || 3000;
  if (!name) throw new Error('Pick a name');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(room)) throw new Error('Campaign names: lowercase letters, numbers and dashes');
  if (!(port >= 1024 && port <= 65535)) throw new Error('Port must be between 1024 and 65535');
  const gmPassword = String(opts.gmPassword || '').trim() || crypto.randomBytes(6).toString('base64url');
  const ruleset = /^[a-z0-9]{2,12}$/.test(opts.ruleset || '') ? opts.ruleset : '';
  Object.assign(settings, { name, room, port, gmPassword, ruleset, mode: 'host' });
  saveSettings();
  await stopHosting();
  try {
    hosted = await startServer({ port, host: '0.0.0.0', dataDir: DATA_DIR, vendorDir: VENDOR_DIR, gmPassword, quiet: true });
  } catch (err) {
    throw new Error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use — is Lantern already hosting, or another app using it?` : err.message);
  }
  openTable(`http://localhost:${hosted.port}`, { room, name, gmPassword, ruleset });
  return true;
});

ipcMain.handle('launcher:join', async (e, opts) => {
  const name = String(opts.name || '').trim();
  const room = String(opts.room || '').trim().toLowerCase();
  const origin = toOrigin(opts.address);
  if (!name) throw new Error('Pick a name');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(room)) throw new Error('Room names: lowercase letters, numbers and dashes');
  if (!origin) throw new Error("That address doesn't look right — try something like 86.12.34.56:3000");
  Object.assign(settings, { name, room, joinAddress: opts.address, mode: 'join' });
  settings.recent = [origin, ...(settings.recent || []).filter((r) => toOrigin(r) !== origin)].slice(0, 8);
  const autoJoin = { room, name, gmPassword: String(opts.gmPassword || '') };
  const isLocal = /^https:|\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  if (!isLocal && !STARTUP_TRUSTED.includes(origin)) {
    // first visit to this server: restart once so GoDice (Web Bluetooth) is allowed on it
    settings.pendingJoin = { origin, autoJoin };
    saveSettings();
    app.relaunch();
    app.exit(0);
    return true;
  }
  saveSettings();
  openTable(origin, autoJoin);
  return true;
});

ipcMain.handle('launcher:godice-download', async () => {
  const res = await net.fetch(GODICE_URL);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const body = await res.text();
  if (!body.includes('class GoDice')) throw new Error("That didn't look like the GoDice library");
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
  fs.writeFileSync(GODICE_FILE, body);
  return true;
});

ipcMain.handle('launcher:open-data', () => { fs.mkdirSync(DATA_DIR, { recursive: true }); return shell.openPath(DATA_DIR); });
ipcMain.handle('launcher:public-ip', async () => {
  const res = await net.fetch('https://api.ipify.org');
  if (!res.ok) throw new Error('Could not look up your public IP');
  return (await res.text()).trim();
});
ipcMain.handle('launcher:open-external', (e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.on('table:autojoin', (e) => { e.returnValue = currentAutoJoin; });

// The table page asks for our local copy of the GoDice library when the server it's on doesn't have one.
ipcMain.on('table:godice-source', (e) => {
  try { e.returnValue = fs.readFileSync(GODICE_FILE, 'utf8'); } catch { e.returnValue = null; }
});

// ---------- lifecycle ----------
app.whenReady().then(() => {
  const pending = settings.pendingJoin;
  if (pending) {
    delete settings.pendingJoin;
    saveSettings();
    openTable(pending.origin, pending.autoJoin);
  } else {
    openLauncher();
  }
});

app.on('window-all-closed', async () => {
  await stopHosting();
  app.quit();
});
