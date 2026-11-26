'use strict';

/* global CATALOG, catalogByType, applyTweaks, nextZoom, titleUnread, acceleratorFromEvent, displayAccelerator */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let settings = null;
let expandedState = false;
let activeId = null;         // service id currently shown in the panel
let currentView = null;      // 'service' | 'settings' | 'add' | 'onboarding' | 'empty'
let windowVisible = true;
let peeking = false;         // slid into the edge, sliver showing
let peekGuard = 0;           // ignore mouse right after sliding away
let popRequested = false;    // a slide-out request is in flight
let lastActivity = Date.now();
let graceUntil = 0;          // no auto-hide until this timestamp (after reveals)

const webviews = new Map();  // id -> <webview>
const titleCounts = new Map();
const probeCounts = new Map();
const unread = new Map();
const baseline = new Map();  // id -> creation ts (ignore "increases" right after load)
const detachedIds = new Set(); // services currently popped out to their own window

// ---------------------------------------------------------------------------
// DOM handles
// ---------------------------------------------------------------------------
const appEl = document.getElementById('app');
const panel = document.getElementById('panel');
const viewsEl = document.getElementById('views');
const bubblesEl = document.getElementById('bubbles');
const panelName = document.getElementById('panel-name');
const panelIcon = document.getElementById('panel-icon');
const toastEl = document.getElementById('toast');

const ICONS = {
  reload: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  external: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  collapse: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  ghost: 'M12 2a7 7 0 0 0-7 7v12l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V9a7 7 0 0 0-7-7z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  detach: 'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V7h18v12zm-2-2h-6v-4h6v4z'
};

function svg(name) {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${ICONS[name]}"/></svg>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getSvc(id) {
  return settings.services.find((s) => s.id === id) || null;
}

function faviconUrl(svc) {
  const cat = catalogByType(svc.type);
  let domain = cat && cat.domain;
  if (!domain) {
    try { domain = new URL(svc.url).hostname; } catch { domain = null; }
  }
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

// Icon node: favicon <img>, falling back to a colored monogram circle
function iconNode(svc, cls) {
  const wrap = document.createElement('div');
  wrap.className = cls;
  wrap.style.background = svc.color || '#666';
  const url = faviconUrl(svc);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('load', () => wrap.classList.add('has-img'));
    img.addEventListener('error', () => { img.remove(); wrap.textContent = svc.name[0].toUpperCase(); });
    wrap.appendChild(img);
  } else {
    wrap.textContent = svc.name[0].toUpperCase();
  }
  return wrap;
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

function bump() {
  lastActivity = Date.now();
  // hovering the sliver while tucked away slides the rail back out
  if (peeking && !popRequested && Date.now() > peekGuard) {
    popRequested = true;
    window.bubbly.setMode('out');
  }
}

// ---------------------------------------------------------------------------
// Expand / collapse (window physically resizes so it never blocks clicks;
// the panel itself slides in from the edge via CSS for a smooth feel)
// ---------------------------------------------------------------------------
async function setExpanded(v) {
  if (expandedState === v) return;
  expandedState = v;
  bump();
  if (v) {
    await window.bubbly.setExpanded(true);
    appEl.classList.remove('collapsed');
    panel.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('open')));
  } else {
    panel.classList.remove('open');
    await new Promise((r) => setTimeout(r, 200)); // let the slide-out play
    panel.hidden = true;
    appEl.classList.add('collapsed');
    currentView = null;
    renderBubbles();          // drop the active bubble ring
    for (const el of ['rail-settings', 'rail-add', 'btn-settings']) {
      document.getElementById(el).classList.remove('on');
    }
    await window.bubbly.setExpanded(false);
  }
}

function showStaticView(name) {
  for (const el of viewsEl.querySelectorAll('.static-view')) el.hidden = true;
  for (const wv of webviews.values()) wv.classList.add('hidden-view');
  const el = document.getElementById('view-' + name);
  if (el) el.hidden = false;
  currentView = name;
  updateHeader();
}

async function openService(id) {
  const svc = getSvc(id);
  if (!svc) return;
  if (detachedIds.has(id)) { window.bubbly.focusDetached(id); return; }
  await setExpanded(true);
  activeId = id;
  currentView = 'service';
  for (const el of viewsEl.querySelectorAll('.static-view')) el.hidden = true;
  for (const [sid, wv] of webviews) wv.classList.toggle('hidden-view', sid !== id);
  ensureWebview(svc).classList.remove('hidden-view');
  updateHeader();
  renderBubbles();
}

