import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeItem, itemModel } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import {
  loadPluginsOnce, registerTestPlugin, registerRefreshPlugin, registerNoRefreshPlugin,
  TEST_PLUGIN_ID, TEST_PLUGIN_KIND, REFRESH_PLUGIN_KIND, REFRESH_PLUGIN_ID, NO_REFRESH_PLUGIN_ID,
  refreshPluginState
} from '../../../test/helpers/plugins';
import { clearRefreshJobs } from '../../../utils/refreshJobs';

const app = buildApiApp();
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  registerRefreshPlugin();
  registerNoRefreshPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
beforeEach(async () => {
  await clearDb();
  clearRefreshJobs();
  refreshPluginState.outcomes = [];
  refreshPluginState.calls = [];
  refreshPluginState.delayMs = 0;
});

async function seed(role: 'admin' | 'editor' | 'viewer' = 'admin', items = 0) {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  const created = [];
  for (let i = 0; i < items; i++) {
    created.push(await makeItem(REFRESH_PLUGIN_KIND, {
      title: `Item ${i}`, owner: user._id, collection: collection._id, test_external_id: `ext-${i}`
    }));
  }
  return { user, collection, items: created, token: signAccessToken(user._id) };
}

async function waitForRefreshJob(token: string, collectionId: any, jobId: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await request(app)
      .get(`/api/v1/collections/${collectionId}/refresh-jobs/${jobId}`)
      .set(bearer(token));
    if (res.status !== 200) return res;
    last = res.body.job;
    if (last.status !== 'running') return res;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`refresh job did not finish: ${JSON.stringify(last)}`);
}

describe('POST /api/v1/collections/:id/refresh-all', () => {
  test('401 without a bearer token', async () => {
    const { collection } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 401);
  });

  test('403 for a non-admin member', async () => {
    const { collection, token } = await seed('editor');
    const res = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 403);
  });

  test('404 for an unknown collection', async () => {
    const { token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${unknownId}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 404);
  });

  test('404 for an unknown plugin', async () => {
    const { collection, token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: 'nope' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Plugin not found');
  });

  test('400 when the plugin cannot refresh', async () => {
    const { collection, token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: NO_REFRESH_PLUGIN_ID });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Plugin does not support refresh');
  });

  test('400 for an invalid mode', async () => {
    const { collection, token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID, mode: 'everything' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid mode');
  });

  test('202 returns a running job, then it finishes with counts', async () => {
    const { collection, token } = await seed('admin', 3);
    const start = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(start.status, 202);
    assert.equal(start.body.job.status, 'running');
    assert.equal(start.body.job.pluginId, REFRESH_PLUGIN_ID);
    assert.equal(start.body.job.mode, 'all');

    const done = await waitForRefreshJob(token, collection._id, start.body.job.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.job.status, 'finished');
    assert.deepEqual(done.body.job.result, { refreshed: 3, failed: 0, total: 3 });
    assert.equal(done.body.job.current, 3);
  });

  test('mode omitted defaults to all', async () => {
    const { collection, token } = await seed('admin', 1);
    const start = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(start.body.job.mode, 'all');
    await waitForRefreshJob(token, collection._id, start.body.job.id);
  });

  test('a zero-item refresh still returns 202 and finishes with total 0', async () => {
    const { collection, token } = await seed('admin', 0);
    const start = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(start.status, 202);
    const done = await waitForRefreshJob(token, collection._id, start.body.job.id);
    assert.equal(done.body.job.status, 'finished');
    assert.deepEqual(done.body.job.result, { refreshed: 0, failed: 0, total: 0 });
  });

  test('409 with the running job for the same collection and plugin', async () => {
    const { collection, token } = await seed('admin', 2);
    refreshPluginState.delayMs = 200;
    const first = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(first.status, 202);

    const second = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'refresh_running');
    assert.equal(second.body.job.id, first.body.job.id);

    await waitForRefreshJob(token, collection._id, first.body.job.id);
  });

  test('a different plugin is not blocked by a running refresh', async () => {
    const { collection, token, user } = await seed('admin', 2);
    await makeItem(TEST_PLUGIN_KIND, {
      title: 'Other', owner: user._id, collection: collection._id, test_external_id: 'other-1'
    });
    refreshPluginState.delayMs = 200;
    const first = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: REFRESH_PLUGIN_ID });
    assert.equal(first.status, 202);

    const second = await request(app).post(`/api/v1/collections/${collection._id}/refresh-all`).set(bearer(token)).send({ pluginId: TEST_PLUGIN_ID });
    assert.equal(second.status, 202);

    await waitForRefreshJob(token, collection._id, first.body.job.id);
    await waitForRefreshJob(token, collection._id, second.body.job.id);
  });
});

