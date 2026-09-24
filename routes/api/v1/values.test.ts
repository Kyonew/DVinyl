import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem, itemModel } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import {
  loadPluginsOnce, registerTestPlugin, registerEstimatePlugin,
  ESTIMATE_PLUGIN_KIND, TEST_PLUGIN_KIND, estimatePluginState
} from '../../../test/helpers/plugins';
import PriceHistory from '../../../models/PriceHistory';
import { resetValueEstimateJobs } from '../../../utils/valueEstimates';

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
  resetValueEstimateJobs();
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

const originalFetch = globalThis.fetch;

describe('GET /api/v1/items/:itemId/estimate — real music plugin', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  async function seedMusicItem() {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'viewer' }] });
    await makeSettings(collection);
    const item = await makeItem('Music', {
      title: 'Discovery', artist: 'Daft Punk', discogs_id: 12345, owner: user._id, collection: collection._id
    });
    return { item, token: signAccessToken(user._id) };
  }

  test('200 prices through the extracted Discogs logic without network', async () => {
    const { item, token } = await seedMusicItem();
    let calledUrl = '';
    globalThis.fetch = (async (url: any) => {
      calledUrl = String(url);
      return { ok: true, json: async () => ({ lowest_price: { value: 24.99, currency: 'EUR' }, num_for_sale: 7 }) };
    }) as any;

    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.estimate.source, 'market');
    assert.equal(res.body.estimate.price.value, 24.99);
    assert.match(calledUrl, /marketplace\/stats\/12345/);
  });

  test('502 when Discogs is unreachable', async () => {
    const { item, token } = await seedMusicItem();
    globalThis.fetch = (async () => { throw new Error('network down'); }) as any;

    const res = await request(app).get(`/api/v1/items/${item._id}/estimate`).set(bearer(token));
    assert.equal(res.status, 502);
    assert.equal(res.body.success, false);
  });
});

describe('GET /api/v1/collections/:id/value-history', () => {
  async function seedHistory(currency: 'EUR' | 'USD' = 'EUR') {
    const { user } = await makeUser();
    user.currency = currency;
    await user.save();
    const collection = await makeCollection({ members: [{ user, role: 'viewer' }] });
    await PriceHistory.create({ collection: collection._id, value: 100, minValue: 100, maxValue: 130, currency: 'EUR', itemCount: 5, capturedAt: new Date('2026-01-01') });
    await PriceHistory.create({ collection: collection._id, value: 120, minValue: 120, maxValue: 156, currency: 'EUR', itemCount: 5, capturedAt: new Date('2026-02-01') });
    await PriceHistory.create({ collection: collection._id, value: 99, minValue: 99, maxValue: 129, currency: 'USD', itemCount: 5, capturedAt: new Date('2026-01-15') });
    return { user, collection, token: signAccessToken(user._id) };
  }

  test('401 without a bearer token', async () => {
    const { collection } = await seedHistory();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/value-history`);
    assert.equal(res.status, 401);
  });

  test('200 returns only the reader currency, oldest first, plus otherCurrencies', async () => {
    const { collection, token } = await seedHistory('EUR');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/value-history`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.currency, 'EUR');
    assert.equal(res.body.snapshots.length, 2);
    assert.equal(res.body.snapshots[0].value, 100);
    assert.equal(res.body.snapshots[1].value, 120);
    assert.deepEqual(res.body.otherCurrencies, ['USD']);
  });

  test('200 empty when the collection has no history', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'viewer' }] });
    const res = await request(app).get(`/api/v1/collections/${collection._id}/value-history`).set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.snapshots, []);
  });

  test('403 for a non-member', async () => {
    const { collection } = await seedHistory();
    const outsider = (await makeUser()).user;
    const res = await request(app).get(`/api/v1/collections/${collection._id}/value-history`).set(bearer(signAccessToken(outsider._id)));
    assert.equal(res.status, 403);
  });

  test('404 for an unknown collection', async () => {
    const { user } = await makeUser();
    const res = await request(app).get(`/api/v1/collections/${unknownId}/value-history`).set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 404);
  });
});

async function waitForJob(token: string, collectionId: any, jobId: string, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await request(app)
      .get(`/api/v1/collections/${collectionId}/value-estimate/${jobId}`)
      .set(bearer(token));
    if (res.body?.estimate?.status !== 'running') return res.body.estimate;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('estimate job did not finish in time');
}

