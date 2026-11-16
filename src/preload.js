const { contextBridge, ipcRenderer } = require('electron');
const call = ch => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  init: call('init'),
  news: call('news'),
  saveSettings: call('settings:save'),
  saveInstance: call('instance:save'),
  deleteInstance: call('instance:delete'),
  openInstance: call('instance:open'),
  launch: call('game:launch'),
  kill: call('game:kill'),
  searchMods: call('mods:search'),
  // main.js takes one { id, ... } object for these
  installMod: (id, projectId) => ipcRenderer.invoke('mods:install', { id, projectId }),
  listMods: call('mods:list'),
  removeMod: (id, file) => ipcRenderer.invoke('mods:remove', { id, file }),
  toggleMod: (id, file) => ipcRenderer.invoke('mods:toggle', { id, file }),
  checkUpdate: call('update:check'),
  applyUpdate: call('update:apply'),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, p) => fn(p)),
});
