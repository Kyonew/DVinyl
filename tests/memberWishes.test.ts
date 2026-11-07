import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { db } from '../core/db';
import { memberWishesFor } from '../core/memberWishes';

const original = { collections: db.collections.find, items: db.items.find, users: db.users.find };
afterEach(() => {
  (db.collections as any).find = original.collections;
  (db.items as any).find = original.items;
  (db.users as any).find = original.users;
});

const plugin: any = {
  id: 'music', kind: 'Music', creatorField: 'artist', externalIdField: 'discogs_id',
  sources: [{ id: 'discogs', name: 'Discogs', search: async () => [], getDetails: async () => ({}) }]
};
const ME = 'a'.repeat(24), ALEX = 'b'.repeat(24), VINYL = 'c'.repeat(24), SALON = 'd'.repeat(24);

function stub(wishes: any[], memberOf = [{ _id: VINYL, name: 'Vinyl' }, { _id: SALON, name: 'Salon' }]) {
  const asked: any[] = [];
  (db.collections as any).find = async (filter: any) => { asked.push(filter); return memberOf; };
  (db.items as any).find = async () => wishes;
  (db.users as any).find = async () => [{ _id: ALEX, username: 'alex' }];
  return asked;
}

test('a release wished for in one of my collections is named, with who and where', async () => {
  stub([
    { title: 'Nevermind', sort_title: 'nevermind', artist: 'Nirvana', source: 'discogs', source_id: '249504', owner: ALEX, collection: VINYL },
    // Another pressing of the same album: it names its own release, so it is not this one.
    { title: 'Nevermind', sort_title: 'nevermind', artist: 'Nirvana', source: 'discogs', source_id: '999', owner: ALEX, collection: SALON },
    // Entered by hand, naming no release: any pressing of the title will do.
    { title: 'Nevermind', sort_title: 'nevermind', artist: 'Nirvana', owner: ME, collection: SALON },
    { title: 'Bleach', sort_title: 'bleach', artist: 'Nirvana', source: 'discogs', source_id: '1', owner: ALEX, collection: VINYL }
  ]);
  const [hits, none] = await memberWishesFor(plugin, ME, [
    { id: 249504, source: 'discogs', title: 'Nevermind', artist: 'Nirvana' },
    { id: 5, source: 'discogs', title: 'In Utero', artist: 'Nirvana' }
  ]);
  assert.deepEqual(hits, [
    { member: 'alex', collection: 'Vinyl', exact: true },
    { member: null, collection: 'Salon', exact: false }
  ]);
  assert.deepEqual(none, []);
});

test('an item older than the source pair matches through its own id; only a hand-entered wish matches by title', async () => {
  stub([
    { title: 'Abbey Road', sort_title: 'abbey road', artist: 'The Beatles', discogs_id: 42, owner: ALEX, collection: VINYL }
  ]);
  const [exact] = await memberWishesFor(plugin, ME, [{ id: '42', source: 'discogs', title: 'Abbey Road', artist: 'Beatles' }]);
  assert.deepEqual(exact, [{ member: 'alex', collection: 'Vinyl', exact: true }]);
  const [other] = await memberWishesFor(plugin, ME, [{ id: '7', source: 'discogs', title: 'abbey road', creator: 'beatles' }]);
  assert.deepEqual(other, [], 'a wish naming one pressing says nothing about another');

  stub([{ title: 'Abbey Road', sort_title: 'abbey road', artist: 'The Beatles', owner: ALEX, collection: VINYL }]);
  const [near] = await memberWishesFor(plugin, ME, [{ id: '7', source: 'discogs', title: 'abbey road', creator: 'beatles' }]);
  assert.deepEqual(near, [{ member: 'alex', collection: 'Vinyl', exact: false }]);
});

test('nothing is looked up for a reader in no collection', async () => {
  stub([{ title: 'X', owner: ALEX, collection: VINYL }], []);
  assert.deepEqual(await memberWishesFor(plugin, ME, [{ id: 1, title: 'X' }]), [[]]);
  assert.deepEqual(await memberWishesFor(plugin, null, [{ id: 1, title: 'X' }]), [[]]);
});
