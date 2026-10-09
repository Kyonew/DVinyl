import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUniqueTitlesGroupKey, CreatorFieldSource } from '../core/helpers';

// Stand-ins for the registry's plugins: the builder only reads `kind`, `creatorField`
// and `matchesLegacyItems`, so plain objects are enough (no DB, no registry wiring).
const music: CreatorFieldSource = { kind: 'Music', creatorField: 'artist', matchesLegacyItems: true };
const dvd: CreatorFieldSource = { kind: 'Dvd', creatorField: 'director' };
const book: CreatorFieldSource = { kind: 'Book', creatorField: 'author' };
const custom: CreatorFieldSource = { kind: 'MyThing', creatorField: 'creator' };

// The raw creator expression, before normalization wraps it.
const rawCreator = (key: any) => key.creator.$let.vars.c;

const branchFor = (sw: any, kind: string) => sw.$switch.branches.find((b: any) =>
  JSON.stringify(b.case).includes(`"${kind}"`));

test('title component is $ifNull on sort_title (legacy docs still group)', () => {
  const key = buildUniqueTitlesGroupKey(music, [music, dvd, book]);
  assert.deepEqual(key.title, { $ifNull: ['$sort_title', ''] });
});

test('creator is lowercased and trimmed only when it is a string, "" otherwise', () => {
  const key = buildUniqueTitlesGroupKey(dvd, [music, dvd, book]);
  assert.deepEqual(key.creator.$let.in, {
    $cond: [
      { $eq: [{ $type: '$$c' }, 'string'] },
      { $toLower: { $trim: { input: '$$c' } } },
      ''
    ]
  });
});

test('selected type keys on that plugin creator field', () => {
  const key = buildUniqueTitlesGroupKey(dvd, [music, dvd, book]);
  assert.equal(rawCreator(key), '$director');
});

test('all-types key is a $switch over every enabled plugin with a "" default', () => {
  const plugins = [music, dvd, book, custom];
  const sw = rawCreator(buildUniqueTitlesGroupKey(undefined, plugins));
  assert.ok(sw.$switch, 'inner expression is a $switch on kind');

  assert.equal(sw.$switch.branches.length, plugins.length);
  for (const p of plugins) {
    const branch = branchFor(sw, p.kind);
    assert.ok(branch, `has a branch for kind ${p.kind}`);
    assert.equal(branch.then, `$${p.creatorField}`);
  }
  assert.deepEqual(branchFor(sw, 'Dvd').case, { $eq: ['$kind', 'Dvd'] });

  // A kind no enabled plugin claims (a disabled module's leftover items) never errors.
  assert.equal(sw.$switch.default, '');
});

test('the legacy-claiming plugin also takes items with no kind', () => {
  const sw = rawCreator(buildUniqueTitlesGroupKey(undefined, [music, dvd]));
  assert.deepEqual(branchFor(sw, 'Music').case, {
    $or: [{ $eq: ['$kind', 'Music'] }, { $eq: [{ $type: '$kind' }, 'missing'] }]
  });
});

test('two different-type items sharing a title do not collapse (sum-of-per-type holds)', () => {
  // The switch picks a different creator field per kind, so a Dvd "Dune" (director)
  // and a Book "Dune" (author) key on different creator components and stay apart.
  const sw = rawCreator(buildUniqueTitlesGroupKey(undefined, [dvd, book]));
  assert.notEqual(branchFor(sw, 'Dvd').then, branchFor(sw, 'Book').then);
});
