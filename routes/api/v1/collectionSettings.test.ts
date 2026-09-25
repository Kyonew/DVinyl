import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Settings from '../../../models/Settings';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce, registerTestPlugin } from '../../../test/helpers/plugins';

const app = buildApiApp();
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

async function seed(role: 'admin' | 'editor' | 'viewer' = 'admin', withSettings = true) {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  if (withSettings) await makeSettings(collection);
  return { user, collection, token: signAccessToken(user._id) };
}

describe('GET /api/v1/collections/:id/settings', () => {
  test('401 without a bearer token', async () => {
    const { collection } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`);
    assert.equal(res.status, 401);
  });

  test('403 for a viewer', async () => {
    const { collection, token } = await seed('viewer');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(res.status, 403);
  });

  test('403 for an editor', async () => {
    const { collection, token } = await seed('editor');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(res.status, 403);
  });

  test('404 for a malformed collection id', async () => {
    const { token } = await seed();
    const res = await request(app).get('/api/v1/collections/not-an-id/settings').set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('404 for an unknown collection', async () => {
    const { token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${unknownId}/settings`).set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('200 fills defaults for every registered plugin and flattens theme', async () => {
    const { collection, token } = await seed('admin', false);
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(res.status, 200);
    const s = res.body.settings;
    assert.equal(s.theme.home, 'default');
    assert.equal(s.theme.testkind, 'default');
    assert.equal(s.theme.music, 'default');
    assert.equal(typeof s.modules.testkind, 'boolean');
    assert.equal(s.modules.music, true);
    assert.equal(s.aspectRatioClass, 'aspect-square');
    assert.equal(s.mergeDuplicates, true);
    assert.equal(s.fastAdd, '');
    // plugin-derived defaults, not empty: the schema seeds these from the registry
    assert.ok(Array.isArray(s.navbarShortcuts));
    assert.ok(Array.isArray(s.statsWidgets));
    assert.deepEqual(s.visibility.hiddenItems, []);
    assert.deepEqual(s.visibility.hiddenGenres, []);
    assert.deepEqual(s.visibility.hiddenTypes, []);
  });

  test('200 reflects a stored document', async () => {
    const { collection, token } = await seed('admin', false);
    await makeSettings(collection, {
      visibility: { applyToAdmin: true, hiddenItems: [], hiddenGenres: ['Rock'], hiddenTypes: [] },
      aspectRatioClass: 'aspect-[16/9]',
      'theme.home.preset': 'emerald'
    });
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.visibility.applyToAdmin, true);
    assert.deepEqual(res.body.settings.visibility.hiddenGenres, ['Rock']);
    assert.equal(res.body.settings.aspectRatioClass, 'aspect-[16/9]');
    assert.equal(res.body.settings.theme.home, 'emerald');
  });

  test('200 tolerates a stored hidden item that no longer exists', async () => {
    const { collection, token } = await seed();
    await makeSettings(collection, { visibility: { applyToAdmin: false, hiddenItems: [unknownId], hiddenGenres: [], hiddenTypes: [] } });
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings.visibility.hiddenItems, [unknownId]);
  });

  test('200 ignores stored settings for plugins that no longer exist', async () => {
    const { collection, token } = await seed();
    // Bypass Mongoose strict to simulate a document written before a plugin was removed.
    await Settings.collection.updateOne(
      { collection: collection._id },
      { $set: { 'theme.ghost': { preset: 'emerald' }, 'modules.ghost': true, 'pluginSettings.ghost': { x: true } } }
    );
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.theme.ghost, undefined);
    assert.equal(res.body.settings.modules.ghost, undefined);
    assert.equal(res.body.settings.pluginSettings.ghost, undefined);
  });
});
