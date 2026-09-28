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
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import List from '../../../models/List';

const app = buildApiApp();

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

/** owner=admin, editor, viewer, plus an outsider non-member. */
async function seedRoles() {
  const owner = (await makeUser()).user;
  const editor = (await makeUser()).user;
  const viewer = (await makeUser()).user;
  const outsider = (await makeUser()).user;
  const collection = await makeCollection({
    members: [
      { user: owner, role: 'admin' },
      { user: editor, role: 'editor' },
      { user: viewer, role: 'viewer' }
    ]
  });
  await makeSettings(collection);
  return {
    owner, editor, viewer, outsider, collection,
    ownerToken: signAccessToken(owner._id),
    editorToken: signAccessToken(editor._id),
    viewerToken: signAccessToken(viewer._id),
    outsiderToken: signAccessToken(outsider._id)
  };
}

describe('GET /api/v1/collections/:id/lists', () => {
  test('401 without a bearer token', async () => {
    const ctx = await seedRoles();
    const res = await request(app).get(`/api/v1/collections/${ctx.collection._id}/lists`);
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('200 lists summaries with covers and canMakePlaylists', async () => {
    const ctx = await seedRoles();
    const item = await makeItem(TEST_PLUGIN_KIND, {
      title: 'Covered', cover_image: '/uploads/items/cover.jpg', owner: ctx.owner._id, collection: ctx.collection._id
    });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Unlisted', owner: ctx.owner._id, collection: ctx.collection._id });
    await List.create({ collection: ctx.collection._id, name: 'Backlog', kind: 'items', createdBy: ctx.owner._id, entries: [{ item: item._id }] });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.viewerToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.lists.length, 1);
    assert.equal(res.body.lists[0].name, 'Backlog');
    assert.equal(res.body.lists[0].count, 1);
    assert.equal(res.body.lists[0].covers.length, 1);
    assert.equal(res.body.canMakePlaylists, true);
  });

  test('200 with canMakePlaylists false when no enabled plugin has a tracklist', async () => {
    const ctx = await seedRoles();
    await makeSettings(ctx.collection, { modules: {} });
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.canMakePlaylists, false);
  });
});

