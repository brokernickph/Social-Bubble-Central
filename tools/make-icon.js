'use strict';

// Generates build/icon.ico (multi-size) + a build/icon-256.png preview for the
// Bubbly app — a violet→cyan gradient bubble with a white chat glyph. No image
// dependencies: draws to an RGBA buffer, encodes PNG (zlib) and wraps in ICO.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- CRC32 (for PNG chunks) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function encodeICO(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const entries = [];
  const datas = [];
  for (const im of images) {
    const e = Buffer.alloc(16);
    e[0] = im.size >= 256 ? 0 : im.size;   // 0 means 256
    e[1] = im.size >= 256 ? 0 : im.size;
    e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4);   // color planes
    e.writeUInt16LE(32, 6);  // bits per pixel
    e.writeUInt32LE(im.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += im.png.length;
    entries.push(e); datas.push(im.png);
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

// ---- Draw the Bubbly icon at a given size ----
const lerp = (a, b, t) => a + (b - a) * t;

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const r = size * 0.47;
  const c1 = [124, 92, 255];   // --accent
  const c2 = [77, 201, 255];   // --accent-2

  // chat-bubble glyph geometry
  const bw = size * 0.52, bh = size * 0.36;
  const bx0 = cx - bw / 2, by0 = cy - bh / 2 - size * 0.02;
  const bx1 = bx0 + bw, by1 = by0 + bh;
  const rr = bh * 0.36;
  const dotR = size * 0.043, dotY = (by0 + by1) / 2, gap = size * 0.115;

  const inCircle = (x, y) => Math.hypot(x - cx, y - cy) <= r;

  const inRoundRect = (x, y) => {
    const ix = Math.min(Math.max(x, bx0 + rr), bx1 - rr);
    const iy = Math.min(Math.max(y, by0 + rr), by1 - rr);
    if (x >= bx0 && x <= bx1 && y >= by0 + rr && y <= by1 - rr) return true;
    if (y >= by0 && y <= by1 && x >= bx0 + rr && x <= bx1 - rr) return true;
    return Math.hypot(x - ix, y - iy) <= rr;
  };

  // little tail pointing down-left below the bubble
  const inTail = (x, y) => {
    const ax = bx0 + bw * 0.30, ay = by1 - 1;
    const bx = bx0 + bw * 0.10, by = by1 + size * 0.10;
    const cxx = bx0 + bw * 0.46, cyy = by1 - 1;
    const s = (p, q, mrx, mry, nx, ny) => (mrx - p) * (ny - q) - (nx - p) * (mry - q);
    const d1 = s(x, y, ax, ay, bx, by);
    const d2 = s(x, y, bx, by, cxx, cyy);
    const d3 = s(x, y, cxx, cyy, ax, ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const inDots = (x, y) =>
    Math.hypot(x - (cx - gap), y - dotY) <= dotR ||
    Math.hypot(x - cx, y - dotY) <= dotR ||
    Math.hypot(x - (cx + gap), y - dotY) <= dotR;

  const inGlyph = (x, y) => (inRoundRect(x, y) || inTail(x, y)) && !inDots(x, y);

  // 3x3 supersample coverage
  const cover = (fn, px, py) => {
    let n = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      if (fn(px + (sx + 0.5) / 3, py + (sy + 0.5) / 3)) n++;
    }
    return n / 9;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cc = cover(inCircle, x, y);
      if (cc <= 0) continue;
      const t = (x + y) / (2 * size);
      let R = lerp(c1[0], c2[0], t);
      let G = lerp(c1[1], c2[1], t);
      let B = lerp(c1[2], c2[2], t);
      const gc = cover(inGlyph, x, y);
      if (gc > 0) { R = lerp(R, 255, gc); G = lerp(G, 255, gc); B = lerp(B, 255, gc); }
      buf[i] = Math.round(R);
      buf[i + 1] = Math.round(G);
      buf[i + 2] = Math.round(B);
      buf[i + 3] = Math.round(255 * cc);
    }
  }
  return buf;
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, png: encodePNG(draw(size), size, size) }));
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(images));
fs.writeFileSync(path.join(outDir, 'icon-256.png'), images[images.length - 1].png);
console.log('Wrote build/icon.ico (' + sizes.join(', ') + ') and build/icon-256.png');
