'use strict';

/* global catalogByType, applyTweaks, nextZoom */

const svc = JSON.parse(new URLSearchParams(location.search).get('svc') || '{}');

const ICONS = {
  reload: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  min: 'M6 19h12v2H6z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
};
const svg = (n) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${ICONS[n]}"/></svg>`;

function faviconUrl(s) {
  const cat = catalogByType(s.type);
  let domain = cat && cat.domain;
  if (!domain) { try { domain = new URL(s.url).hostname; } catch { domain = null; } }
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

function fillIcon(el, big) {
  el.style.background = svc.color || '#666';
  const url = faviconUrl(svc);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); el.textContent = (svc.name || '?')[0].toUpperCase(); el.style.background = svc.color || '#666'; });
    img.addEventListener('load', () => { el.style.background = big ? 'rgba(255,255,255,0.06)' : 'transparent'; });
    el.appendChild(img);
  } else {
    el.textContent = (svc.name || '?')[0].toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// Build UI
// ---------------------------------------------------------------------------
document.title = `${svc.name} — Bubbly`;
document.getElementById('bar-name').textContent = svc.name || 'Chat';
fillIcon(document.getElementById('head-icon'), true);
const barIcon = document.getElementById('bar-icon');
const barIconWrap = document.createElement('span');
barIconWrap.style.display = 'flex';
fillIcon(barIconWrap, false);
barIcon.appendChild(barIconWrap);

document.getElementById('btn-reload').innerHTML = svg('reload');
document.getElementById('btn-min').innerHTML = svg('min');
document.getElementById('btn-close').innerHTML = svg('close');

// webview
const wv = document.createElement('webview');
wv.setAttribute('partition', 'persist:' + svc.id);   // shares the rail's login
wv.setAttribute('allowpopups', '');
wv.setAttribute('webpreferences', 'backgroundThrottling=false,contextIsolation=true,sandbox=true');
wv.src = svc.url;
document.getElementById('host').appendChild(wv);

wv.addEventListener('dom-ready', () => applyTweaks(wv, svc));

// Ctrl +/-/0 inside the chat → zoom this bubble and remember it for the service.
window.bubbleApi.onZoomKey((key) => {
  try {
    const z = nextZoom(wv.getZoomFactor(), key, svc.type);
    wv.setZoomFactor(z);
    svc.zoom = z;
    window.bubbleApi.setZoom(svc.id, z);
  } catch { /* not ready */ }
});

// ---------------------------------------------------------------------------
// Collapse / expand
// ---------------------------------------------------------------------------
let collapsed = false;

function setCollapsed(v) {
  collapsed = v;
  document.body.classList.toggle('collapsed', v);
  window.bubbleApi.resize(v ? 'collapsed' : 'expanded');
  if (!v) { clearPulse(); markSeen(); }
}

document.getElementById('btn-min').addEventListener('click', () => setCollapsed(true));
document.getElementById('head').addEventListener('click', (e) => {
  // ignore the tiny drags that end as clicks
  if (dragMoved) { dragMoved = false; return; }
  setCollapsed(false);
});
document.getElementById('btn-close').addEventListener('click', () => window.bubbleApi.close());
document.getElementById('btn-reload').addEventListener('click', () => { try { wv.reload(); } catch { /* not ready */ } });

// distinguish a real click from a drag-release on the head
let dragMoved = false;
let downX = 0, downY = 0;
document.getElementById('head').addEventListener('mousedown', (e) => { downX = e.screenX; downY = e.screenY; dragMoved = false; });
document.getElementById('head').addEventListener('mousemove', (e) => {
  if (e.buttons && (Math.abs(e.screenX - downX) > 4 || Math.abs(e.screenY - downY) > 4)) dragMoved = true;
});

// start expanded (the window opens at panel size)
document.body.classList.remove('collapsed');

// ---------------------------------------------------------------------------
// Unread → head badge + pulse
// ---------------------------------------------------------------------------
let unread = 0;
const bornAt = Date.now();

function markSeen() { updateBadge(); }

function updateBadge() {
  const shown = collapsed ? unread : 0;   // only badge the collapsed head
  const badge = document.getElementById('head-badge');
  badge.hidden = shown <= 0;
  badge.textContent = shown > 99 ? '99+' : String(shown);
}

function setUnread(n) {
  n = Math.max(0, n | 0);
  const prev = unread;
  unread = n;
  updateBadge();
  const settled = Date.now() - bornAt > 12000;
  if (n !== prev) window.bubbleApi.reportUnread({ id: svc.id, count: n, increased: n > prev && settled });
  if (collapsed && n > prev && settled) {
    const head = document.getElementById('head');
    head.classList.remove('pulse'); void head.offsetWidth; head.classList.add('pulse');
    window.bubbleApi.reveal();
  }
}
function clearPulse() { document.getElementById('head').classList.remove('pulse'); }

wv.addEventListener('page-title-updated', (e) => {
  const m = (e.title || '').match(/\((\d+)\+?\)/);
  if (m) setUnread(parseInt(m[1], 10));
  else if (!catalogByType(svc.type)?.probe) setUnread(0);
});

// probe-based services (e.g. Instagram) whose title has no count
const probe = catalogByType(svc.type)?.probe;
if (probe) {
  setInterval(() => {
    try { wv.executeJavaScript(probe, false).then((v) => { if (typeof v === 'number' && v >= 0) setUnread(v); }).catch(() => {}); }
    catch { /* not ready */ }
  }, 20000);
}

// open external links via the main process (defensive; webview popups handled in main)
wv.addEventListener('new-window', (e) => {
  if (/^https?:\/\//i.test(e.url)) window.bubbleApi.openExternal(e.url);
});
