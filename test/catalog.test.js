'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, catalogByType, catalogTweaks, nextZoom, titleUnread } = require('../renderer/catalog.js');

test('titleUnread reads leading and trailing counts', () => {
  assert.equal(titleUnread('(3) Discord'), 3);
  assert.equal(titleUnread('  (12) WhatsApp'), 12);
  assert.equal(titleUnread('(99+) Messenger'), 99);
  assert.equal(titleUnread('Inbox (5)'), 5);
});

test('titleUnread ignores numbers that are not counts', () => {
  assert.equal(titleUnread('Discord'), 0);
  assert.equal(titleUnread('Notes (2024) draft'), 0);
  assert.equal(titleUnread('Archive (2024)'), 0);
  assert.equal(titleUnread(''), 0);
  assert.equal(titleUnread(undefined), 0);
});

test('catalog entries are well-formed and unique', () => {
  const types = new Set();
  for (const c of CATALOG) {
    assert.ok(c.type && c.name && c.color, `incomplete entry ${c.type}`);
    assert.match(c.url, /^https:\/\//);
    assert.ok(!types.has(c.type), `duplicate type ${c.type}`);
    types.add(c.type);
  }
  assert.equal(catalogByType('discord').name, 'Discord');
  assert.equal(catalogByType('nope'), null);
});

test('catalogTweaks falls back to no tweaks', () => {
  assert.deepEqual(catalogTweaks('custom'), { css: '', zoom: 1 });
  assert.equal(catalogTweaks('discord').zoom, 0.8);
});

test('nextZoom steps, clamps and resets to the service default', () => {
  assert.equal(nextZoom(1, '=', 'custom'), 1.1);
  assert.equal(nextZoom(1, '+', 'custom'), 1.1);
  assert.equal(nextZoom(1, '-', 'custom'), 0.9);
  assert.equal(nextZoom(0.3, '-', 'custom'), 0.3);
  assert.equal(nextZoom(3, '=', 'custom'), 3);
  assert.equal(nextZoom(1.7, '0', 'discord'), 0.8);
  assert.equal(nextZoom(1.7, '0', 'custom'), 1);
});

const { chatNameFromTitle, isPinnableChatUrl } = require('../renderer/catalog.js');

test('chatNameFromTitle strips counts and the service name', () => {
  assert.equal(chatNameFromTitle('(2) Sam | Messenger', ['Messenger']), 'Sam');
  assert.equal(chatNameFromTitle('Priya - Telegram', ['Telegram']), 'Priya');
  assert.equal(chatNameFromTitle('Discord | #general | Gaming crew', ['Discord']), '#general');
  assert.equal(chatNameFromTitle('Messenger', ['Messenger']), '');
  assert.equal(chatNameFromTitle('', ['X']), '');
});

test('isPinnableChatUrl only accepts a page other than the start page', () => {
  const svc = { url: 'https://www.messenger.com/' };
  assert.ok(isPinnableChatUrl('https://www.messenger.com/t/12345', svc));
  assert.ok(isPinnableChatUrl('https://web.telegram.org/a/#-100123', { url: 'https://web.telegram.org/a/' }));
  assert.ok(!isPinnableChatUrl('https://www.messenger.com/', svc));
  assert.ok(!isPinnableChatUrl('https://www.messenger.com', svc));
  assert.ok(!isPinnableChatUrl('about:blank', svc));
  assert.ok(!isPinnableChatUrl('not a url', svc));
});

test('services that use one address for every chat are marked', () => {
  assert.ok(catalogByType('whatsapp').noChatLinks);
  assert.ok(catalogByType('snapchat').noChatLinks);
  assert.ok(!catalogByType('messenger').noChatLinks);
});
