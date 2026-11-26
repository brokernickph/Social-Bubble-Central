'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleApi', {
  resize: (mode) => ipcRenderer.send('bubble:resize', mode),   // 'expanded' | 'collapsed'
  close: () => ipcRenderer.send('bubble:close'),
  reveal: () => ipcRenderer.send('bubble:reveal'),
  focus: () => ipcRenderer.send('bubble:focus'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  reportUnread: (payload) => ipcRenderer.send('bubble:unread', payload),  // { id, count, increased }
  setZoom: (id, zoom) => ipcRenderer.invoke('service:set-zoom', { id, zoom }),
  onZoomKey: (cb) => ipcRenderer.on('bubbly:zoom-key', (e, key) => cb(key))
});
