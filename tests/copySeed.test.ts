import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCopySeed } from '../core/helpers';
import type { PluginDefinition } from '../core/types';
import { booksPlugin } from '../plugins/books/index';
import { musicPlugin } from '../plugins/music/index';

// buildCopySeed is a pure data transform: it strips what belongs to one physical copy
// (so the clone saves as a new document) and resets quantity. Only the fields the
// function reads off the plugin are exercised here, so a partial stub cast to
// PluginDefinition keeps the tests free of a DB.
const stub = (over: Partial<PluginDefinition> = {}): PluginDefinition =>
  ({ ...over } as unknown as PluginDefinition);

test('buildCopySeed removes server-managed identity/bookkeeping, the barcode and its lock', () => {
  const seed = buildCopySeed({
    _id: 'abc', mongo_id: 'm', __v: 2, added_at: 'a', modified_at: 'b', synced_at: 'c',
    owner: 'o', modified_by: 'u', parent: 'p', in_wishlist: true, quantity: 3,
    barcode: '0123456789', barcode_locked: true,
    title: 'Kind of Blue'
  }, stub());

  for (const key of ['_id', 'mongo_id', '__v', 'added_at', 'modified_at', 'synced_at',
    'owner', 'modified_by', 'parent', 'in_wishlist', 'barcode', 'barcode_locked']) {
    assert.ok(!(key in seed), `${key} should be stripped`);
  }
});

test('buildCopySeed keeps a work-level external link by default', () => {
  // The same film on another disc, the same Lego set sealed or built: the copy stays
  // linked to the record that describes the work, and stays refreshable.
  const seed = buildCopySeed(
    { tmdb_id: 603, source: 'tmdb', source_id: 'movie_603', title: 'The Matrix' },
    stub({ externalIdField: 'tmdb_id' })
  );
  assert.equal(seed.tmdb_id, 603);
  assert.equal(seed.source, 'tmdb');
  assert.equal(seed.source_id, 'movie_603');
});

test('buildCopySeed drops every copyDropFields entry', () => {
  const seed = buildCopySeed(
    { isbn: '9780000000000', hardcover_slug: 'dune', title: 'Dune', format: 'paperback' },
    stub({ copyDropFields: ['isbn'], externalIdField: 'hardcover_slug' })
  );
  assert.ok(!('isbn' in seed));
  assert.equal(seed.hardcover_slug, 'dune');
  assert.equal(seed.format, 'paperback');
});

test('music drops its Discogs release and the source pair pointing at it', () => {
  const seed = buildCopySeed({
    discogs_id: 42, source: 'discogs', source_id: '42',
    title: 'Kind of Blue', artist: 'Miles Davis', media_type: 'vinyl'
  }, musicPlugin);
  assert.ok(!('discogs_id' in seed));
  assert.ok(!('source' in seed));
  assert.ok(!('source_id' in seed));
  assert.equal(seed.media_type, 'vinyl');
});

test('books drop the ISBN but keep the Hardcover link to the work', () => {
  const seed = buildCopySeed({
    isbn: '9780000000000', hardcover_slug: 'dune', source: 'hardcover', source_id: '1',
    title: 'Dune', author: 'Herbert'
  }, booksPlugin);
  assert.ok(!('isbn' in seed));
  assert.equal(seed.hardcover_slug, 'dune');
  assert.equal(seed.source_id, '1');
});

test('buildCopySeed leaves subdocument ids behind but keeps their content', () => {
  const seed = buildCopySeed({
    title: 'x',
    tracklist: [{ _id: 't1', position: 'A1', title: 'Intro' }],
    genres: ['Jazz']
  }, stub());
  assert.deepEqual(seed.tracklist, [{ position: 'A1', title: 'Intro' }]);
  assert.deepEqual(seed.genres, ['Jazz']);
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
