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
  installMod: call('mods:install'),
  listMods: call('mods:list'),
  removeMod: call('mods:remove'),
  toggleMod: call('mods:toggle'),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, p) => fn(p)),
});
