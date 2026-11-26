'use strict';

// Preload for every chat <webview> (attached in main.js will-attach-webview).
// Runs in an isolated, sandboxed world: the page can't reach Node or IPC.
// The only job: when Bubbly's main-world patch reports a notification click
// via postMessage, tell the host window so it can open that chat.
const { ipcRenderer } = require('electron');

window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.__bubbly === 'notification-click') {
    ipcRenderer.sendToHost('notification-click');
  }
});