// Pop a service out into its own standalone window (shares the same login).
async function detachService(id) {
  const svc = getSvc(id);
  if (!svc || detachedIds.has(id)) { if (svc) window.bubbly.focusDetached(id); return; }
  detachedIds.add(id);
  const keep = unread.get(id) || 0;   // the bubble reports its own count from here on
  destroyWebview(id);                 // stop the in-panel copy so it isn't running twice
  unread.set(id, keep);
  await window.bubbly.detachService(svc);
  toast(`${svc.name} popped out as a floating bubble`);

  // leave the panel showing something sensible
  if (activeId === id) {
    const next = settings.services.find((s) => !detachedIds.has(s.id));
    if (next) openService(next.id);
    else setExpanded(false);
  }
  renderBubbles();
}

async function openPanelView(name) {
  await setExpanded(true);
  activeId = null;
  showStaticView(name);
  renderBubbles();
}

function updateHeader() {
  const svc = activeId ? getSvc(activeId) : null;
  panelIcon.innerHTML = '';
  if (svc) {
    panelName.textContent = svc.name;
    const url = faviconUrl(svc);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      panelIcon.appendChild(img);
    }
  } else {
    const titles = { settings: 'Settings', add: 'Add a service', onboarding: 'Welcome', empty: 'Bubbly' };
    panelName.textContent = titles[currentView] || 'Bubbly';
  }
  document.getElementById('btn-reload').style.display = svc ? '' : 'none';
  document.getElementById('btn-detach').style.display = svc ? '' : 'none';
  document.getElementById('btn-external').style.display = svc ? '' : 'none';

  // highlight the rail nav item whose view is showing (so it reads as a toggle)
  const open = expandedState ? currentView : null;
  document.getElementById('rail-settings').classList.toggle('on', open === 'settings');
  document.getElementById('rail-add').classList.toggle('on', open === 'add');
  document.getElementById('btn-settings').classList.toggle('on', open === 'settings');
}

// ---------------------------------------------------------------------------
// Webviews
// ---------------------------------------------------------------------------
function ensureWebview(svc) {
  let wv = webviews.get(svc.id);
  if (wv) return wv;

  wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:' + svc.id);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('webpreferences', 'backgroundThrottling=false,contextIsolation=true,sandbox=true');
  wv.classList.add('hidden-view');
  wv.src = svc.url;
  viewsEl.appendChild(wv);
  webviews.set(svc.id, wv);
  baseline.set(svc.id, Date.now());

  wv.addEventListener('page-title-updated', (e) => {
    titleCounts.set(svc.id, titleUnread(e.title));
    recomputeUnread(svc.id);
  });

  // Clicking one of this chat's desktop notifications → show Bubbly on that chat.
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel !== 'notification-click') return;
    window.bubbly.showWindow();
    openService(svc.id);
  });

  // Inject per-service layout fixes (e.g. make Discord usable when narrow).
  wv.addEventListener('dom-ready', () => applyTweaks(wv, getSvc(svc.id) || svc));

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3 && e.isMainFrame) {
      toast(`${svc.name} failed to load — right-click its bubble to reload`);
    }
  });

  return wv;
}

function destroyWebview(id) {
  const wv = webviews.get(id);
  if (wv) wv.remove();
  webviews.delete(id);
  titleCounts.delete(id);
  probeCounts.delete(id);
  unread.delete(id);
  baseline.delete(id);
}

// Stagger-load every service so unread detection works without a burst
function preloadWebviews() {
  let delay = 400;
  for (const svc of settings.services) {
    if (webviews.has(svc.id) || detachedIds.has(svc.id)) continue;
    setTimeout(() => { if (getSvc(svc.id) && !detachedIds.has(svc.id)) ensureWebview(svc); }, delay);
    delay += 2200;
  }
}

// DOM probes for services whose page title never shows a count (e.g. Instagram)
setInterval(() => {
  for (const svc of settings ? settings.services : []) {
    const cat = catalogByType(svc.type);
    const wv = webviews.get(svc.id);
    if (!cat || !cat.probe || !wv) continue;
    try {
      wv.executeJavaScript(cat.probe, false).then((v) => {
        probeCounts.set(svc.id, typeof v === 'number' ? v : -1);
        recomputeUnread(svc.id);
      }).catch(() => {});
    } catch { /* webview not ready yet */ }
  }
}, 20000);

