'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbly', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setExpanded: (value) => ipcRenderer.invoke('panel:set-expanded', value),
  setMode: (mode) => ipcRenderer.invoke('mode:set', mode),
  setRailSize: (size) => ipcRenderer.send('rail:size', size),
  hideWindow: () => ipcRenderer.send('window:hide'),
  updateUnread: (payload) => ipcRenderer.send('unread:update', payload),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  bubbleMenu: (info) => ipcRenderer.invoke('bubble-menu', info),

  detachService: (svc) => ipcRenderer.invoke('service:detach', svc),
  focusDetached: (id) => ipcRenderer.invoke('service:focus-detached', id),
  listDetached: () => ipcRenderer.invoke('service:list-detached'),
  closeDetached: (id) => ipcRenderer.invoke('service:close-detached', id),
  setZoom: (id, zoom) => ipcRenderer.invoke('service:set-zoom', { id, zoom }),

  onRevealed: (cb) => ipcRenderer.on('bubbly:revealed', (e, data) => cb(data)),
  onBlur: (cb) => ipcRenderer.on('bubbly:blur', () => cb()),
  onMode: (cb) => ipcRenderer.on('bubbly:mode', (e, m) => cb(m)),
  onActivity: (cb) => ipcRenderer.on('bubbly:activity', () => cb()),
  onDetached: (cb) => ipcRenderer.on('bubbly:detached', (e, id) => cb(id)),
  onReattached: (cb) => ipcRenderer.on('bubbly:reattached', (e, id) => cb(id)),
  onDetachedUnread: (cb) => ipcRenderer.on('bubbly:detached-unread', (e, data) => cb(data)),
  onZoomKey: (cb) => ipcRenderer.on('bubbly:zoom-key', (e, key) => cb(key)),
  onSettingsChanged: (cb) => ipcRenderer.on('bubbly:settings-changed', (e, s) => cb(s))
});
