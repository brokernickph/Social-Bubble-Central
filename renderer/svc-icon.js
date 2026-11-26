'use strict';

/* global LOGOS, catalogByType */

// One place that draws service + chat icons, shared by the rail, panel header,
// catalog cards and floating bubbles.
//
//   service: brand logo (bundled, see logos.js) on the service colour
//            → falls back to the site's favicon → falls back to a letter
//   chat:    the chat's initials on the service colour, with a small
//            service-logo badge in the corner

const SVG_NS = 'http://www.w3.org/2000/svg';

// White glyph on dark brand colours, near-black on light ones (e.g. Snapchat yellow).
function glyphColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#111318' : '#fff';
}

function initials(name) {
  const words = String(name || '?').trim().replace(/^[#@]/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const a = words[0][0] || '?';
  const b = words.length > 1 ? words[words.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function logoSvg(type, fill) {
  const logo = typeof LOGOS !== 'undefined' && LOGOS[type];
  if (!logo) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('logo');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', logo.path);
  p.setAttribute('fill', fill);
  svg.appendChild(p);
  return svg;
}

function faviconUrl(svc) {
  const cat = catalogByType(svc.type);
  let domain = cat && cat.domain;
  if (!domain) {
    try { domain = new URL(svc.url).hostname; } catch { domain = null; }
  }
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

// Fill `el` (a circle) with the service's icon.
function fillServiceIcon(el, svc) {
  el.textContent = '';
  el.classList.remove('has-img', 'has-logo');
  const color = svc.color || '#666';
  el.style.background = color;

  const svg = logoSvg(svc.type, glyphColor(color));
  if (svg) {
    el.classList.add('has-logo');
    el.appendChild(svg);
    return el;
  }
  const letter = () => { el.textContent = (svc.name || '?')[0].toUpperCase(); };
  const url = faviconUrl(svc);
  if (!url) { letter(); return el; }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.addEventListener('load', () => el.classList.add('has-img'));
  img.addEventListener('error', () => { img.remove(); letter(); });
  el.appendChild(img);
  return el;
}

// Fill `el` with a pinned chat's icon: initials + a small service badge.
function fillChatIcon(el, chat, svc) {
  el.textContent = '';
  el.classList.remove('has-img', 'has-logo');
  const color = svc.color || '#666';
  el.style.background = color;
  el.style.color = glyphColor(color);
  const txt = document.createElement('span');
  txt.className = 'initials';
  txt.textContent = initials(chat.name);
  el.appendChild(txt);

  const mini = document.createElement('span');
  mini.className = 'svc-mini';
  fillServiceIcon(mini, svc);
  el.appendChild(mini);
  return el;
}

function newIcon(cls, fill) {
  const el = document.createElement('div');
  el.className = cls;
  fill(el);
  return el;
}

if (typeof module !== 'undefined') module.exports = { glyphColor, initials };
