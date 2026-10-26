// Runs in the table window. Hands the page its auto-join details and,
// if the server it's on lacks the GoDice library, our local copy.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanternDesktop', {
  autoJoin: ipcRenderer.sendSync('table:autojoin'),
  godiceSource: () => ipcRenderer.sendSync('table:godice-source'),
});
