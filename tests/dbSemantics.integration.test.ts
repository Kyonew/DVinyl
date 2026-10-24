import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { integrationDbUrl } from './integrationDb';
import * as F from '../core/db/filter';
import { Filter, Sort } from '../core/db/filter';
import { toMongoFilter, toMongoSort } from '../core/db/mongo/compile';
import { distinctValues, matches, sortDocs } from '../core/db/match';

// Every store owes the core the same answers to the same filters. MongoDB is the
// reference; the in-memory evaluator other stores run on is checked against it here,
// on records chosen for the cases where the two could part ways.
const mongoUrl = integrationDbUrl('dvinyl_db_semantics_test');

const oid = (n: number) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, '0'));

const DOCS: any[] = [
  { _id: oid(1), title: 'The Wall', artist: 'Pink Floyd', year: '1979', genres: ['Rock', 'Prog Rock'], owner: oid(100), added: new Date('2020-01-01'), qty: 2, tags: [] },
  { _id: oid(2), title: 'Écoute', artist: 'Élise', year: 1999, genres: ['Chanson'], owner: oid(101), added: new Date('2021-06-01'), qty: 1, location: '' },
  { _id: oid(3), title: 'wall', genre: 'Pop', genres: [], owner: oid(100), qty: null, location: null },
  { _id: oid(4), title: 'Abbey Road', artist: 'The Beatles', members: [{ user: oid(100), role: 'admin' }, { user: oid(101), role: 'viewer' }], tracklist: [{ _id: oid(50), title: 'Come Together' }, { _id: oid(51), title: 'Something' }] },
  { _id: oid(5), title: 'Kind of Blue', extra: { custom_a: 'Mono', custom_b: true, custom_n: 180, custom_d: new Date('2022-03-04') }, discogs_id: 1873013 },
  { _id: oid(6), title: 'Blue Train', extra: { custom_a: 'stereo', custom_n: 140 }, discogs_id: '1873013', genres: ['Jazz', ''] },
  { _id: oid(7), title: 'a.b', copy: 'x', original: 'x', members: [{ user: oid(102), role: 'editor' }] },
  { _id: oid(8), title: 'Mixed', year: ['1960', 1961], genres: [null, 'Soul'], copy: 'x', original: 'y', cells: [{ key: 'top' }] },
  { _id: oid(9), title: 'Untitled' }
];

const FILTERS: [string, Filter][] = [
  ['all', F.all()],
  ['none', F.none()],
  ['eq title', F.eq('title', 'The Wall')],
  ['eq array element', F.eq('genres', 'Rock')],
  ['eq null', F.eq('qty', null)],
  ['eq id field as text', F.eq('owner', String(oid(100)))],
  ['eq _id', F.eq('_id', String(oid(4)))],
  ['eq nested record list', F.eq('members.user', String(oid(101)))],
  ['eq track id', F.eq('tracklist._id', String(oid(51)))],
  ['eq number vs text', F.eq('discogs_id', 1873013)],
  ['eq text number', F.eq('year', '1979')],
  ['ne', F.ne('genre', 'Pop')],
  ['in', F.isIn('genres', ['Jazz', 'Chanson'])],
  ['in with null', F.isIn('location', [null, ''])],
  ['notIn', F.notIn('genres', ['', null])],
  ['in _id', F.isIn('_id', [String(oid(1)), String(oid(9))])],
  ['ci', F.ci('title', 'THE WALL')],
  ['ci accent', F.ci('artist', 'élise')],
  ['contains', F.contains('title', 'wall')],
  ['contains literal dot', F.contains('title', 'a.b')],
  ['contains in list', F.contains('genres', 'rock')],
  ['contains nested', F.contains('tracklist.title', 'some')],
  ['missing', F.missing('artist')],
  ['missing nested', F.missing('extra.custom_b')],
  ['exists', F.exists('location')],
  ['blank', F.blank('location')],
  ['blank list', F.blank('genres')],
  ['filled extra', F.filled('extra.custom_a')],
  ['range number', F.range('extra.custom_n', { gte: 150 })],
  ['range number upper', F.range('qty', { lte: 1 })],
  ['range date', F.range('added', { gte: new Date('2021-01-01') })],
  ['range nested date', F.range('extra.custom_d', { lte: new Date('2023-01-01') })],
  ['some', F.some('members', F.and(F.eq('user', String(oid(100))), F.eq('role', 'admin')))],
  ['some no match', F.some('members', F.and(F.eq('user', String(oid(101))), F.eq('role', 'admin')))],
  ['size 0', F.emptyList('genres')],
  ['size 2', F.size('genres', 2)],
  ['sameAs', F.sameAs('copy', 'original')],
  ['not sameAs', F.not(F.sameAs('copy', 'original'))],
  ['type text', F.ofType('discogs_id', 'text')],
  ['type number in list', F.ofType('year', 'number')],
  ['and', F.and(F.contains('title', 'blue'), F.exists('discogs_id'))],
  ['or', F.or(F.eq('genre', 'Pop'), F.eq('artist', 'Élise'))],
  ['not and', F.not(F.and(F.contains('title', 'wall'), F.exists('artist')))],
  ['index path', F.exists('cells.0')],
  ['bool', F.eq('extra.custom_b', true)],
  ['not bool', F.ne('extra.custom_b', true)]
];

