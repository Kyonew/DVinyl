import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import apiV1Routes from './index';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem, itemModel } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import {
  loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_ID, TEST_PLUGIN_KIND, TEST_PLUGIN_TYPE
} from '../../../test/helpers/plugins';
import {
  registerImporterPlugin, IMPORTER_ID, ADMIN_IMPORTER_ID,
  IMPORTER_PLUGIN_ID, IMPORTER_PLUGIN_KIND, IMPORTER_PLUGIN_TYPE
} from '../../../test/helpers/plugins';

const app = buildApiApp();
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

// Same shim as test/helpers/app.ts, but with a translator that actually rewrites
// keys, so a response that leaked translated labels would be visible.
function buildTranslatingApp(): express.Express {
  const translatingApp = express();
  translatingApp.use(express.json({ limit: '50mb' }));
  translatingApp.use(express.urlencoded({ limit: '50mb', extended: true }));
  translatingApp.use((req: any, res: any, next: any) => {
    req.t = (key: string) => `TR:${key}`;
    req.io = { emit() {}, to() { return { emit() {} }; } };
    res.locals = {};
    next();
  });
  translatingApp.use('/api/v1', apiV1Routes);
  return translatingApp;
}

before(async () => { loadPluginsOnce(); registerTestPlugin(); registerImporterPlugin(); await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

async function seed(role: 'admin' | 'editor' | 'viewer' = 'admin', items = 0) {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  await makeSettings(collection, { modules: { [TEST_PLUGIN_TYPE]: true, [IMPORTER_PLUGIN_TYPE]: true } });
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

describe('GET /api/v1/collections/:id/importers', () => {
  test('401 without a token and 403 for a viewer', async () => {
    const { collection } = await seed();
    assert.equal((await request(app).get(`/api/v1/collections/${collection._id}/importers`)).status, 401);
    const viewer = await seed('viewer');
    const res = await request(app)
      .get(`/api/v1/collections/${viewer.collection._id}/importers`)
      .set(bearer(viewer.token));
    assert.equal(res.status, 403);
  });

  test('lists enabled importers with their ui and role flag', async () => {
    const { collection, token } = await seed();
    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/importers`)
      .set(bearer(token));
    assert.equal(res.status, 200);
    const test = res.body.importers.find((i: any) => i.id === IMPORTER_ID);
    assert.ok(test);
    assert.equal(test.pluginId, IMPORTER_PLUGIN_ID);
    assert.equal(test.requiresAdmin, false);
    assert.equal(typeof test.ui.label, 'string');
    const admin = res.body.importers.find((i: any) => i.id === ADMIN_IMPORTER_ID);
    assert.equal(admin.requiresAdmin, true);
    const generic = res.body.importers.find((i: any) => i.generic === true);
    assert.equal(generic.id, 'csv');
    assert.equal(generic.requiresAdmin, true);
  });

  test('omits importers of a disabled module', async () => {
    const { user } = await makeUser();
    const collection = await makeCollection({ members: [{ user, role: 'admin' }] });
    await makeSettings(collection, { modules: { [TEST_PLUGIN_TYPE]: true } });
    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/importers`)
      .set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 200);
    assert.equal(res.body.importers.some((i: any) => i.id === IMPORTER_ID), false);
  });

  test('exposes csv targets with importable fields for enabled plugins', async () => {
    const { collection, token } = await seed();
    const res = await request(app)
      .get(`/api/v1/collections/${collection._id}/importers`)
      .set(bearer(token));
    assert.ok(res.body.csv.delimiters.includes(','));
    assert.ok(res.body.csv.delimiters.includes(';'));
    const target = res.body.csv.targets.find((t: any) => t.pluginId === IMPORTER_PLUGIN_ID);
    assert.ok(target);
    assert.ok(target.fields.some((f: any) => f.name === 'title'));
  });

  test('returns raw i18n keys even when req.t translates', async () => {
    const { collection, token } = await seed();
    const res = await request(buildTranslatingApp())
      .get(`/api/v1/collections/${collection._id}/importers`)
      .set(bearer(token));
    assert.equal(res.status, 200);
    const generic = res.body.importers.find((i: any) => i.generic === true);
    assert.equal(generic.ui.description, 'admin.csv_import.subtitle');
    const target = res.body.csv.targets.find((t: any) => t.pluginId === IMPORTER_PLUGIN_ID);
    const title = target.fields.find((f: any) => f.name === 'title');
    assert.equal(title.label, 'admin.csv_import.field.title');
  });
});

async function waitForJob(token: string, path: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const res = await request(app).get(path).set(bearer(token));
    if (res.status !== 200) return res;
    last = res.body.job;
    if (last.status !== 'running') return res;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`job did not finish: ${JSON.stringify(last)}`);
}

