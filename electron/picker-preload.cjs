const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onDevices: (fn) => ipcRenderer.on('devices', (e, list) => fn(list)),
  choose: (id) => ipcRenderer.send('picker:choose', id),
});