describe('POST /api/v1/collections/:id/lists', () => {
  test('201 creates an item list', async () => {
    const ctx = await seedRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.editorToken))
      .send({ name: '  Backlog  ', description: 'To play' });
    assert.equal(res.status, 201);
    assert.equal(res.body.list.name, 'Backlog');
    assert.equal(res.body.list.kind, 'items');
    assert.equal(res.body.list.count, 0);
    assert.deepEqual(res.body.list.covers, []);
  });

  test('201 creates a playlist', async () => {
    const ctx = await seedRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.editorToken))
      .send({ name: 'Road trip', kind: 'tracks' });
    assert.equal(res.status, 201);
    assert.equal(res.body.list.kind, 'tracks');
  });

  test('400 for an empty name', async () => {
    const ctx = await seedRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.editorToken))
      .send({ name: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'A list name is required');
  });

  test('400 for an unknown kind', async () => {
    const ctx = await seedRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.editorToken))
      .send({ name: 'X', kind: 'playlist' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid list kind');
  });

  test('403 for a viewer', async () => {
    const ctx = await seedRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/lists`)
      .set(bearer(ctx.viewerToken))
      .send({ name: 'X' });
    assert.equal(res.status, 403);
  });
});

async function seedList(kind: 'items' | 'tracks' = 'items', entries: any[] = []) {
  const ctx = await seedRoles();
  const list = await List.create({
    collection: ctx.collection._id, name: 'Backlog', description: 'Mine', kind, createdBy: ctx.owner._id, entries
  });
  return { ...ctx, list };
}

describe('GET /api/v1/collections/:id/lists/:listId', () => {
  test('200 returns the list and its resolved entries in order', async () => {
    const { collection, list, viewerToken, owner } = await seedList();
    const first = await makeItem(TEST_PLUGIN_KIND, { title: 'First', owner: owner._id, collection: collection._id });
    const second = await makeItem(TEST_PLUGIN_KIND, { title: 'Second', owner: owner._id, collection: collection._id });
    await List.updateOne({ _id: list._id }, { $set: { entries: [{ item: second._id }, { item: first._id }] } });

    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/lists/${list._id}`)
      .set(bearer(viewerToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.list.name, 'Backlog');
    assert.equal(res.body.entries.length, 2);
    assert.equal(res.body.entries[0].item.title, 'Second', 'stored order is kept');
    assert.equal(res.body.entries[0].item.id, String(second._id));
    assert.ok(res.body.entries[0].entryId);
    assert.ok(res.body.entries[0].added_at);
  });

  test('200 includes the track for a playlist line', async () => {
    const ctx = await seedRoles();
    const item = await makeItem(TRACKLIST_PLUGIN_KIND, {
      title: 'Album', owner: ctx.owner._id, collection: ctx.collection._id,
      tracklist: [{ title: 'Sunrise', position: 'A1' }]
    });
    const trackId = item.tracklist[0]._id;
    const list = await List.create({
      collection: ctx.collection._id, name: 'Play', kind: 'tracks', createdBy: ctx.owner._id,
      entries: [{ item: item._id, track: trackId }]
    });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/lists/${list._id}`)
      .set(bearer(ctx.viewerToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.entries[0].track.title, 'Sunrise');
    assert.equal(res.body.entries[0].track.position, 'A1');
  });

  test('prunes a dangling line and persists the prune', async () => {
    const { collection, list, viewerToken } = await seedList('items', [{ item: new mongoose.Types.ObjectId() }]);
    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/lists/${list._id}`)
      .set(bearer(viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.entries, []);
    const stored: any = await List.findById(list._id).lean();
    assert.equal(stored.entries.length, 0, 'the dead line is removed from the list');
  });

  test('404 for a list of another collection', async () => {
    const { list } = await seedList();
    const other = await seedRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${other.collection._id}/lists/${list._id}`)
      .set(bearer(other.ownerToken));
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});

describe('PATCH /api/v1/collections/:id/lists/:listId', () => {
  test('200 renames and re-describes', async () => {
    const { collection, list, editorToken } = await seedList();
    const res = await request(app)
      .patch(`/api/v1/collections/${collection._id}/lists/${list._id}`)
      .set(bearer(editorToken))
      .send({ name: 'Renamed', description: 'New text' });
    assert.equal(res.status, 200);
    assert.equal(res.body.list.name, 'Renamed');
    assert.equal(res.body.list.description, 'New text');
  });

  test('200 keeps the name when the posted one is empty', async () => {
    const { collection, list, editorToken } = await seedList();
    const res = await request(app)
      .patch(`/api/v1/collections/${collection._id}/lists/${list._id}`)
      .set(bearer(editorToken))
      .send({ name: '   ', description: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.list.name, 'Backlog');
  });

  test('403 for a viewer', async () => {
    const { collection, list, viewerToken } = await seedList();
    const res = await request(app)
      .patch(`/api/v1/collections/${collection._id}/lists/${list._id}`)
      .set(bearer(viewerToken))
      .send({ name: 'Nope' });
    assert.equal(res.status, 403);
  });
});

describe('DELETE /api/v1/collections/:id/lists/:listId', () => {
  test('200 deletes the list and leaves the items', async () => {
    const { collection, list, owner, editorToken } = await seedList();
    const item = await makeItem(TEST_PLUGIN_KIND, { title: 'Stays', owner: owner._id, collection: collection._id });
    await List.updateOne({ _id: list._id }, { $set: { entries: [{ item: item._id }] } });

    const res = await request(app)
      .delete(`/api/v1/collections/${collection._id}/lists/${list._id}`)
      .set(bearer(editorToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(await List.countDocuments({ _id: list._id }), 0);
    assert.equal(await mongoose.model(TEST_PLUGIN_KIND).countDocuments({ _id: item._id }), 1);
  });

  test('404 for an unknown list', async () => {
    const ctx = await seedRoles();
    const res = await request(app)
      .delete(`/api/v1/collections/${ctx.collection._id}/lists/64b7f9c2f1a2b3c4d5e6f7a8`)
      .set(bearer(ctx.editorToken));
    assert.equal(res.status, 404);
  });
});
