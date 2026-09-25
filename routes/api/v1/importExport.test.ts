import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem, itemModel } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import {
  loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_KIND, TEST_PLUGIN_TYPE
} from '../../../test/helpers/plugins';

const app = buildApiApp();
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

before(async () => { loadPluginsOnce(); registerTestPlugin(); await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

async function seed(role: 'admin' | 'editor' | 'viewer' = 'admin', items = 0) {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  await makeSettings(collection, { modules: { [TEST_PLUGIN_TYPE]: true } });
  for (let i = 0; i < items; i++) {
    await makeItem(TEST_PLUGIN_KIND, { title: `Item ${i}`, creator: 'Ann', owner: user._id, collection: collection._id });
  }
  return { user, collection, token: signAccessToken(user._id) };
}

describe('GET /api/v1/collections/:id/export', () => {
  test('401 without a bearer token', async () => {
    const { collection } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/export`);
    assert.equal(res.status, 401);
  });

  test('403 for a non-admin member', async () => {
    const { collection, token } = await seed('editor');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/export`).set(bearer(token));
    assert.equal(res.status, 403);
  });

  test('404 for an unknown collection', async () => {
    const { token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${unknownId}/export`).set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('returns the collection dump as a JSON attachment', async () => {
    const { collection, token } = await seed('admin', 2);
    const res = await request(app).get(`/api/v1/collections/${collection._id}/export`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition']!, /^attachment; filename=dvinyl_collection-/);
    assert.match(res.headers['content-type']!, /application\/json/);
    assert.equal(res.body.albums.length, 2);
    assert.equal(res.body.metadata.type, 'collection');
  });
});

describe('GET /api/v1/collections/:id/export.csv', () => {
  test('returns a CSV attachment with a header and one row per item', async () => {
    const { collection, token } = await seed('admin', 2);
    const res = await request(app).get(`/api/v1/collections/${collection._id}/export.csv`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type']!, /text\/csv/);
    assert.match(res.headers['content-disposition']!, /\.csv$/);
    const body = res.text.replace(/^\uFEFF/, '');
    assert.equal(body.split('\n').length, 3);
  });

  test('403 for a viewer', async () => {
    const { collection, token } = await seed('viewer');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/export.csv`).set(bearer(token));
    assert.equal(res.status, 403);
  });
});

describe('GET /api/v1/collections/:id/export.zip', () => {
  test('returns a ZIP attachment', async () => {
    const { collection, token } = await seed('admin', 1);
    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/export.zip`)
      .set(bearer(token))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type']!, /application\/zip/);
    assert.equal((res.body as Buffer).subarray(0, 2).toString('binary'), 'PK');
  });
});
