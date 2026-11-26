'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell, globalShortcut, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { displayAccelerator, isValidAccelerator } = require('./renderer/hotkey.js');

const RAIL_W = 84;
const V_MARGIN = 10;
const PEEK_PX = 12;   // sliver left visible when slid into the edge

// Strip Electron/app tokens from the UA so web logins (Google, Instagram, WhatsApp) don't reject us.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/[\d.]+/i, '')
  .replace(/\s[Bb]ubbly\/[\d.]+/, '');

app.setAppUserModelId('com.speeed.bubbly');

// ---------------------------------------------------------------------------
// Settings store (plain JSON in userData)
// ---------------------------------------------------------------------------
const DEFAULTS = {
  orientation: 'vertical',    // 'vertical' (left/right edge) | 'horizontal' (top/bottom edge)
  edge: 'right',              // 'left' | 'right' | 'top' | 'bottom' — set by dragging the rail too
  railY: null,                // vertical: top of the rail (null = centered on first run)
  railCX: null,               // horizontal: centre of the bar (null = centre of the screen)
  idleDelaySec: 6,            // seconds before sliding into the edge
  ghostMode: false,           // fully hide until a notification arrives
  collapseOnBlur: true,       // collapse panel when focus leaves the app
  launchAtStartup: false,
  panelWidth: 440,
  panelHeight: 720,
  blockPasskeys: true,        // suppress WebAuthn / Windows Hello passkey pop-ups
  hotkey: 'Control+Shift+B',  // global show/hide shortcut (Electron accelerator)
  onboarded: false,
  services: [],               // { id, type, name, url, color, muted, zoom, chats: [{ id, name, url }], chatsHidden }
  floating: [],               // service ids popped out as floating bubbles (restored on launch)
  bubblePos: {}               // service id -> { x, y } last position of its floating bubble
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = loadSettings();

// Injected into each chat page (main world) to neutralize WebAuthn so sites like
// Discord can't pop the Windows "Choose a passkey" dialog. Passkey get()/create()
// reject with NotAllowedError (which every site treats as "user cancelled" and
// falls back to password), and platform-authenticator probes report "unavailable"
// so sites stop auto-offering passkeys. Password/federated autofill is untouched.
const PASSKEY_PATCH = `(() => { try {
  if (window.__bubblyNoPasskey) return; window.__bubblyNoPasskey = true;
  const C = navigator.credentials;
  const decline = () => Promise.reject(new DOMException('Passkeys are disabled in Bubbly.', 'NotAllowedError'));
  if (C && C.get) { const g = C.get.bind(C); C.get = (o) => (o && o.publicKey) ? decline() : g(o); }
  if (C && C.create) { const c = C.create.bind(C); C.create = (o) => (o && o.publicKey) ? decline() : c(o); }
  if (window.PublicKeyCredential) {
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
    if (window.PublicKeyCredential.isConditionalMediationAvailable)
      window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  }
} catch (e) {} })();`;

// Injected into each chat page (main world): when the user clicks one of the
// page's desktop notifications, post a message our webview preload relays to the
// host window, which then shows Bubbly on that chat. The site's own click
// handler still runs. (Notifications shown from a service worker aren't covered.)
const NOTIFY_PATCH = `(() => { try {
  const N = window.Notification;
  if (!N || N.__bubbly) return;
  class BubblyNotification extends N {
    constructor(title, options) {
      super(title, options);
      this.addEventListener('click', () => {
        try { window.postMessage({ __bubbly: 'notification-click' }, '*'); } catch (e) {}
      });
    }
  }
  BubblyNotification.__bubbly = true;
  window.Notification = BubblyNotification;
} catch (e) {} })();`;

function reloadAllWebviews() {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() === 'webview') { try { wc.reload(); } catch { /* not ready */ } }
  }
}

