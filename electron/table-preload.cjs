// Runs in the table window. Hands the page its auto-join details and,
// if the server it's on lacks the GoDice library, our local copy.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanternDesktop', {
  autoJoin: ipcRenderer.sendSync('table:autojoin'),
  godiceSource: () => ipcRenderer.sendSync('table:godice-source'),
  // Share online (only works on the host's own table)
  share: {
    status: () => ipcRenderer.invoke('share:status'),
    start: () => ipcRenderer.invoke('share:start').catch((e) => { throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }),
    stop: () => ipcRenderer.invoke('share:stop'),
    onStatus: (fn) => ipcRenderer.on('share:status', (e, s) => fn(s)),
  },
});
