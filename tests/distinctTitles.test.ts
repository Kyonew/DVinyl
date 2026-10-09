import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUniqueTitlesGroupKey, CreatorFieldSource } from '../core/helpers';

// Stand-ins for the registry's plugins: the builder only reads `kind` and
// `creatorField`, so plain objects are enough (no DB, no registry wiring).
const music: CreatorFieldSource = { kind: 'Music', creatorField: 'artist' };
const dvd: CreatorFieldSource = { kind: 'Dvd', creatorField: 'director' };
const book: CreatorFieldSource = { kind: 'Book', creatorField: 'author' };
const custom: CreatorFieldSource = { kind: 'MyThing', creatorField: 'creator' };

test('title component is $ifNull on sort_title (legacy docs still group)', () => {
  const key = buildUniqueTitlesGroupKey(music, [music, dvd, book]);
  assert.deepEqual(key.title, { $ifNull: ['$sort_title', ''] });
});

test('selected type keys on that plugin creator field, normalized', () => {
  const key = buildUniqueTitlesGroupKey(dvd, [music, dvd, book]);
  assert.deepEqual(key.creator, {
    $toLower: { $trim: { input: { $ifNull: ['$director', ''] } } }
  });
});

test('all-types key is a $switch over every enabled plugin, normalized, with a "" default', () => {
  const plugins = [music, dvd, book, custom];
  const key = buildUniqueTitlesGroupKey(undefined, plugins);

  // Normalization still wraps the whole creator expression.
  assert.ok(key.creator.$toLower, 'creator is normalized with $toLower');
  const sw = key.creator.$toLower.$trim.input.$ifNull[0];
  assert.ok(sw.$switch, 'inner expression is a $switch on kind');

  // One branch per enabled plugin, keyed on its kind, reading its own creator field.
  assert.equal(sw.$switch.branches.length, plugins.length);
  for (const p of plugins) {
    const branch = sw.$switch.branches.find(
      (b: any) => Array.isArray(b.case.$eq) && b.case.$eq[1] === p.kind
    );
    assert.ok(branch, `has a branch for kind ${p.kind}`);
    assert.deepEqual(branch.case, { $eq: ['$kind', p.kind] });
    assert.equal(branch.then, `$${p.creatorField}`);
  }

  // Sensible default for a kind no enabled plugin claims (e.g. a disabled module's
  // leftover items), so the expression never errors.
  assert.equal(sw.$switch.default, '');
});

test('two different-type items sharing a title do not collapse (sum-of-per-type holds)', () => {
  // The switch picks a different creator field per kind, so a Dvd "Dune" (director)
  // and a Book "Dune" (author) key on different creator components and stay apart.
  const key = buildUniqueTitlesGroupKey(undefined, [dvd, book]);
  const branches = key.creator.$toLower.$trim.input.$ifNull[0].$switch.branches;
  const dvdThen = branches.find((b: any) => b.case.$eq[1] === 'Dvd').then;
  const bookThen = branches.find((b: any) => b.case.$eq[1] === 'Book').then;
  assert.notEqual(dvdThen, bookThen);
});
