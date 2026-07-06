'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleApi', {
  resize: (mode) => ipcRenderer.send('bubble:resize', mode),   // 'expanded' | 'collapsed'
  close: () => ipcRenderer.send('bubble:close'),
  reveal: () => ipcRenderer.send('bubble:reveal'),
  openExternal: (url) => ipcRenderer.send('open-external', url)
});
