import assert from 'node:assert/strict';
import test from 'node:test';
import { isItemSubPage } from '../core/helpers';

// The detail route treats a Referer that is one of a plugin's own item pages as "not a
// listing" and drops it as a back target, so the detail page and its Copy/Edit form don't
// loop back to each other. These cover the loop that regressed: the Copy/Edit sub-routes
// (/{prefix}/copy/{id}, /{prefix}/edit/{id}) must be recognised as item pages, not just
// the bare detail URL.

const PREFIX = '/media-server';
const ID = '6aa8419ddbd4c982a55363f1';

test('a bare detail page is an item page', () => {
  assert.equal(isItemSubPage(`${PREFIX}/${ID}`, PREFIX), true);
});

test('the copy sub-page is an item page (the loop that regressed)', () => {
  assert.equal(isItemSubPage(`${PREFIX}/copy/${ID}`, PREFIX), true);
});

test('the edit sub-page is an item page', () => {
  assert.equal(isItemSubPage(`${PREFIX}/edit/${ID}`, PREFIX), true);
});

test('a trailing sub-segment like /label is still an item page', () => {
  assert.equal(isItemSubPage(`${PREFIX}/${ID}/label`, PREFIX), true);
});

test('a detail page carrying a query string is an item page', () => {
  assert.equal(isItemSubPage(`${PREFIX}/${ID}?from=/collection`, PREFIX), true);
});

test('a collection listing is NOT an item page (stays a valid back target)', () => {
  assert.equal(isItemSubPage('/collection?type=media-server', PREFIX), false);
  assert.equal(isItemSubPage('/collection', PREFIX), false);
});

test('another plugin\'s listing is not this plugin\'s item page', () => {
  assert.equal(isItemSubPage('/album', PREFIX), false);
});

test('a non-id path under the prefix is not treated as an item page', () => {
  // e.g. an add form or an unknown action with no 24-hex id
  assert.equal(isItemSubPage(`${PREFIX}/add`, PREFIX), false);
});
