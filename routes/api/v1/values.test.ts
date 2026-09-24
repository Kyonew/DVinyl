import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import {
  loadPluginsOnce, registerTestPlugin, registerEstimatePlugin,
  ESTIMATE_PLUGIN_KIND, TEST_PLUGIN_KIND, estimatePluginState
} from '../../../test/helpers/plugins';

const app = buildApiApp();

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  registerEstimatePlugin();
  await startDb();
});
after(async () => { await stopDb(); });
beforeEach(async () => {
  await clearDb();
  estimatePluginState.outcomes = [];
  estimatePluginState.calls = [];
  estimatePluginState.delayMs = 0;
});

const invalidId = 'not-an-object-id';
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

async function seedEstimable(role: 'admin' | 'editor' | 'viewer' = 'viewer', externalId = 'ext-1') {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  await makeSettings(collection);
  const item = await makeItem(ESTIMATE_PLUGIN_KIND, {
    title: 'Estimable', owner: user._id, collection: collection._id, test_external_id: externalId
  });
  return { user, collection, item, token: signAccessToken(user._id) };
}

describe('GET /api/v1/items/:itemId/estimate', () => {
  test('401 without a bearer token', async () => {
    const res = await request(app).get(`/api/v1/items/${unknownId}/estimate`);
    assert.equal(res.status, 401);
  });

  test('200 returns the provider estimate', async () => {
    const { item, token } = await seedEstimable();
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.estimate.source, 'market');
    assert.equal(res.body.estimate.price.value, 10);
    assert.equal(res.body.estimate.price.currency, 'EUR');
  });

  test('200 with estimate null when the provider has no price', async () => {
    const { item, token } = await seedEstimable();
    estimatePluginState.outcomes = ['null'];
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.estimate, null);
    assert.equal(res.body.reason, 'unavailable');
  });

  test('502 when the provider throws', async () => {
    const { item, token } = await seedEstimable();
    estimatePluginState.outcomes = ['throw'];
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(token));
    assert.equal(res.status, 502);
    assert.equal(res.body.success, false);
  });

  test('403 for a non-member', async () => {
    const { item } = await seedEstimable();
    const outsider = (await makeUser()).user;
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(signAccessToken(outsider._id)));
    assert.equal(res.status, 403);
  });

  test('404 when the plugin has no estimate capability', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'viewer' }] });
    const item = await makeItem(TEST_PLUGIN_KIND, { title: 'No estimate', owner: user._id, collection: collection._id });
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Price estimation is not supported for this item');
  });

  test('404 when the item has no external id', async () => {
    const { item, token } = await seedEstimable('viewer', '');
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('404 for an item hidden by collection visibility', async () => {
    const { user, collection, item } = await seedEstimable();
    await makeSettings(collection, { visibility: { hiddenItems: [item._id] } });
    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 404);
  });

  test('404 for a malformed id', async () => {
    const { token } = await seedEstimable();
    const res = await request(app).get(`/api/v1/items/${invalidId}/estimate`).set(bearer(token));
    assert.equal(res.status, 404);
  });
});