const SORTS: [string, Sort][] = [
  ['title asc', [F.asc('title')]],
  ['title desc', [F.desc('title')]],
  ['year asc (text, number, list, missing)', [F.asc('year'), F.asc('_id')]],
  ['year desc', [F.desc('year'), F.asc('_id')]],
  ['genres asc (lists)', [F.asc('genres'), F.asc('_id')]],
  ['genres desc', [F.desc('genres'), F.asc('_id')]],
  ['qty asc (null, missing)', [F.asc('qty'), F.asc('_id')]],
  ['added desc', [F.desc('added'), F.asc('_id')]],
  ['nested', [F.desc('extra.custom_n'), F.asc('_id')]]
];

test('the in-memory evaluator answers every filter, sort and distinct as MongoDB does', {
  skip: !mongoUrl
}, async t => {
  await mongoose.connect(mongoUrl);
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await mongoose.connection.dropDatabase();

  // Typed like the app's models: ids and dates declared, everything else free.
  const Doc = mongoose.model('SemanticsDoc', new mongoose.Schema({
    owner: mongoose.Schema.Types.ObjectId,
    added: Date,
    members: [{ user: mongoose.Schema.Types.ObjectId, role: String, _id: false }]
  }, { strict: false, collection: 'semantics' }));
  await Doc.collection.insertMany(DOCS);

  const ids = (docs: any[]) => docs.map(d => String(d._id));

  for (const [name, filter] of FILTERS) {
    const fromMongo = ids(await Doc.find(toMongoFilter(filter)).sort({ _id: 1 }).lean());
    const fromMemory = ids(DOCS.filter(d => matches(d, filter)));
    assert.deepEqual(fromMemory, fromMongo, `filter "${name}"`);
  }

  for (const [name, sort] of SORTS) {
    const fromMongo = ids(await Doc.find({}).sort(toMongoSort(sort)).lean());
    const fromMemory = ids(sortDocs(DOCS, sort));
    assert.deepEqual(fromMemory, fromMongo, `sort "${name}"`);
  }

  for (const field of ['genres', 'genre', 'members.user', 'year', 'extra.custom_a', 'tracklist.title']) {
    const norm = (values: any[]) => values.map(v => (v instanceof Date ? v.toISOString() : String(v))).sort();
    const fromMongo = norm(await Doc.distinct(field, {}));
    const fromMemory = norm(distinctValues(DOCS, field));
    assert.deepEqual(fromMemory, fromMongo, `distinct "${field}"`);
  }
});