// ---------------------------------------------------------------------------
// Unread tracking
// ---------------------------------------------------------------------------
function recomputeUnread(id) {
  const t = titleCounts.get(id) || 0;
  const p = probeCounts.has(id) ? probeCounts.get(id) : -1;
  setUnread(id, p >= 0 ? Math.max(p, t) : t);
}

function unreadTotal() {
  return settings.services.reduce((sum, s) => sum + (s.muted ? 0 : (unread.get(s.id) || 0)), 0);
}

// Tell main (tray + ghost reveal) and the rail glow about the current total.
function pushTotal(increased = false) {
  const total = unreadTotal();
  document.body.classList.toggle('has-unread', total > 0);
  window.bubbly.updateUnread({ total, increased });
}

// opts.increased overrides the settle heuristic (used for floating bubbles,
// which run their own settle window).
function setUnread(id, count, opts = {}) {
  const svc = getSvc(id);
  if (!svc) return;
  count = Math.max(0, count | 0);
  const prev = unread.get(id) || 0;
  if (count === prev) return;
  unread.set(id, count);
  updateBadge(id);

  const settled = Date.now() - (baseline.get(id) || 0) > 15000;
  const increased = !svc.muted && (opts.increased ?? (count > prev && settled));

  if (increased) {
    const b = bubblesEl.querySelector(`[data-id="${id}"]`);
    if (b) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
  }
  pushTotal(increased);
}

// Zoom the given service's webview and remember the level.
function zoomService(id, key) {
  const svc = getSvc(id);
  const wv = webviews.get(id);
  if (!svc || !wv) return;
  try {
    const z = nextZoom(wv.getZoomFactor(), key, svc.type);
    wv.setZoomFactor(z);
    svc.zoom = z;
    window.bubbly.setZoom(id, z);
    toast(`${svc.name} zoom ${Math.round(z * 100)}%`);
  } catch { /* not ready */ }
}

function updateBadge(id) {
  const b = bubblesEl.querySelector(`[data-id="${id}"] .badge`);
  if (!b) return;
  const n = unread.get(id) || 0;
  b.hidden = n <= 0;
  b.textContent = n > 99 ? '99+' : String(n);
}

// ---------------------------------------------------------------------------
// Rail bubbles
// ---------------------------------------------------------------------------
let draggedId = null;
let recordingHotkey = false;

function renderBubbles() {
  bubblesEl.innerHTML = '';
  for (const svc of settings.services) {
    const b = document.createElement('button');
    b.className = 'bubble';
    b.dataset.id = svc.id;
    const isDetached = detachedIds.has(svc.id);
    b.title = isDetached ? `${svc.name} (floating bubble — click to show)` : svc.name;
    b.draggable = true;
    if (svc.id === activeId && expandedState) b.classList.add('active');
    if (svc.muted) b.classList.add('muted');
    if (isDetached) b.classList.add('detached');

    b.appendChild(iconNode(svc, 'monogram'));
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    b.appendChild(badge);
    if (isDetached) {
      const pin = document.createElement('span');
      pin.className = 'detach-dot';
      pin.innerHTML = svg('detach');
      b.appendChild(pin);
    }

    b.addEventListener('click', () => {
      if (activeId === svc.id && expandedState) setExpanded(false);
      else openService(svc.id);
    });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); bubbleMenu(svc); });

    b.addEventListener('dragstart', () => { draggedId = svc.id; b.classList.add('dragging'); });
    b.addEventListener('dragend', () => {
      b.classList.remove('dragging');
      draggedId = null;
      persistBubbleOrder();
    });
    b.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedId || draggedId === svc.id) return;
      const dragged = bubblesEl.querySelector(`[data-id="${draggedId}"]`);
      if (!dragged) return;
      const rect = b.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      bubblesEl.insertBefore(dragged, before ? b : b.nextSibling);
    });

    bubblesEl.appendChild(b);
    updateBadge(svc.id);
  }
}

