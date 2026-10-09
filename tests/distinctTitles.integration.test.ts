import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { buildUniqueTitlesGroupKey, CreatorFieldSource } from '../core/helpers';

const mongoUrl = process.env.TEST_MONGODB_URL || '';
const safeDatabaseName = 'dvinyl_distinct_titles_test';

const music: CreatorFieldSource = { kind: 'Music', creatorField: 'artist', matchesLegacyItems: true };
const dvd: CreatorFieldSource = { kind: 'Dvd', creatorField: 'director' };
const book: CreatorFieldSource = { kind: 'Book', creatorField: 'author' };

test('distinct titles count runs on real data, including malformed creators', {
  skip: !mongoUrl
}, async t => {
  assert.match(mongoUrl, new RegExp(`/${safeDatabaseName}(?:[?]|$)`), 'integration test must use its isolated database');
  await mongoose.connect(mongoUrl);
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await mongoose.connection.dropDatabase();

  // Native inserts, like a backup restore: nothing casts the creator to a string.
  const items = mongoose.connection.collection('items_distinct');
  await items.insertMany([
    // One work in two formats, creator differing only by case and spacing: 1
    { kind: 'Music', sort_title: 'abbey road', artist: 'The Beatles' },
    { kind: 'Music', sort_title: 'abbey road', artist: ' the beatles ' },
    // Same title, different artists, both pre-plugins (no kind): 2
    { sort_title: 'greatest hits', artist: 'Queen' },
    { sort_title: 'greatest hits', artist: 'ABBA' },
    // A remake keeps apart through its director: 2
    { kind: 'Dvd', sort_title: 'karate kid', director: 'John G. Avildsen' },
    { kind: 'Dvd', sort_title: 'karate kid', director: 'Harald Zwart' },
    // Same title across types stays apart: 1 (the Dvd "dune" below makes 2)
    { kind: 'Book', sort_title: 'dune', author: 'Frank Herbert' },
    { kind: 'Dvd', sort_title: 'dune', director: 'Denis Villeneuve' },
    // Creators that are not strings must not fail the aggregate: 3
    { kind: 'Music', sort_title: 'numeric', artist: 1975 },
    { kind: 'Music', sort_title: 'array', artist: ['A', 'B'] },
    { kind: 'Music', sort_title: 'missing' }
  ]);

  const count = async (selected: CreatorFieldSource | undefined, match: any = {}) => {
    const res = await items.aggregate([
      { $match: match },
      { $group: { _id: buildUniqueTitlesGroupKey(selected, [music, dvd, book]) } },
      { $count: 'total' }
    ]).toArray();
    return res[0]?.total ?? 0;
  };

  const all = await count(undefined);
  assert.equal(all, 10);

  const perType = await count(music, { $or: [{ kind: 'Music' }, { kind: { $exists: false } }] })
    + await count(dvd, { kind: 'Dvd' })
    + await count(book, { kind: 'Book' });
  assert.equal(perType, all, 'all-types count equals the sum of the per-type counts');
});