function itemCount(kind: string, collectionId: any): Promise<number> {
  return itemModel(kind).countDocuments({ collection: collectionId });
}

describe('CSV preview and import', () => {
  test('preview returns columns and samples', async () => {
    const { collection, token } = await seed();
    const res = await request(app)
      .post(`/api/v1/collections/${collection._id}/imports/csv/preview`)
      .set(bearer(token))
      .send({ csv: 'Title,Creator\nAlpha,Ann' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.columns, ['Title', 'Creator']);
    assert.equal(res.body.total, 1);
  });

  test('preview 400 on an empty file', async () => {
    const { collection, token } = await seed();
    const res = await request(app)
      .post(`/api/v1/collections/${collection._id}/imports/csv/preview`)
      .set(bearer(token))
      .send({ csv: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('starts a job, creates items, and finishes with a normalized result', async () => {
    const { collection, token } = await seed();
    const start = await request(app)
      .post(`/api/v1/collections/${collection._id}/imports/csv`)
      .set(bearer(token))
      .send({
        csv: 'Title,Creator\nAlpha,Ann\nBeta,Bob',
        plugin: TEST_PLUGIN_ID,
        mapping: { title: { source: 'column', column: 'Title' }, creator: { source: 'column', column: 'Creator' } }
      });
    assert.equal(start.status, 202);
    assert.equal(start.body.job.status, 'running');
    assert.equal(start.body.job.pluginId, TEST_PLUGIN_ID);

    const done = await waitForJob(token, `/api/v1/collections/${collection._id}/imports/${start.body.job.id}`);
    assert.equal(done.body.job.status, 'finished');
    assert.equal(done.body.job.result.imported, 2);
    assert.equal(await itemCount(TEST_PLUGIN_KIND, collection._id), 2);
  });

  test('creates no job for an unknown module', async () => {
    const { collection, token } = await seed();
    const res = await request(app)
      .post(`/api/v1/collections/${collection._id}/imports/csv`)
      .set(bearer(token))
      .send({ csv: 'Title\nA', plugin: 'nope', mapping: {} });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unknown module: nope/);
  });

  test('creates no job when a required field is unmapped', async () => {
    const { collection, token } = await seed();
    const res = await request(app)
      .post(`/api/v1/collections/${collection._id}/imports/csv`)
      .set(bearer(token))
      .send({ csv: 'Creator\nAnn', plugin: TEST_PLUGIN_ID, mapping: { creator: { source: 'column', column: 'Creator' } } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Missing required fields/);
  });

  test('job poll 404 for an unknown id, and 403 for a viewer', async () => {
    const { collection, token } = await seed();
    assert.equal((await request(app).get(`/api/v1/collections/${collection._id}/imports/deadbeef`).set(bearer(token))).status, 404);
    const viewer = await seed('viewer');
    assert.equal((await request(app).get(`/api/v1/collections/${viewer.collection._id}/imports/deadbeef`).set(bearer(viewer.token))).status, 403);
  });

  test('job poll 404 when the job belongs to another collection', async () => {
    const first = await seed();
    const start = await request(app)
      .post(`/api/v1/collections/${first.collection._id}/imports/csv`)
      .set(bearer(first.token))
      .send({ csv: 'Title\nA', plugin: TEST_PLUGIN_ID, mapping: { title: { source: 'column', column: 'Title' } } });
    await waitForJob(first.token, `/api/v1/collections/${first.collection._id}/imports/${start.body.job.id}`);
    const second = await seed();
    const res = await request(app)
      .get(`/api/v1/collections/${second.collection._id}/imports/${start.body.job.id}`)
      .set(bearer(second.token));
    assert.equal(res.status, 404);
  });

  test('a second import on the same collection is 409 with the running job', async () => {
    const { collection, token } = await seed();
    const rows = Array.from({ length: 500 }, (_, i) => `Row ${i}`).join('\n');
    const body = { csv: `Title\n${rows}`, plugin: TEST_PLUGIN_ID, mapping: { title: { source: 'column', column: 'Title' } } };
    const first = await request(app).post(`/api/v1/collections/${collection._id}/imports/csv`).set(bearer(token)).send(body);
    assert.equal(first.status, 202);
    const second = await request(app).post(`/api/v1/collections/${collection._id}/imports/csv`).set(bearer(token)).send(body);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'import_running');
    assert.equal(second.body.job.id, first.body.job.id);
    await waitForJob(token, `/api/v1/collections/${collection._id}/imports/${first.body.job.id}`);
  });
});
