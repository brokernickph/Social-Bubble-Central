'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { glyphColor, initials } = require('../renderer/svc-icon.js');
const { LOGOS } = require('../renderer/logos.js');
const { CATALOG } = require('../renderer/catalog.js');

test('bundled logos cover the catalog (except brands simple-icons lacks)', () => {
  const missing = CATALOG.map((c) => c.type).filter((t) => !LOGOS[t]);
  assert.deepEqual(missing.sort(), ['linkedin', 'slack']);
  for (const [type, logo] of Object.entries(LOGOS)) {
    assert.match(logo.path, /^M/, `${type} path`);
  }
});

test('glyphColor picks a readable glyph colour', () => {
  assert.equal(glyphColor('#FFFC00'), '#111318');   // Snapchat yellow → dark glyph
  assert.equal(glyphColor('#5865F2'), '#fff');      // Discord blurple → white
  assert.equal(glyphColor('#25D366'), '#fff');
  assert.equal(glyphColor('nope'), '#fff');
});

test('initials', () => {
  assert.equal(initials('Sam'), 'S');
  assert.equal(initials('Priya Shah'), 'PS');
  assert.equal(initials('#design team'), 'DT');
  assert.equal(initials('  '), '?');
});
