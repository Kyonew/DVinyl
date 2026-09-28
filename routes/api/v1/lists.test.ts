import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem } from '../../../test/helpers/factories';
import {
  loadPluginsOnce, registerTestPlugin, registerTracklistPlugin,
  TEST_PLUGIN_KIND, TRACKLIST_PLUGIN_KIND
} from '../../../test/helpers/plugins';
import { listCandidates, resolveListEntries } from '../../../core/listStore';

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  registerTracklistPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

/** A list literal: listCandidates only needs _id, kind and entries. */
function fakeList(kind: 'items' | 'tracks', entries: any[] = []) {
  return { _id: new mongoose.Types.ObjectId(), kind, entries };
}

describe('listCandidates', () => {
  test('items: matches by title and reports whether the list already holds it', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'admin' }] });
    const held = await makeItem(TEST_PLUGIN_KIND, { title: 'Held One', creator: 'C', owner: user._id, collection: collection._id });
    const free = await makeItem(TEST_PLUGIN_KIND, { title: 'Free One', creator: 'C', owner: user._id, collection: collection._id });

    const results = await listCandidates({
      list: fakeList('items', [{ item: held._id }]),
      collectionId: collection._id,
      query: 'one',
      translate: (key: string) => key,
      settings: { modules: {} }
    });

    const byItem = new Map(results.map((r: any) => [r.item, r]));
    assert.equal((byItem.get(String(held._id)) as any).inList, true);
    assert.equal((byItem.get(String(free._id)) as any).inList, false);
  });

  test('tracks: returns one row per matching track with its id and position', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'admin' }] });
    await makeItem(TRACKLIST_PLUGIN_KIND, {
      title: 'Album', creator: 'C', owner: user._id, collection: collection._id,
      tracklist: [{ title: 'Sunrise', position: 'A1' }, { title: 'Sunset', position: 'A2' }]
    });

    const results = await listCandidates({
      list: fakeList('tracks'),
      collectionId: collection._id,
      query: 'sun',
      translate: (key: string) => key,
      settings: { modules: {} }
    });

    assert.deepEqual(results.map((r: any) => r.trackTitle).sort(), ['Sunrise', 'Sunset']);
    assert.ok(results.every((r: any) => typeof r.track === 'string'));
    assert.equal(results.find((r: any) => r.trackTitle === 'Sunrise').position, 'A1');
  });

  test('an empty query returns nothing without touching the database', async () => {
    const results = await listCandidates({
      list: fakeList('items'), collectionId: new mongoose.Types.ObjectId(),
      query: '   ', translate: (key: string) => key
    });
    assert.deepEqual(results, []);
  });
});

describe('resolveListEntries', () => {
  test('exposes the raw item and the entry timestamp alongside the formatted view', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'admin' }] });
    const item = await makeItem(TEST_PLUGIN_KIND, { title: 'In a list', creator: 'C', owner: user._id, collection: collection._id });
    const list = await mongoose.model('List').create({
      collection: collection._id, name: 'L', kind: 'items', createdBy: user._id,
      entries: [{ item: item._id }]
    });

    const lines = await resolveListEntries(list.toObject(), collection._id);

    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.equal(String(line.rawItem._id), String(item._id));
    assert.ok(line.addedAt instanceof Date);
  });
});
