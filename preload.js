'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splitdpi', {
  toggle: () => ipcRenderer.invoke('toggle'),
  getState: () => ipcRenderer.invoke('getState'),
  saveSettings: (s) => ipcRenderer.invoke('saveSettings', s),
  launchDiscord: () => ipcRenderer.invoke('launchDiscord'),
  win: (a) => ipcRenderer.invoke('win', a),
  open: (u) => ipcRenderer.invoke('open', u),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d)),
});