function persistBubbleOrder() {
  const order = [...bubblesEl.querySelectorAll('.bubble')].map((el) => el.dataset.id);
  settings.services.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  window.bubbly.saveSettings({ services: settings.services });
}

async function bubbleMenu(svc) {
  const action = await window.bubbly.bubbleMenu({ id: svc.id, name: svc.name, muted: !!svc.muted });
  switch (action) {
    case 'open':
      openService(svc.id);
      break;
    case 'detach':
      detachService(svc.id);
      break;
    case 'focus-detached':
      window.bubbly.focusDetached(svc.id);
      break;
    case 'reload': {
      if (detachedIds.has(svc.id)) { window.bubbly.focusDetached(svc.id); break; }
      const wv = webviews.get(svc.id) || ensureWebview(svc);
      try { wv.reload(); } catch { /* not ready */ }
      break;
    }
    case 'mute':
      svc.muted = !svc.muted;
      await window.bubbly.saveSettings({ services: settings.services });
      renderBubbles();
      pushTotal();
      toast(svc.muted ? `${svc.name} muted` : `${svc.name} unmuted`);
      break;
    case 'external': {
      const wv = webviews.get(svc.id);
      let url = svc.url;
      try { if (wv) url = wv.getURL() || svc.url; } catch { /* use default */ }
      window.bubbly.openExternal(url);
      break;
    }
    case 'remove':
      removeService(svc.id);
      break;
  }
}

function removeService(id) {
  const svc = getSvc(id);
  if (!svc) return;
  destroyWebview(id);
  if (detachedIds.has(id)) {          // also close its floating bubble
    detachedIds.delete(id);
    window.bubbly.closeDetached(id);
  }
  settings.services = settings.services.filter((s) => s.id !== id);
  window.bubbly.saveSettings({ services: settings.services });
  if (activeId === id) {
    activeId = null;
    if (settings.services.length) openService(settings.services[0].id);
    else openPanelView('empty');
  }
  renderBubbles();
  renderSettingsServices();
  toast(`${svc.name} removed`);
  pushTotal();
}

function addService(entry) {
  const id = entry.type + '-' + Math.random().toString(36).slice(2, 8);
  const svc = {
    id,
    type: entry.type,
    name: entry.name,
    url: entry.url,
    color: entry.color || '#7c5cff',
    muted: false
  };
  settings.services.push(svc);
  window.bubbly.saveSettings({ services: settings.services });
  renderBubbles();
  renderSettingsServices();
  ensureWebview(svc);
  return svc;
}

// ---------------------------------------------------------------------------
// Catalog grids (onboarding + add view)
// ---------------------------------------------------------------------------
function catalogCard(cat, { selectable } = {}) {
  const card = document.createElement('div');
  card.className = 'catalog-card';
  card.dataset.type = cat.type;
  card.appendChild(iconNode(cat, 'dot'));
  const label = document.createElement('span');
  label.textContent = cat.name;
  card.appendChild(label);
  if (selectable) {
    card.addEventListener('click', () => {
      card.classList.toggle('selected');
      const any = document.querySelector('#onboard-grid .selected');
      document.getElementById('onboard-start').disabled = !any;
    });
  }
  return card;
}

function buildOnboarding() {
  const grid = document.getElementById('onboard-grid');
  grid.innerHTML = '';
  for (const cat of CATALOG) grid.appendChild(catalogCard(cat, { selectable: true }));

  document.getElementById('onboard-start').addEventListener('click', async () => {
    const picked = [...document.querySelectorAll('#onboard-grid .selected')]
      .map((el) => catalogByType(el.dataset.type))
      .filter(Boolean);
    for (const cat of picked) addService(cat);
    settings.onboarded = true;
    await window.bubbly.saveSettings({ onboarded: true, services: settings.services });
    preloadWebviews();
    if (settings.services.length) openService(settings.services[0].id);
  });
}

