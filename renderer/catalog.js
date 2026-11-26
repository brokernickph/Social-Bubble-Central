'use strict';

// Catalog of chat services. Each becomes a webview with its own persistent
// login session (partition "persist:<service id>").
//
// probe: optional JS evaluated inside the service page that resolves to an
// unread count (or -1 for "unknown"). Title parsing "(n)" is the generic path.
// css/zoom: optional per-service tweaks injected into the page so desktop web
// apps stay usable inside Bubbly's narrow panel (see catalogTweaks()).

// Discord crams a 72px server rail + 240px channel list + members list into the
// layout, leaving almost nothing for chat in a narrow panel. Hide the chrome we
// don't need and let the message column breathe.
const DISCORD_CSS = `
  nav[aria-label="Servers sidebar"] { display: none !important; }
  [class*="guilds_"] { display: none !important; }
  [class*="membersWrap_"], [class*="members_"][class*="container"] { display: none !important; }
  [class*="base_"] { min-width: 0 !important; }
  [class*="sidebar_"] { width: 210px !important; min-width: 210px !important; }
  [class*="content_"], [class*="chat_"], [class*="chatContent_"] { min-width: 0 !important; }
`;

const CATALOG = [
  {
    type: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/direct/inbox/',
    domain: 'instagram.com',
    color: '#E1306C',
    probe: `(function(){try{
      var a=document.querySelector('a[href*="/direct"]');if(!a)return -1;
      var els=a.querySelectorAll('span,div');
      for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').trim();
        if(/^\\d{1,3}$/.test(t))return parseInt(t,10);}
      return 0;}catch(e){return -1}})()`
  },
  {
    type: 'discord',
    name: 'Discord',
    url: 'https://discord.com/channels/@me',
    domain: 'discord.com',
    color: '#5865F2',
    zoom: 0.8,
    css: DISCORD_CSS
  },
  {
    type: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    domain: 'whatsapp.com',
    color: '#25D366'
  },
  {
    type: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/a/',
    domain: 'telegram.org',
    color: '#2AABEE'
  },
  {
    type: 'messenger',
    name: 'Messenger',
    url: 'https://www.messenger.com/',
    domain: 'messenger.com',
    color: '#A334FA'
  },
  {
    type: 'slack',
    name: 'Slack',
    url: 'https://app.slack.com/client',
    domain: 'slack.com',
    color: '#611F69'
  },
  {
    type: 'x',
    name: 'X Messages',
    url: 'https://x.com/messages',
    domain: 'x.com',
    color: '#1D9BF0'
  },
  {
    type: 'reddit',
    name: 'Reddit Chat',
    url: 'https://chat.reddit.com/',
    domain: 'reddit.com',
    color: '#FF4500'
  },
  {
    type: 'googlechat',
    name: 'Google Chat',
    url: 'https://chat.google.com/',
    domain: 'google.com',
    color: '#00AC47'
  },
  {
    type: 'linkedin',
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/messaging/',
    domain: 'linkedin.com',
    color: '#0A66C2'
  },
  {
    type: 'snapchat',
    name: 'Snapchat',
    url: 'https://web.snapchat.com/',
    domain: 'snapchat.com',
    color: '#FFFC00'
  },
  {
    type: 'steam',
    name: 'Steam Chat',
    url: 'https://steamcommunity.com/chat/',
    domain: 'steamcommunity.com',
    color: '#66C0F4'
  }
];

// Unread count from a page title. Chat apps put it first ("(3) Discord") or
// last ("Inbox (3)"); a number elsewhere ("Notes (2024) draft") isn't a count.
function titleUnread(title) {
  const t = String(title || '');
  const m = t.match(/^\s*\((\d{1,4})\+?\)/) || t.match(/\((\d{1,3})\+?\)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

function catalogByType(type) {
  return CATALOG.find((c) => c.type === type) || null;
}

// Per-service layout tweaks ({ css, zoom }) for a given service type.
function catalogTweaks(type) {
  const c = catalogByType(type);
  return c ? { css: c.css || '', zoom: c.zoom || 1 } : { css: '', zoom: 1 };
}

// Apply the tweaks to a live <webview> (call on dom-ready). A zoom the user
// picked for this service (svc.zoom, a zoom factor) wins over the catalog default.
function applyTweaks(wv, svcOrType) {
  const svc = typeof svcOrType === 'string' ? { type: svcOrType } : svcOrType;
  const { css, zoom } = catalogTweaks(svc.type);
  const z = Number.isFinite(svc.zoom) ? svc.zoom : zoom;
  try { if (z !== 1) wv.setZoomFactor(z); } catch { /* not ready */ }
  try { if (css) wv.insertCSS(css); } catch { /* not ready */ }
}

// Ctrl +/-/0 → next zoom factor. "0" resets to the service's catalog default
// (e.g. Discord's 0.8 fit), not to 100%.
function nextZoom(current, key, type) {
  if (key === '0') return catalogTweaks(type).zoom;
  const step = (key === '-' || key === '_') ? -0.1 : 0.1;
  return Math.round(Math.min(3, Math.max(0.3, current + step)) * 100) / 100;
}

if (typeof module !== 'undefined') module.exports = { CATALOG, catalogByType, catalogTweaks, nextZoom, titleUnread };
