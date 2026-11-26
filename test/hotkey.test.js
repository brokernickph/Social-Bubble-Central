'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { acceleratorFromEvent, displayAccelerator, isValidAccelerator } = require('../renderer/hotkey.js');

const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('acceleratorFromEvent builds layout-independent accelerators', () => {
  assert.equal(acceleratorFromEvent(ev('KeyB', { ctrlKey: true, shiftKey: true })), 'Control+Shift+B');
  assert.equal(acceleratorFromEvent(ev('Digit1', { altKey: true })), 'Alt+1');
  assert.equal(acceleratorFromEvent(ev('Space', { metaKey: true })), 'Super+Space');
  assert.equal(acceleratorFromEvent(ev('ArrowUp', { ctrlKey: true, altKey: true })), 'Control+Alt+Up');
  assert.equal(acceleratorFromEvent(ev('F9')), 'F9');
});

test('acceleratorFromEvent rejects combos that would hijack typing', () => {
  assert.equal(acceleratorFromEvent(ev('KeyB')), null);
  assert.equal(acceleratorFromEvent(ev('KeyB', { shiftKey: true })), null);
  assert.equal(acceleratorFromEvent(ev('ControlLeft', { ctrlKey: true })), null);  // modifier alone
  assert.equal(acceleratorFromEvent(ev('Enter', { ctrlKey: true })), null);
});

test('displayAccelerator uses friendly names', () => {
  assert.equal(displayAccelerator('Control+Shift+B'), 'Ctrl+Shift+B');
  assert.equal(displayAccelerator('Super+Alt+K'), 'Win+Alt+K');
});

test('isValidAccelerator', () => {
  assert.ok(isValidAccelerator('Control+Shift+B'));
  assert.ok(isValidAccelerator('F9'));
  assert.ok(!isValidAccelerator('B'));
  assert.ok(!isValidAccelerator('Banana+B'));
  assert.ok(!isValidAccelerator(''));
  assert.ok(!isValidAccelerator(null));
});