function buildAddView() {
  const grid = document.getElementById('add-grid');
  grid.innerHTML = '';
  for (const cat of CATALOG) {
    const card = catalogCard(cat);
    card.addEventListener('click', () => {
      const svc = addService(cat);
      toast(`${cat.name} added`);
      openService(svc.id);
    });
    grid.appendChild(card);
  }

  document.getElementById('custom-add').addEventListener('click', () => {
    const name = document.getElementById('custom-name').value.trim();
    const url = document.getElementById('custom-url').value.trim();
    if (!name || !/^https?:\/\//i.test(url)) {
      toast('Enter a name and a valid https:// URL');
      return;
    }
    const svc = addService({ type: 'custom', name, url, color: '#5b6270' });
    document.getElementById('custom-name').value = '';
    document.getElementById('custom-url').value = '';
    toast(`${name} added`);
    openService(svc.id);
  });
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------
function syncSettingsView() {
  for (const btn of document.querySelectorAll('#seg-edge button')) {
    btn.classList.toggle('on', btn.dataset.edge === settings.edge);
  }
  const w = document.getElementById('rng-width');
  w.value = settings.panelWidth;
  document.getElementById('val-width').textContent = settings.panelWidth + 'px';

  const h = document.getElementById('rng-height');
  h.value = settings.panelHeight;
  document.getElementById('val-height').textContent = settings.panelHeight + 'px';

  const d = document.getElementById('rng-delay');
  d.value = settings.idleDelaySec;
  document.getElementById('val-delay').textContent = settings.idleDelaySec + 's';

  document.getElementById('tgl-ghost').classList.toggle('on', settings.ghostMode);
  document.getElementById('tgl-blur').classList.toggle('on', settings.collapseOnBlur);
  document.getElementById('tgl-startup').classList.toggle('on', settings.launchAtStartup);
  document.getElementById('tgl-passkey').classList.toggle('on', settings.blockPasskeys !== false);
  if (!recordingHotkey) document.getElementById('btn-hotkey').textContent = displayAccelerator(settings.hotkey);
  document.getElementById('hotkey-warn').hidden = settings.hotkeyOk !== false;
  renderSettingsServices();
}

function renderSettingsServices() {
  const box = document.getElementById('settings-services');
  if (!box) return;
  box.innerHTML = '';
  if (!settings.services.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No services yet — add one from the rail.';
    box.appendChild(p);
    return;
  }
  for (const svc of settings.services) {
    const row = document.createElement('div');
    row.className = 'svc-row';
    row.appendChild(iconNode(svc, 'dot'));
    const name = document.createElement('span');
    name.className = 'svc-name';
    name.textContent = svc.name;
    row.appendChild(name);

    const mute = document.createElement('button');
    mute.className = 'icon-btn';
    mute.title = svc.muted ? 'Unmute' : 'Mute';
    mute.innerHTML = svg('bell');
    mute.style.opacity = svc.muted ? 0.35 : 1;
    mute.addEventListener('click', async () => {
      svc.muted = !svc.muted;
      await window.bubbly.saveSettings({ services: settings.services });
      renderBubbles();
      renderSettingsServices();
      pushTotal();
    });
    row.appendChild(mute);

    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.title = 'Remove';
    del.innerHTML = svg('close');
    del.addEventListener('click', () => removeService(svc.id));
    row.appendChild(del);

    box.appendChild(row);
  }
}

function buildSettingsView() {
  for (const btn of document.querySelectorAll('#seg-edge button')) {
    btn.addEventListener('click', async () => {
      await window.bubbly.saveSettings({ edge: btn.dataset.edge });
    });
  }

  const w = document.getElementById('rng-width');
  w.addEventListener('input', () => {
    document.getElementById('val-width').textContent = w.value + 'px';
  });
  w.addEventListener('change', () => window.bubbly.saveSettings({ panelWidth: +w.value }));

  const h = document.getElementById('rng-height');
  h.addEventListener('input', () => {
    document.getElementById('val-height').textContent = h.value + 'px';
  });
  h.addEventListener('change', () => window.bubbly.saveSettings({ panelHeight: +h.value }));

  const d = document.getElementById('rng-delay');
  d.addEventListener('input', () => {
    document.getElementById('val-delay').textContent = d.value + 's';
  });
  d.addEventListener('change', () => window.bubbly.saveSettings({ idleDelaySec: +d.value }));

  document.getElementById('tgl-ghost').addEventListener('click', () =>
    window.bubbly.saveSettings({ ghostMode: !settings.ghostMode }));
  document.getElementById('tgl-blur').addEventListener('click', () =>
    window.bubbly.saveSettings({ collapseOnBlur: !settings.collapseOnBlur }));
  document.getElementById('tgl-startup').addEventListener('click', () =>
    window.bubbly.saveSettings({ launchAtStartup: !settings.launchAtStartup }));
  // Show/hide shortcut recorder: click, then press the new combination.
  const hk = document.getElementById('btn-hotkey');
  const stopRecording = () => {
    recordingHotkey = false;
    hk.classList.remove('recording');
    hk.textContent = displayAccelerator(settings.hotkey);
  };
  hk.addEventListener('click', () => {
    recordingHotkey = true;
    hk.classList.add('recording');
    hk.textContent = 'Press keys…';
  });
  hk.addEventListener('blur', () => { if (recordingHotkey) stopRecording(); });
  hk.addEventListener('keydown', async (e) => {
    if (!recordingHotkey) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stopRecording(); return; }
    const acc = acceleratorFromEvent(e);
    if (!acc) return;                 // still waiting for modifier + key
    recordingHotkey = false;
    const saved = await window.bubbly.saveSettings({ hotkey: acc });
    stopRecording();
    toast(saved.hotkey === acc && saved.hotkeyOk !== false
      ? `Show/hide shortcut set to ${displayAccelerator(acc)}`
      : `${displayAccelerator(acc)} is taken by another app — kept ${displayAccelerator(saved.hotkey)}`);
  });

  document.getElementById('tgl-passkey').addEventListener('click', () => {
    const next = !(settings.blockPasskeys !== false);
    document.getElementById('tgl-passkey').classList.toggle('on', next);
    toast(next ? 'Passkey prompts blocked — reloading chats' : 'Passkeys allowed — reloading chats');
    window.bubbly.saveSettings({ blockPasskeys: next });
  });
}

