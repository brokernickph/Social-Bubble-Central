'use strict';

// Helpers for the configurable show/hide shortcut. Loaded in the renderer
// (settings recorder) and required by main.js / tests.

const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super'];

// Turn a keydown event into an Electron accelerator ("Control+Shift+B"), or
// null if it's not a usable global shortcut (needs Ctrl/Alt/Win plus a real key).
// Uses event.code so the result doesn't depend on keyboard layout.
function acceleratorFromEvent(e) {
  let key = null;
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (code === 'Space') key = 'Space';
  else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
  else if (code === 'Backquote') key = '`';
  if (!key) return null;

  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const isFn = /^F\d+$/.test(key);
  // Shift alone would hijack normal typing (e.g. Shift+B = "B").
  if (!isFn && !mods.some((m) => m !== 'Shift')) return null;
  return [...mods, key].join('+');
}

// "Control+Shift+B" -> "Ctrl+Shift+B" for labels.
function displayAccelerator(acc) {
  return String(acc || '')
    .split('+')
    .map((p) => ({ Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Super: 'Win', Meta: 'Win' }[p] || p))
    .join('+');
}

// Basic shape check before handing a stored value to globalShortcut.
function isValidAccelerator(acc) {
  if (typeof acc !== 'string' || !acc) return false;
  const parts = acc.split('+');
  const key = parts.pop();
  if (!key || parts.some((p) => !MOD_ORDER.includes(p) && p !== 'CommandOrControl')) return false;
  return parts.length > 0 || /^F\d+$/.test(key);
}

if (typeof module !== 'undefined') module.exports = { acceleratorFromEvent, displayAccelerator, isValidAccelerator };
