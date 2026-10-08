import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCopySeed } from '../core/helpers';
import type { PluginDefinition } from '../core/types';

// buildCopySeed is a pure data transform: it strips the identity that belongs to a
// specific copy (so the clone saves as a new, unlinked document) and resets quantity.
// Only the fields the function reads off the plugin are exercised here, so a partial
// stub cast to PluginDefinition keeps the tests free of a DB or the real plugins.
const stub = (over: Partial<PluginDefinition> = {}): PluginDefinition =>
  ({ ...over } as unknown as PluginDefinition);

test('buildCopySeed removes server-managed identity/bookkeeping and the barcode', () => {
  const seed = buildCopySeed({
    _id: 'abc', mongo_id: 'm', __v: 2, added_at: 'a', modified_at: 'b', synced_at: 'c',
    owner: 'o', modified_by: 'u', parent: 'p', in_wishlist: true, quantity: 3,
    barcode: '0123456789',
    title: 'Kind of Blue'
  }, stub());

  for (const key of ['_id', 'mongo_id', '__v', 'added_at', 'modified_at', 'synced_at',
    'owner', 'modified_by', 'parent', 'in_wishlist', 'barcode']) {
    assert.ok(!(key in seed), `${key} should be stripped`);
  }
});

test('buildCopySeed removes the external provider link: source, source_id, barcode_locked', () => {
  const seed = buildCopySeed({
    source: 'discogs', source_id: '98765', barcode_locked: true,
    title: 'Kind of Blue'
  }, stub());

  assert.ok(!('source' in seed));
  assert.ok(!('source_id' in seed));
  assert.ok(!('barcode_locked' in seed));
});

test('buildCopySeed removes externalIdField when the plugin sets one', () => {
  const seed = buildCopySeed({ discogs_id: '42', title: 'x' }, stub({ externalIdField: 'discogs_id' }));
  assert.ok(!('discogs_id' in seed));
});

test('buildCopySeed leaves fields alone when the plugin has no externalIdField', () => {
  const seed = buildCopySeed({ discogs_id: '42', title: 'x' }, stub());
  assert.equal(seed.discogs_id, '42');
});

test('buildCopySeed drops every copyDropFields entry (books-shaped stub)', () => {
  const seed = buildCopySeed({
    isbn: '9780000000000', hardcover_id: 'h1', hardcover_slug: 'the-slug',
    title: 'Dune', author: 'Herbert', format: 'paperback'
  }, stub({ copyDropFields: ['isbn', 'hardcover_id'], externalIdField: 'hardcover_slug' }));

  assert.ok(!('isbn' in seed), 'isbn dropped');
  assert.ok(!('hardcover_id' in seed), 'hardcover_id dropped');
  assert.ok(!('hardcover_slug' in seed), 'externalIdField dropped');
  // Fields outside any drop list survive.
  assert.equal(seed.title, 'Dune');
  assert.equal(seed.author, 'Herbert');
  assert.equal(seed.format, 'paperback');
});

test('buildCopySeed forces quantity to 1', () => {
  const seed = buildCopySeed({ quantity: 7, title: 'x' }, stub());
  assert.equal(seed.quantity, 1);
});

test('buildCopySeed keeps work-level and duplicate-check fields intact', () => {
  const seed = buildCopySeed({
    title: 'Kind of Blue', media_type: 'vinyl', variant_color: 'blue', format: 'LP'
  }, stub({ copyDropFields: [] }));

  assert.equal(seed.title, 'Kind of Blue');
  assert.equal(seed.media_type, 'vinyl');
  assert.equal(seed.variant_color, 'blue');
  assert.equal(seed.format, 'LP');
});