// ---------------------------------------------------------------------------
// Chrome (rail buttons, header buttons, keyboard)
// ---------------------------------------------------------------------------
function applyChrome() {
  appEl.classList.toggle('edge-left', settings.edge === 'left');
  appEl.classList.toggle('edge-right', settings.edge !== 'left');
  document.getElementById('rail-ghost').classList.toggle('on', settings.ghostMode);
  for (const el of document.querySelectorAll('.hotkey-label')) el.textContent = displayAccelerator(settings.hotkey);
}

function wireChrome() {
  document.getElementById('btn-reload').innerHTML = svg('reload');
  document.getElementById('btn-detach').innerHTML = svg('detach');
  document.getElementById('btn-external').innerHTML = svg('external');
  document.getElementById('btn-settings').innerHTML = svg('settings');
  document.getElementById('btn-collapse').innerHTML = svg('collapse');
  document.getElementById('rail-ghost').innerHTML = svg('ghost');
  document.getElementById('rail-settings').innerHTML = svg('settings');

  document.getElementById('btn-collapse').addEventListener('click', () => setExpanded(false));
  document.getElementById('btn-detach').addEventListener('click', () => {
    if (activeId) detachService(activeId);
  });
  document.getElementById('btn-reload').addEventListener('click', () => {
    const wv = activeId && webviews.get(activeId);
    if (wv) try { wv.reload(); } catch { /* not ready */ }
  });
  document.getElementById('btn-external').addEventListener('click', () => {
    const svc = activeId && getSvc(activeId);
    if (!svc) return;
    const wv = webviews.get(activeId);
    let url = svc.url;
    try { if (wv) url = wv.getURL() || svc.url; } catch { /* use default */ }
    window.bubbly.openExternal(url);
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    if (currentView === 'settings') backToService();
    else { openPanelView('settings'); syncSettingsView(); }
  });

  // rail nav items toggle: clicking the same one again collapses the panel
  document.getElementById('rail-add').addEventListener('click', () => {
    if (expandedState && currentView === 'add') setExpanded(false);
    else openPanelView('add');
  });
  document.getElementById('rail-settings').addEventListener('click', () => {
    if (expandedState && currentView === 'settings') { setExpanded(false); return; }
    openPanelView('settings');
    syncSettingsView();
  });
  document.getElementById('rail-ghost').addEventListener('click', async () => {
    await window.bubbly.saveSettings({ ghostMode: !settings.ghostMode });
    toast(settings.ghostMode
      ? `Ghost mode on — Bubbly hides until a message arrives (${displayAccelerator(settings.hotkey)} to show)`
      : 'Ghost mode off');
  });
  document.getElementById('empty-add').addEventListener('click', () => openPanelView('add'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentView !== 'onboarding') {
      if (currentView === 'settings' || currentView === 'add') backToService();
      else setExpanded(false);
    }
    // zoom the active webview (keys typed inside the chat arrive via onZoomKey)
    if (e.ctrlKey && activeId && currentView === 'service' && ['=', '+', '-', '_', '0'].includes(e.key)) {
      e.preventDefault();
      zoomService(activeId, e.key);
    }
  });

  document.addEventListener('mousemove', bump);
  document.addEventListener('mousedown', bump);
  document.addEventListener('wheel', bump, { passive: true });
}