describe('GET /api/v1/collections/:id/refresh-jobs/:jobId', () => {
  test('403 for a non-admin member', async () => {
    const { collection, token } = await seed('editor');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/refresh-jobs/abc`).set(bearer(token));
    assert.equal(res.status, 403);
  });

  test('404 for an unknown job id', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/refresh-jobs/nope`).set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('404 when polling a job from another collection', async () => {
    const first = await seed('admin', 1);
    const second = await seed('admin', 1);
    const start = await request(app).post(`/api/v1/collections/${first.collection._id}/refresh-all`).set(bearer(first.token)).send({ pluginId: REFRESH_PLUGIN_ID });

    const res = await request(app)
      .get(`/api/v1/collections/${second.collection._id}/refresh-jobs/${start.body.job.id}`)
      .set(bearer(second.token));
    assert.equal(res.status, 404);

    await waitForRefreshJob(first.token, first.collection._id, start.body.job.id);
  });
});

describe('POST /api/v1/collections/:id/delete-last-items', () => {
  test('401 without a bearer token', async () => {
    const { collection } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).send({ count: 1, pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 401);
  });

  test('403 for a non-admin member', async () => {
    const { collection, token } = await seed('editor');
    const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).set(bearer(token)).send({ count: 1, pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 403);
  });

  test('404 for an unknown collection', async () => {
    const { token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${unknownId}/delete-last-items`).set(bearer(token)).send({ count: 1, pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 404);
  });

  test('400 for a missing, zero, fractional or over-cap count', async () => {
    const { collection, token } = await seed();
    for (const count of [undefined, 0, -1, 1.5, 10001]) {
      const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).set(bearer(token)).send({ count, pluginId: REFRESH_PLUGIN_ID });
      assert.equal(res.status, 400, `count=${count}`);
      assert.equal(res.body.error, 'Invalid count');
    }
  });

  test('accepts count 10000', async () => {
    const { collection, token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).set(bearer(token)).send({ count: 10000, pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 0);
  });

  test('400 for an unknown plugin', async () => {
    const { collection, token } = await seed();
    const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).set(bearer(token)).send({ count: 1, pluginId: 'nope' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Unknown plugin');
  });

  test('deletes the newest N items of the plugin and leaves the rest', async () => {
    const { user, collection, token } = await seed();
    const base = Date.now();
    const older = await makeItem(REFRESH_PLUGIN_KIND, { title: 'Older', owner: user._id, collection: collection._id, added_at: new Date(base - 3000) });
    const middle = await makeItem(REFRESH_PLUGIN_KIND, { title: 'Middle', owner: user._id, collection: collection._id, added_at: new Date(base - 2000) });
    const newest = await makeItem(REFRESH_PLUGIN_KIND, { title: 'Newest', owner: user._id, collection: collection._id, added_at: new Date(base - 1000) });
    const otherPlugin = await makeItem(TEST_PLUGIN_KIND, { title: 'Other', owner: user._id, collection: collection._id, added_at: new Date(base) });

    const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).set(bearer(token)).send({ count: 1, pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 1);

    assert.equal(await itemModel(REFRESH_PLUGIN_KIND).countDocuments({ _id: newest._id }), 0);
    assert.equal(await itemModel(REFRESH_PLUGIN_KIND).countDocuments({ _id: middle._id }), 1);
    assert.equal(await itemModel(REFRESH_PLUGIN_KIND).countDocuments({ _id: older._id }), 1);
    assert.equal(await itemModel(TEST_PLUGIN_KIND).countDocuments({ _id: otherPlugin._id }), 1);
  });

  test('deleted counts cascaded contents, so it can exceed count', async () => {
    const { user, collection, token } = await seed();
    const parent = await makeItem(REFRESH_PLUGIN_KIND, { title: 'Show', owner: user._id, collection: collection._id });
    await makeItem(REFRESH_PLUGIN_KIND, { title: 'Season', owner: user._id, collection: collection._id, parent: parent._id });

    const res = await request(app).post(`/api/v1/collections/${collection._id}/delete-last-items`).set(bearer(token)).send({ count: 1, pluginId: REFRESH_PLUGIN_ID });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 2, 'the parent and its season are both counted');
    assert.equal(await itemModel(REFRESH_PLUGIN_KIND).countDocuments({ _id: parent._id }), 0);
  });
});
