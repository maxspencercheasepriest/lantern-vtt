const { contextBridge, ipcRenderer } = require('electron');

// ipcRenderer.invoke wraps thrown errors as "Error invoking remote method 'x': Error: msg" — keep just msg
const call = async (ch, ...args) => {
  try { return await ipcRenderer.invoke(ch, ...args); } catch (e) {
    throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
};

contextBridge.exposeInMainWorld('launcher', {
  state: () => call('launcher:state'),
  host: (opts) => call('launcher:host', opts),
  join: (opts) => call('launcher:join', opts),
  downloadGoDice: () => call('launcher:godice-download'),
  openData: () => call('launcher:open-data'),
  publicIp: () => call('launcher:public-ip'),
  openExternal: (url) => call('launcher:open-external', url),
});