function backToService() {
  if (activeId || !settings.services.length) {
    if (activeId) openService(activeId);
    else openPanelView('empty');
  } else {
    openService(settings.services[0].id);
  }
}

// ---------------------------------------------------------------------------
// Idle slide-away + ghost auto-hide
// ---------------------------------------------------------------------------
setInterval(() => {
  if (!settings || currentView === 'onboarding') return;
  const idle = Date.now() - lastActivity > settings.idleDelaySec * 1000;
  if (!idle || expandedState || Date.now() < graceUntil) return;

  if (settings.ghostMode) {
    if (windowVisible) {
      windowVisible = false;
      window.bubbly.hideWindow();
    }
  } else if (!peeking) {
    window.bubbly.setMode('peek');
  }
}, 1000);

// ---------------------------------------------------------------------------
// IPC events from main
// ---------------------------------------------------------------------------
window.bubbly.onMode((m) => {
  peeking = m === 'peek';
  popRequested = false;
  document.body.classList.toggle('peeking', peeking);
  if (peeking) peekGuard = Date.now() + 700;
  else lastActivity = Date.now();
});

window.bubbly.onActivity(() => { lastActivity = Date.now(); });

window.bubbly.onRevealed(({ reason }) => {
  windowVisible = true;
  graceUntil = Date.now() + (reason === 'notification' ? 12000 : 5000);
  bump();
  lastActivity = Date.now();
});

window.bubbly.onBlur(() => {
  if (settings && settings.collapseOnBlur && expandedState && currentView !== 'onboarding') {
    setExpanded(false);
  }
});

window.bubbly.onDetached((id) => {
  detachedIds.add(id);
  renderBubbles();
});

// A floating bubble's unread count (its webview lives in another window).
window.bubbly.onDetachedUnread(({ id, count, increased }) => {
  if (!detachedIds.has(id) && count > 0) return;
  setUnread(id, count, { increased: !!increased });
});

// Ctrl +/-/0 pressed inside a chat page in this window.
window.bubbly.onZoomKey((key) => {
  if (activeId && currentView === 'service') zoomService(activeId, key);
});

// Detached window was closed → the service comes back into the panel.
window.bubbly.onReattached((id) => {
  detachedIds.delete(id);
  renderBubbles();
  const svc = getSvc(id);
  if (svc) {
    ensureWebview(svc);              // keep tracking its unreads from the panel again
    toast(`${svc.name} is back in Bubbly`);
  }
});

window.bubbly.onSettingsChanged((s) => {
  const servicesChanged = JSON.stringify(s.services) !== JSON.stringify(settings.services);
  settings = s;
  applyChrome();
  if (currentView === 'settings') syncSettingsView();
  if (servicesChanged) { renderBubbles(); pushTotal(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
  settings = await window.bubbly.getSettings();
  const floating = await window.bubbly.listDetached();
  for (const { id } of floating) detachedIds.add(id);
  applyChrome();
  wireChrome();
  buildSettingsView();
  buildAddView();
  buildOnboarding();
  renderBubbles();
  for (const { id, count } of floating) if (count) setUnread(id, count, { increased: false });

  // keep the window height hugging the rail content (no full-edge dead zone)
  const railInner = document.getElementById('rail-inner');
  new ResizeObserver(() => {
    const r = railInner.getBoundingClientRect();
    window.bubbly.setRailSize({ h: Math.ceil(r.height) + 12 });
  }).observe(railInner);

  if (settings.hotkeyOk === false) {
    toast(`${displayAccelerator(settings.hotkey)} is taken by another app — pick a new shortcut in Settings`);
  }

  if (!settings.onboarded) {
    await openPanelView('onboarding');
  } else if (settings.services.length) {
    preloadWebviews();
  }
})();