function loadSettings() {
  let s;
  try {
    s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch {
    s = { ...DEFAULTS };
  }
  return normalizeLayout(s);
}

// Keep edge consistent with the orientation (vertical → left/right, horizontal → top/bottom).
function normalizeLayout(s) {
  const horizontal = s.orientation === 'horizontal';
  if (horizontal && !['top', 'bottom'].includes(s.edge)) s.edge = 'bottom';
  if (!horizontal && !['left', 'right'].includes(s.edge)) s.edge = 'right';
  if (!horizontal) s.orientation = 'vertical';
  return s;
}

const isHorizontal = () => settings.orientation === 'horizontal';

function persistSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to persist settings:', err);
  }
}

// ---------------------------------------------------------------------------
// Procedural tray icon (no binary assets needed)
// ---------------------------------------------------------------------------
function trayIcon(hasUnread) {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4); // BGRA
  const base = hasUnread ? [255, 77, 94] : [124, 92, 255];
  const c = size / 2;
  const r = c - 1.5;

  const put = (x, y, rgb, a) => {
    const i = (y * size + x) * 4;
    const na = Math.max(buf[i + 3], a);
    buf[i] = Math.round((rgb[2] * a) / 255);
    buf[i + 1] = Math.round((rgb[1] * a) / 255);
    buf[i + 2] = Math.round((rgb[0] * a) / 255);
    buf[i + 3] = na;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c + 0.5, y - c + 0.5);
      if (d <= r) {
        const a = d <= r - 1.2 ? 255 : Math.round(255 * (r - d) / 1.2);
        put(x, y, base, a);
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size * 0.38, y - size * 0.38);
      if (d <= 3.4) {
        const a = d <= 2.4 ? 230 : Math.round(230 * (3.4 - d));
        if (a > buf[(y * size + x) * 4 + 3] - 20) put(x, y, [255, 255, 255], a);
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

// ---------------------------------------------------------------------------
// Window geometry
//   mode 'out'  — rail fully visible at the edge
//   mode 'peek' — slid into the edge, only a sliver showing
//   ghost hide  — win.hide(), revealed by notification / hotkey / tray
// ---------------------------------------------------------------------------
let win = null;
let tray = null;
let expanded = false;
let mode = 'out';
let railSize = { w: RAIL_W, h: 320 }; // reported by the renderer
let lastUnread = 0;
let hotkeyOk = true;                  // false when another app owns the shortcut
let quitting = false;
let programmaticMove = false;
let animTimer = null;
let moveDebounce = null;
const detached = new Map();           // service id -> its standalone BrowserWindow
const detachedUnread = new Map();     // service id -> last unread count its bubble reported

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function workArea() {
  try {
    return screen.getDisplayMatching(win.getBounds()).workArea;
  } catch {
    return screen.getPrimaryDisplay().workArea;
  }
}

function railTop(wa, railH) {
  if (settings.railY == null) settings.railY = wa.y + Math.round((wa.height - railH) / 2);
  return clamp(settings.railY, wa.y + V_MARGIN, wa.y + wa.height - railH - V_MARGIN);
}

// The horizontal bar remembers its centre, so it stays put as bubbles are added.
function railLeft(wa, railW) {
  const cx = settings.railCX == null ? wa.x + wa.width / 2 : settings.railCX;
  return clamp(Math.round(cx - railW / 2), wa.x + V_MARGIN, wa.x + wa.width - railW - V_MARGIN);
}

// Horizontal bar along the top or bottom edge. The panel opens above a bottom
// bar and below a top bar, centred on the bar where the screen allows.
function targetBoundsHorizontal(wa, m) {
  const top = settings.edge === 'top';
  const railW = Math.min(railSize.w, wa.width - 2 * V_MARGIN);

  if (expanded) {
    const panelW = clamp(settings.panelWidth, 320, wa.width - 2 * V_MARGIN);
    const w = Math.max(panelW, railW);
    const h = clamp(RAIL_W + settings.panelHeight, RAIL_W + 320, wa.height - V_MARGIN);
    const centerX = railLeft(wa, railW) + railW / 2;
    const x = clamp(Math.round(centerX - w / 2), wa.x + V_MARGIN, wa.x + wa.width - w - V_MARGIN);
    const y = top ? wa.y : wa.y + wa.height - h;
    return { x, y, width: w, height: h };
  }

  const x = railLeft(wa, railW);
  let y = top ? wa.y : wa.y + wa.height - RAIL_W;
  if (m === 'peek') y = top ? wa.y - (RAIL_W - PEEK_PX) : wa.y + wa.height - PEEK_PX;
  return { x, y, width: railW, height: RAIL_W };
}

function targetBounds(modeOverride) {
  const wa = workArea();
  const m = modeOverride || mode;
  if (isHorizontal()) return targetBoundsHorizontal(wa, m);

  if (expanded) {
    const h = clamp(settings.panelHeight, 480, wa.height - 2 * V_MARGIN);
    const w = clamp(RAIL_W + settings.panelWidth, RAIL_W + 320, wa.width - V_MARGIN);
    const railH = Math.min(railSize.h, h);
    const centerY = railTop(wa, railH) + railH / 2;
    const y = clamp(Math.round(centerY - h / 2), wa.y + V_MARGIN, wa.y + wa.height - h - V_MARGIN);
    const x = settings.edge === 'left' ? wa.x : wa.x + wa.width - w;
    return { x, y, width: w, height: h };
  }

  const h = Math.min(railSize.h, wa.height - 2 * V_MARGIN);
  const y = railTop(wa, h);
  let x = settings.edge === 'left' ? wa.x : wa.x + wa.width - RAIL_W;
  if (m === 'peek') {
    x = settings.edge === 'left'
      ? wa.x - (RAIL_W - PEEK_PX)
      : wa.x + wa.width - PEEK_PX;
  }
  return { x, y, width: RAIL_W, height: h };
}

// Positions we moved the window to ourselves. On Linux/X11 the 'move' event for
// our own setBounds can arrive after programmaticMove is reset, so we also
// recognise those late events by position and don't mistake them for a drag.
const recentQuiet = [];
function setBoundsQuiet(b) {
  programmaticMove = true;
  win.setBounds(b);
  programmaticMove = false;
  recentQuiet.push(`${b.x},${b.y}`);
  if (recentQuiet.length > 12) recentQuiet.shift();
}
function isOwnMove() {
  const b = win.getBounds();
  return recentQuiet.includes(`${b.x},${b.y}`);
}

function animateTo(target, ms) {
  clearInterval(animTimer);
  if (!ms) { setBoundsQuiet(target); return; }
  const start = win.getBounds();
  const t0 = Date.now();
  animTimer = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / ms);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    setBoundsQuiet({
      x: Math.round(start.x + (target.x - start.x) * e),
      y: Math.round(start.y + (target.y - start.y) * e),
      width: Math.round(start.width + (target.width - start.width) * e),
      height: Math.round(start.height + (target.height - start.height) * e)
    });
    if (p >= 1) clearInterval(animTimer);
  }, 16);
}