describe('value estimate job', () => {
  async function seedItems(count: number, role: 'editor' | 'viewer' = 'editor') {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role }] });
    await makeSettings(collection);
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push(await makeItem(ESTIMATE_PLUGIN_KIND, {
        title: `Item ${i}`, owner: user._id, collection: collection._id, test_external_id: `ext-${i}`
      }));
    }
    return { user, collection, items, token: signAccessToken(user._id) };
  }

  test('403 when the caller is only a viewer', async () => {
    const { collection, token } = await seedItems(1, 'viewer');
    const res = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(token)).send({});
    assert.equal(res.status, 403);
  });

  test('400 when there are no estimable items', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'editor' }] });
    await makeSettings(collection);
    const res = await request(app)
      .post(`/api/v1/collections/${collection._id}/value-estimate`)
      .set(bearer(signAccessToken(user._id))).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'No estimable items');
  });

  test('202 then done with summed totals and a saved snapshot', async () => {
    const { collection, items, token } = await seedItems(2);
    await itemModel(ESTIMATE_PLUGIN_KIND).updateOne({ _id: items[1]._id }, { $set: { quantity: 3 } });

    const start = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(token)).send({});
    assert.equal(start.status, 202);
    assert.equal(start.body.estimate.status, 'running');
    assert.equal(start.body.estimate.progress.total, 2);

    const job = await waitForJob(token, collection._id, start.body.estimate.id);
    assert.equal(job.status, 'done');
    assert.equal(job.result.value, 40);      // 10*1 + 10*3
    assert.equal(job.result.minValue, 40);
    assert.equal(job.result.maxValue, 80);   // * maxMultiplier 2
    assert.equal(job.result.pricedCount, 2);
    assert.equal(job.result.failedCount, 0);
    assert.equal(job.result.saved, true);
    assert.equal(await PriceHistory.countDocuments({ collection: collection._id }), 1);
  });

  test('does not save a snapshot below the 50% priced guard', async () => {
    const { collection, token } = await seedItems(4);
    estimatePluginState.outcomes = ['ok', 'null', 'null', 'null'];

    const start = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(token)).send({});
    const job = await waitForJob(token, collection._id, start.body.estimate.id);
    assert.equal(job.result.pricedCount, 1);
    assert.equal(job.result.saved, false);
    assert.equal(await PriceHistory.countDocuments({ collection: collection._id }), 0);
  });

  test('counts a throwing provider as failed and still finishes done', async () => {
    const { collection, token } = await seedItems(2);
    estimatePluginState.outcomes = ['throw', 'throw'];

    const start = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(token)).send({});
    const job = await waitForJob(token, collection._id, start.body.estimate.id);
    assert.equal(job.status, 'done');
    assert.equal(job.result.pricedCount, 0);
    assert.equal(job.result.failedCount, 2);
    assert.equal(job.result.saved, false);
  });

  test('409 while a run is active, returning the active job', async () => {
    const { collection, token } = await seedItems(3);
    estimatePluginState.delayMs = 30;

    const first = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(token)).send({});
    assert.equal(first.status, 202);

    const second = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(token)).send({});
    assert.equal(second.status, 409);
    assert.equal(second.body.estimate.id, first.body.estimate.id);

    await waitForJob(token, collection._id, first.body.estimate.id);
  });

  test('404 for an unknown job id', async () => {
    const { collection, token } = await seedItems(1);
    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/value-estimate/${unknownId}`)
      .set(bearer(token));
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Estimate not found');
  });

  test("404 polling another user's job", async () => {
    const owner = (await makeUser()).user;
    const other = (await makeUser()).user;
    const collection = await makeCollection({ members: [{ user: owner, role: 'editor' }, { user: other, role: 'viewer' }] });
    await makeSettings(collection);
    await makeItem(ESTIMATE_PLUGIN_KIND, { title: 'A', owner: owner._id, collection: collection._id, test_external_id: 'ext-1' });
    const ownerToken = signAccessToken(owner._id);
    const otherToken = signAccessToken(other._id);

    const start = await request(app).post(`/api/v1/collections/${collection._id}/value-estimate`).set(bearer(ownerToken)).send({});
    assert.equal(start.status, 202);

    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/value-estimate/${start.body.estimate.id}`)
      .set(bearer(otherToken));
    assert.equal(res.status, 404);

    await waitForJob(ownerToken, collection._id, start.body.estimate.id);
  });
});
