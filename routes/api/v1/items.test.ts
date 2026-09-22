import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem, itemModel } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import {
  loadPluginsOnce, registerTestPlugin, registerNoRefreshPlugin,
  TEST_PLUGIN_KIND, NO_REFRESH_PLUGIN_KIND
} from '../../../test/helpers/plugins';

const app = buildApiApp();

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  registerNoRefreshPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

async function seedItem(role: 'admin' | 'editor' | 'viewer' = 'editor') {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  const item = await makeItem(TEST_PLUGIN_KIND, {
    title: 'Item A',
    creator: 'Creator',
    owner: user._id,
    collection: collection._id
  });
  return { user, collection, item, token: signAccessToken(user._id) };
}

/** A collection with an owner-admin, a viewer and a non-member outsider. */
async function seedWithViewer() {
  const owner = (await makeUser()).user;
  const viewer = (await makeUser()).user;
  const outsider = (await makeUser()).user;
  const collection = await makeCollection({
    members: [{ user: owner, role: 'admin' }, { user: viewer, role: 'viewer' }]
  });
  const item = await makeItem(TEST_PLUGIN_KIND, { title: 'Shared', owner: owner._id, collection: collection._id });
  return {
    owner, viewer, outsider, collection, item,
    ownerToken: signAccessToken(owner._id),
    viewerToken: signAccessToken(viewer._id),
    outsiderToken: signAccessToken(outsider._id)
  };
}

const invalidId = 'not-an-object-id';
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

describe('GET /api/v1/items/:itemId', () => {
  test('200 returns item detail', async () => {
    const { item, token } = await seedItem();
    const res = await request(app).get(`/api/v1/items/${item._id}`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.item.id, String(item._id));
    assert.equal(res.body.item.kind, TEST_PLUGIN_KIND);
    assert.equal(res.body.item.title, 'Item A');
  });

  test('403 for a non-member', async () => {
    const { item, outsiderToken } = await seedWithViewer();
    const res = await request(app).get(`/api/v1/items/${item._id}`).set(bearer(outsiderToken));
    assert.equal(res.status, 403);
  });

  test('404 for a malformed id', async () => {
    const { token } = await seedItem();
    const res = await request(app).get(`/api/v1/items/${invalidId}`).set(bearer(token));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Item not found');
  });

  test('404 for an unknown id', async () => {
    const { token } = await seedItem();
    const res = await request(app).get(`/api/v1/items/${unknownId}`).set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('404 for an item hidden by collection visibility', async () => {
    const { user, collection, item } = await seedItem('viewer');
    await makeSettings(collection, { visibility: { hiddenItems: [item._id] } });
    const res = await request(app).get(`/api/v1/items/${item._id}`).set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 404);
  });
});

describe('PATCH /api/v1/items/:itemId', () => {
  test('200 partial update', async () => {
    const { item, token } = await seedItem('editor');
    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set(bearer(token))
      .send({ title: 'Renamed', year: '2001' });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.title, 'Renamed');
    assert.equal(res.body.item.year, '2001');
  });

  test('403 for a viewer', async () => {
    const { item, viewerToken } = await seedWithViewer();
    const res = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set(bearer(viewerToken))
      .send({ title: 'Nope' });
    assert.equal(res.status, 403);
  });

  test('404 for a malformed id', async () => {
    const { token } = await seedItem();
    const res = await request(app).patch(`/api/v1/items/${invalidId}`).set(bearer(token)).send({ title: 'X' });
    assert.equal(res.status, 404);
  });
});

describe('DELETE /api/v1/items/:itemId', () => {
  test('200 deletes the item', async () => {
    const { item, token } = await seedItem('editor');
    const res = await request(app).delete(`/api/v1/items/${item._id}`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.deleted >= 1);
  });

  test('403 for a viewer', async () => {
    const { item, viewerToken } = await seedWithViewer();
    const res = await request(app).delete(`/api/v1/items/${item._id}`).set(bearer(viewerToken));
    assert.equal(res.status, 403);
  });

  test('404 for an unknown id', async () => {
    const { token } = await seedItem();
    const res = await request(app).delete(`/api/v1/items/${unknownId}`).set(bearer(token));
    assert.equal(res.status, 404);
  });
});

describe('item move endpoints', () => {
  test('POST move-to-collection clears the wishlist flag', async () => {
    const { item, token } = await seedItem('editor');
    await itemModel(TEST_PLUGIN_KIND).updateOne({ _id: item._id }, { $set: { in_wishlist: true } });
    const res = await request(app).post(`/api/v1/items/${item._id}/move-to-collection`).set(bearer(token)).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const stored: any = await itemModel(TEST_PLUGIN_KIND).findById(item._id).lean();
    assert.equal(stored.in_wishlist, false);
  });

  test('POST move-to-wishlist sets the wishlist flag', async () => {
    const { item, token } = await seedItem('editor');
    const res = await request(app).post(`/api/v1/items/${item._id}/move-to-wishlist`).set(bearer(token)).send({});
    assert.equal(res.status, 200);
    const stored: any = await itemModel(TEST_PLUGIN_KIND).findById(item._id).lean();
    assert.equal(stored.in_wishlist, true);
  });

  test('403 for a viewer on move-to-wishlist', async () => {
    const { item, viewerToken } = await seedWithViewer();
    const res = await request(app).post(`/api/v1/items/${item._id}/move-to-wishlist`).set(bearer(viewerToken)).send({});
    assert.equal(res.status, 403);
  });

  test('404 for a malformed id on move-to-collection', async () => {
    const { token } = await seedItem();
    const res = await request(app).post(`/api/v1/items/${invalidId}/move-to-collection`).set(bearer(token)).send({});
    assert.equal(res.status, 404);
  });
});

describe('POST /api/v1/items/:itemId/refresh-info', () => {
  test('200 applies the provider patch', async () => {
    const { item, token } = await seedItem('editor');
    const res = await request(app).post(`/api/v1/items/${item._id}/refresh-info`).set(bearer(token)).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.item.year, '1999');
    assert.equal(res.body.item.creator, 'Refreshed Creator');
  });

  test('404 when the plugin has no refresh provider', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'editor' }] });
    const item = await makeItem(NO_REFRESH_PLUGIN_KIND, { title: 'No refresh', owner: user._id, collection: collection._id });
    const res = await request(app)
      .post(`/api/v1/items/${item._id}/refresh-info`)
      .set(bearer(signAccessToken(user._id)))
      .send({});
    assert.equal(res.status, 404);
  });

  test('403 for a viewer', async () => {
    const { item, viewerToken } = await seedWithViewer();
    const res = await request(app).post(`/api/v1/items/${item._id}/refresh-info`).set(bearer(viewerToken)).send({});
    assert.equal(res.status, 403);
  });

  test('404 for an unknown id', async () => {
    const { token } = await seedItem();
    const res = await request(app).post(`/api/v1/items/${unknownId}/refresh-info`).set(bearer(token)).send({});
    assert.equal(res.status, 404);
  });
});