function setMode(m, animMs = 220) {
  if (mode === m) {
    return;
  }
  mode = m;
  if (win) {
    win.webContents.send('bubbly:mode', mode);
    animateTo(targetBounds(), animMs);
  }
}

// Reveal from hidden/peek with a slide-in from the edge
function reveal(reason) {
  mode = 'out';
  win.webContents.send('bubbly:mode', mode);
  if (!win.isVisible()) {
    setBoundsQuiet(targetBounds('peek'));
    win.showInactive();
  }
  animateTo(targetBounds(), 240);
  win.webContents.send('bubbly:revealed', { reason });
}

// ---------------------------------------------------------------------------
// Drag-to-move: the rail is a native drag region; when the user drops it,
// snap to the nearest screen edge and remember the vertical position.
// ---------------------------------------------------------------------------
function snapAfterDrag() {
  const b = win.getBounds();
  let wa;
  try { wa = screen.getDisplayMatching(b).workArea; } catch { wa = screen.getPrimaryDisplay().workArea; }

  if (isHorizontal()) {
    const railW = expanded ? Math.min(railSize.w, b.width) : b.width;
    settings.edge = (b.y + b.height / 2) < (wa.y + wa.height / 2) ? 'top' : 'bottom';
    // expanded: the bar is centred in the window; collapsed: the window is the bar
    settings.railCX = clamp(b.x + b.width / 2, wa.x + railW / 2, wa.x + wa.width - railW / 2);
    persistSettings();
    win.webContents.send('bubbly:settings-changed', publicSettings());
    animateTo(targetBounds(), 180);
    return;
  }

  const edge = (b.x + b.width / 2) < (wa.x + wa.width / 2) ? 'left' : 'right';
  const railH = expanded ? Math.min(railSize.h, b.height) : b.height;
  const railY = expanded
    ? Math.round(b.y + b.height / 2 - railH / 2)
    : b.y;

  settings.edge = edge;
  settings.railY = clamp(railY, wa.y + V_MARGIN, wa.y + wa.height - railH - V_MARGIN);
  persistSettings();
  win.webContents.send('bubbly:settings-changed', publicSettings());
  animateTo(targetBounds(), 180);
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: RAIL_W,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    setBoundsQuiet(targetBounds());
    win.showInactive();
  });

  win.on('move', () => {
    if (programmaticMove || !win.isVisible() || isOwnMove()) return;
    clearInterval(animTimer);                 // the user grabbed it: stop any slide in progress
    win.webContents.send('bubbly:activity'); // dragging counts as interaction
    clearTimeout(moveDebounce);
    moveDebounce = setTimeout(snapAfterDrag, 500);
  });

  win.on('blur', () => {
    if (settings.collapseOnBlur) win.webContents.send('bubbly:blur');
  });

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function toggleVisibility() {
  if (!win) return;
  if (!win.isVisible()) {
    reveal('manual');
  } else if (mode === 'peek') {
    setMode('out');
    win.webContents.send('bubbly:revealed', { reason: 'manual' });
  } else {
    win.hide();
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon(lastUnread > 0));
  const hk = hotkeyOk ? displayAccelerator(settings.hotkey) : null;
  tray.setToolTip(lastUnread > 0
    ? `Bubbly — ${lastUnread} unread (click to show)`
    : `Bubbly — click to show/hide${hk ? ` (${hk})` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: hk ? `Show / Hide\t${hk}` : 'Show / Hide', click: toggleVisibility },
    { type: 'separator' },
    {
      label: 'Ghost mode',
      type: 'checkbox',
      checked: settings.ghostMode,
      click: (item) => applySettings({ ghostMode: item.checked })
    },
    {
      label: 'Launch at startup',
      type: 'checkbox',
      checked: settings.launchAtStartup,
      click: (item) => applySettings({ launchAtStartup: item.checked })
    },
    { type: 'separator' },
    { label: 'Quit Bubbly', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(trayIcon(false));
  tray.on('click', toggleVisibility);
  updateTray();
}

// ---------------------------------------------------------------------------
// Floating chat-head bubbles — "detach the bubble". Each is a frameless,
// transparent, always-on-top window (bubble.html) that the user drags anywhere
// and uses independently of the rail. It expands to a compact chat panel and
// collapses back to a 76px draggable head. Shares the login (persist:<id>).
// ---------------------------------------------------------------------------
const BUBBLE_HEAD = 76;
const BUBBLE_W = 400;
const BUBBLE_H = 560;

// What a floating bubble shows, from its id: a whole service ("<svc id>") or one
// pinned chat ("<svc id>~<chat id>"). Chats share their service's login.
function floatTarget(id) {
  const [svcId, chatId] = String(id).split('~');
  const svc = settings.services.find((s) => s.id === svcId);
  if (!svc) return null;
  if (!chatId) return svc;
  const chat = (svc.chats || []).find((c) => c.id === chatId);
  if (!chat) return null;
  return { ...svc, id, partition: svc.id, chatOf: svc.id, chatName: chat.name, url: chat.url };
}

function createBubbleWindow(svc) {
  const existing = detached.get(svc.id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  // Reopen where the user last left it (if that spot is still on a screen).
  const saved = settings.bubblePos && settings.bubblePos[svc.id];
  let wa = screen.getPrimaryDisplay().workArea;
  let startX = wa.x + wa.width - BUBBLE_W - 120;
  let startY = wa.y + 100;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    wa = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea;
    startX = saved.x;
    startY = saved.y;
  }
  startX = clamp(startX, wa.x, wa.x + wa.width - BUBBLE_W);
  startY = clamp(startY, wa.y, wa.y + wa.height - BUBBLE_H);

  const w = new BrowserWindow({
    width: BUBBLE_W,
    height: BUBBLE_H,
    x: startX,
    y: startY,
    minWidth: BUBBLE_HEAD,
    minHeight: BUBBLE_HEAD,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'bubble-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  });

  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(path.join(__dirname, 'renderer', 'bubble.html'), {
    query: { svc: JSON.stringify(svc) }
  });
  w.once('ready-to-show', () => w.showInactive());

  let posTimer = null;
  w.on('move', () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (w.isDestroyed()) return;
      const b = w.getBounds();
      settings.bubblePos = { ...settings.bubblePos, [svc.id]: { x: b.x, y: b.y } };
      persistSettings();
    }, 400);
  });

  w.on('closed', () => {
    clearTimeout(posTimer);
    detached.delete(svc.id);
    detachedUnread.delete(svc.id);
    // Quitting closes every bubble — keep them listed so they come back next launch.
    if (!quitting) {
      settings.floating = (settings.floating || []).filter((id) => id !== svc.id);
      persistSettings();
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('bubbly:detached-unread', { id: svc.id, count: 0 });
      win.webContents.send('bubbly:reattached', svc.id);
    }
  });

  detached.set(svc.id, w);
  if (!(settings.floating || []).includes(svc.id)) {
    settings.floating = [...(settings.floating || []), svc.id];
    persistSettings();
  }
  if (win && !win.isDestroyed()) win.webContents.send('bubbly:detached', svc.id);
  return w;
}

// A bubble window asks to resize itself (expand <-> collapse). We keep the head
// anchored to the same on-screen corner so it doesn't jump when it grows.
function resizeBubble(sender, mode) {
  const w = BrowserWindow.fromWebContents(sender);
  if (!w || w.isDestroyed()) return;
  const b = w.getBounds();
  let wa;
  try { wa = screen.getDisplayMatching(b).workArea; } catch { wa = screen.getPrimaryDisplay().workArea; }

  const nw = mode === 'expanded' ? BUBBLE_W : BUBBLE_HEAD;
  const nh = mode === 'expanded' ? BUBBLE_H : BUBBLE_HEAD;
  // anchor: whichever horizontal half of the screen the head sits in
  const onRight = b.x + b.width / 2 > wa.x + wa.width / 2;
  let nx = onRight ? b.x + b.width - nw : b.x;
  let ny = b.y;
  nx = clamp(nx, wa.x, wa.x + wa.width - nw);
  ny = clamp(ny, wa.y, wa.y + wa.height - nh);
  w.setBounds({ x: nx, y: ny, width: nw, height: nh });
  w.setResizable(mode === 'expanded');
}

// ---------------------------------------------------------------------------
// Settings mutation + side effects
// ---------------------------------------------------------------------------
// What the renderers see: stored settings plus runtime status.
const publicSettings = () => ({ ...settings, hotkeyOk });

// (Re)bind the global show/hide shortcut. Returns false if it's unusable or
// another app already owns it.
function bindHotkey(acc) {
  if (!isValidAccelerator(acc)) return false;
  try { return globalShortcut.register(acc, toggleVisibility); } catch { return false; }
}

function applySettings(patch) {
  const prev = { ...settings };
  const { hotkeyOk: _ignored, ...clean } = patch || {};
  settings = normalizeLayout({ ...settings, ...clean });

  if (prev.hotkey !== settings.hotkey) {
    if (hotkeyOk) globalShortcut.unregister(prev.hotkey);
    if (bindHotkey(settings.hotkey)) {
      hotkeyOk = true;
    } else {
      // keep the old shortcut working rather than leaving none
      settings.hotkey = prev.hotkey;
      hotkeyOk = bindHotkey(prev.hotkey);
    }
  }
  persistSettings();

  const geometryChanged =
    prev.edge !== settings.edge ||
    prev.orientation !== settings.orientation ||
    prev.railCX !== settings.railCX ||
    prev.panelWidth !== settings.panelWidth ||
    prev.panelHeight !== settings.panelHeight ||
    prev.railY !== settings.railY;
  if (geometryChanged) animateTo(targetBounds(), 200);

  if (prev.launchAtStartup !== settings.launchAtStartup) {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup });
  }
  updateTray();
  if (win) win.webContents.send('bubbly:settings-changed', publicSettings());

  // Reload chats so the passkey patch applies (or stops applying) immediately.
  if (prev.blockPasskeys !== settings.blockPasskeys) reloadAllWebviews();
  return publicSettings();
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:save', (e, patch) => applySettings(patch));

ipcMain.handle('panel:set-expanded', (e, value) => {
  expanded = !!value;
  mode = 'out';
  win.webContents.send('bubbly:mode', mode);
  setBoundsQuiet(targetBounds()); // instant — the panel itself animates in CSS
});

ipcMain.handle('mode:set', (e, m) => {
  if (m === 'peek' && expanded) return;
  setMode(m);
});

ipcMain.on('rail:size', (e, size) => {
  railSize = { w: Math.max(140, size.w || 0), h: Math.max(140, size.h || 0) };
  if (!expanded && win.isVisible()) animateTo(targetBounds(), 120);
});

ipcMain.on('window:hide', () => { if (win) win.hide(); });

// e.g. a chat notification was clicked: bring the rail out and focus it.
ipcMain.on('window:show', () => {
  if (!win) return;
  if (!win.isVisible() || mode === 'peek') reveal('manual');
  win.focus();
});

ipcMain.on('unread:update', (e, { total, increased }) => {
  lastUnread = total;
  updateTray();
  if (increased && (!win.isVisible() || mode === 'peek')) {
    reveal('notification');
  }
});

ipcMain.on('open-external', (e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// Context menu built by the renderer: items are { label, value } or
// { type: 'separator' }; resolves with the picked value (or null).
ipcMain.handle('menu:popup', (e, items) => {
  const host = BrowserWindow.fromWebContents(e.sender) || win;
  return new Promise((resolve) => {
    let done = false;
    const template = (items || []).map((it) => (it.type === 'separator'
      ? { type: 'separator' }
      : { label: String(it.label), enabled: it.enabled !== false, click: () => { done = true; resolve(it.value); } }));
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: host });
    menu.on('menu-will-close', () => setTimeout(() => { if (!done) resolve(null); }, 50));
  });
});

// Point a floating bubble at another page of its service (e.g. a pinned chat).
ipcMain.handle('service:navigate-detached', (e, { id, url }) => {
  const w = detached.get(id);
  if (!w || w.isDestroyed() || !/^https?:\/\//i.test(url || '')) return false;
  w.webContents.send('bubble:navigate', url);
  w.show();
  w.focus();
  return true;
});

// Pop a service ("<svc id>") or a pinned chat ("<svc id>~<chat id>") out as a floating bubble.
ipcMain.handle('service:detach', (e, id) => {
  const t = floatTarget(id);
  if (!t) return false;
  createBubbleWindow(t);
  return true;
});

ipcMain.handle('service:focus-detached', (e, id) => {
  const w = detached.get(id);
  if (w && !w.isDestroyed()) {
    w.show();
    w.focus();
    return true;
  }
  return false;
});

ipcMain.handle('service:close-detached', (e, id) => {
  const w = detached.get(id);
  if (w && !w.isDestroyed()) w.close();
  if (settings.bubblePos && settings.bubblePos[id]) {
    const { [id]: _gone, ...rest } = settings.bubblePos;
    settings.bubblePos = rest;
    persistSettings();
  }
  return true;
});

// [{ id, count }] — the count lets the rail badge bubbles restored before it loaded.
ipcMain.handle('service:list-detached', () =>
  [...detached.keys()].map((id) => ({ id, count: detachedUnread.get(id) || 0 })));

// From a floating bubble window
ipcMain.on('bubble:resize', (e, mode) => resizeBubble(e.sender, mode));
ipcMain.on('bubble:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.close();
});
// A floating bubble reports its unread count so the rail badge + tray total stay right.
ipcMain.on('bubble:unread', (e, { id, count, increased }) => {
  detachedUnread.set(id, count);
  if (win && !win.isDestroyed()) win.webContents.send('bubbly:detached-unread', { id, count, increased });
});

// Remember a service's zoom level (set with Ctrl +/-/0 in the rail or a bubble).
ipcMain.handle('service:set-zoom', (e, { id, zoom }) => {
  const services = settings.services.map((s) => (s.id === id ? { ...s, zoom } : s));
  applySettings({ services });
  return true;
});

ipcMain.on('bubble:focus', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) { w.show(); w.focus(); }
});

ipcMain.on('bubble:reveal', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) w.restore();
    w.showInactive();          // bring the head forward without stealing focus
  }
});

// ---------------------------------------------------------------------------
// Webview hardening + login-popup handling
// ---------------------------------------------------------------------------
const ZOOM_KEYS = new Set(['=', '+', '-', '_', '0']);
const hardenedSessions = new WeakSet();

const AUTH_HINTS = /accounts\.google|appleid\.apple|login\.live|login\.microsoft|facebook\.com\/(login|dialog|oauth)|oauth|signin|sign-in|auth|sso/i;

app.on('web-contents-created', (event, contents) => {
  // Our own windows host <webview>s: make sure every one is locked down, no matter
  // what attributes end up on the tag, and only ever loads http(s) pages.
  if (contents.getType() === 'window') {
    contents.on('will-attach-webview', (e, webPreferences, params) => {
      // only our own tiny, sandboxed preload (relays notification clicks)
      webPreferences.preload = path.join(__dirname, 'webview-preload.js');
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (!/^https?:\/\//i.test(params.src || '')) e.preventDefault();
    });
    return;
  }
  if (contents.getType() !== 'webview') return;

  // Ctrl +/-/0 typed inside a chat: the keystroke goes to the page, not to our UI,
  // so catch it here and let the host window zoom (and remember) that service.
  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (!ZOOM_KEYS.has(input.key)) return;
    e.preventDefault();
    const host = contents.hostWebContents;
    if (host && !host.isDestroyed()) host.send('bubbly:zoom-key', input.key);
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (AUTH_HINTS.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          alwaysOnTop: true
        }
      };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // One handler per session (each service has its own persist:<id> partition).
  if (!hardenedSessions.has(contents.session)) {
    hardenedSessions.add(contents.session);
    contents.session.setPermissionRequestHandler((wc, permission, cb) => {
      cb(['notifications', 'media', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock'].includes(permission));
    });
  }

  // Neutralize WebAuthn as early as each document is ready (and after SPA
  // navigations), so no Windows passkey dialog can pop while blocking is on.
  const injectPasskeyPatch = () => {
    if (settings.blockPasskeys === false) return;
    contents.executeJavaScript(PASSKEY_PATCH, true).catch(() => {});
  };
  contents.on('dom-ready', injectPasskeyPatch);
  contents.on('did-navigate', injectPasskeyPatch);
  contents.on('did-navigate-in-page', injectPasskeyPatch);

  // Notification-click hook (only chat views have the relay preload).
  if (contents.hostWebContents) {
    contents.on('dom-ready', () => contents.executeJavaScript(NOTIFY_PATCH, true).catch(() => {}));
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win && !win.isVisible()) reveal('manual');
  });

  app.whenReady().then(() => {
    // Bring back bubbles that were floating when Bubbly last quit. Created before
    // the rail so its first listDetached() already knows about them.
    const restore = (settings.floating || []).map(floatTarget).filter(Boolean);
    settings.floating = [];
    for (const t of restore) createBubbleWindow(t);

    hotkeyOk = bindHotkey(settings.hotkey);
    createWindow();
    createTray();

    if (!hotkeyOk) {
      const hk = displayAccelerator(settings.hotkey);
      console.warn(`${hk} is taken by another app — use the tray icon to show Bubbly.`);
      if (process.platform === 'win32') {
        tray.displayBalloon({
          title: 'Bubbly shortcut unavailable',
          content: `${hk} is used by another app. Pick a new show/hide shortcut in Bubbly's Settings.`
        });
      }
    }

    screen.on('display-metrics-changed', () => animateTo(targetBounds(), 0));
    screen.on('work-area-size-changed', () => animateTo(targetBounds(), 0));
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
