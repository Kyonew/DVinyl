import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Settings from '../../../models/Settings';
import { buildSettingsOptions } from '../../../utils/collectionSettings';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { registry } from '../../../core/registry';
import { CARD_ASPECT_RATIOS } from '../../../core/customPlugin';
import {
  loadPluginsOnce, registerTestPlugin, registerOptionsPlugin,
  TEST_PLUGIN_KIND, TEST_PLUGIN_TYPE,
  OPTIONS_PLUGIN_ID, OPTIONS_PLUGIN_TYPE, OPTIONS_SETTING_KEY,
  OPTIONS_NAVBAR_IDS, OPTIONS_WIDGET_ID, OPTIONS_FAST_ADD
} from '../../../test/helpers/plugins';

const app = buildApiApp();
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  registerOptionsPlugin();
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

describe('PATCH /api/v1/collections/:id/settings', () => {
  async function patch(token: string, collection: any, body: any) {
    return request(app)
      .patch(`/api/v1/collections/${collection._id}/settings`)
      .set(bearer(token))
      .send(body);
  }

  test('401 without a bearer token', async () => {
    const { collection } = await seed();
    const res = await request(app).patch(`/api/v1/collections/${collection._id}/settings`).send({});
    assert.equal(res.status, 401);
  });

  test('403 for a viewer', async () => {
    const { collection, token } = await seed('viewer');
    const res = await patch(token, collection, { mergeDuplicates: false });
    assert.equal(res.status, 403);
  });

  test('400 for an empty body', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, {});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Nothing to update');
  });

  test('400 for an unknown top-level field', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { modulesX: {} });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unknown field/);
  });

  test('400 when every module is switched off', async () => {
    const { collection, token } = await seed();
    const modules: Record<string, boolean> = {};
    for (const p of registry.getAll()) modules[p.collectionType] = false;
    const res = await patch(token, collection, { modules });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'no_module');
  });

  test('400 for an unknown module', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { modules: { nope: true } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unknown module/);
  });

  test('400 for a non-boolean module value', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { modules: { [OPTIONS_PLUGIN_TYPE]: 'yes' } });
    assert.equal(res.status, 400);
  });

  test('modules merge one flip and leave the others', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { modules: { [OPTIONS_PLUGIN_TYPE]: false } });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.modules[OPTIONS_PLUGIN_TYPE], false);
    assert.equal(res.body.settings.modules.music, true);
  });

  test('mergeDuplicates toggles', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { mergeDuplicates: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.mergeDuplicates, false);
  });

  test('400 for a non-boolean mergeDuplicates', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { mergeDuplicates: 'nope' });
    assert.equal(res.status, 400);
  });

  test('pluginSettings round-trips a declared boolean', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, {
      pluginSettings: { [OPTIONS_PLUGIN_ID]: { [OPTIONS_SETTING_KEY]: true } }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.pluginSettings[OPTIONS_PLUGIN_ID][OPTIONS_SETTING_KEY], true);
  });

  test('400 for an unknown plugin in pluginSettings', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { pluginSettings: { nope: { x: true } } });
    assert.equal(res.status, 400);
  });

  test('400 for an unknown setting key', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { pluginSettings: { [OPTIONS_PLUGIN_ID]: { nope: true } } });
    assert.equal(res.status, 400);
  });

  test('visibility merges sub-fields without touching modules', async () => {
    const { collection, token } = await seed();
    const first = await patch(token, collection, { visibility: { applyToAdmin: true } });
    assert.equal(first.status, 200);
    assert.equal(first.body.settings.visibility.applyToAdmin, true);
    assert.equal(first.body.settings.modules.music, true);

    const second = await patch(token, collection, { visibility: { hiddenGenres: ['Rock', 'Jazz'] } });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.settings.visibility.hiddenGenres, ['Rock', 'Jazz']);
    assert.equal(second.body.settings.visibility.applyToAdmin, true);
  });

  test('hiddenItems accepts an item in the collection and clears with []', async () => {
    const { user, collection, token } = await seed();
    const item = await makeItem(TEST_PLUGIN_KIND, { title: 'Hidden', owner: user._id, collection: collection._id });
    const set = await patch(token, collection, { visibility: { hiddenItems: [String(item._id)] } });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body.settings.visibility.hiddenItems, [String(item._id)]);

    const cleared = await patch(token, collection, { visibility: { hiddenItems: [] } });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.settings.visibility.hiddenItems, []);
  });

  test('400 for a hidden item from another collection', async () => {
    const { user, collection, token } = await seed();
    const other = await makeCollection({ members: [{ user, role: 'admin' }] });
    const foreign = await makeItem(TEST_PLUGIN_KIND, { title: 'Foreign', owner: user._id, collection: other._id });
    const res = await patch(token, collection, { visibility: { hiddenItems: [String(foreign._id)] } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /does not exist in this collection/);
  });

  test('400 for a malformed hidden item id', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { visibility: { hiddenItems: ['not-an-id'] } });
    assert.equal(res.status, 400);
  });

  test('hiddenTypes takes a plugin kind, not a collectionType', async () => {
    const { collection, token } = await seed();
    const bad = await patch(token, collection, { visibility: { hiddenTypes: [TEST_PLUGIN_TYPE] } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Unknown item type/);

    const good = await patch(token, collection, { visibility: { hiddenTypes: [TEST_PLUGIN_KIND] } });
    assert.equal(good.status, 200);
    assert.deepEqual(good.body.settings.visibility.hiddenTypes, [TEST_PLUGIN_KIND]);
  });

  test('400 when a visibility list exceeds the cap', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { visibility: { hiddenGenres: Array(501).fill('Rock') } });
    assert.equal(res.status, 400);
  });

  test('theme accepts valid presets for home and a plugin', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { theme: { home: 'emerald', [OPTIONS_PLUGIN_TYPE]: 'forest' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.theme.home, 'emerald');
    assert.equal(res.body.settings.theme[OPTIONS_PLUGIN_TYPE], 'forest');
  });

  test('400 for an invalid theme preset', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { theme: { home: 'neon' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid theme preset/);
  });

  test('400 for an unknown theme key', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { theme: { nope: 'default' } });
    assert.equal(res.status, 400);
  });

  test('aspectRatioClass accepts an allowed value and rejects others', async () => {
    const { collection, token } = await seed();
    const ok = await patch(token, collection, { aspectRatioClass: 'aspect-[16/9]' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.settings.aspectRatioClass, 'aspect-[16/9]');
    const bad = await patch(token, collection, { aspectRatioClass: 'aspect-[3/4]' });
    assert.equal(bad.status, 400);
  });

  test('navbarShortcuts accepts known ids and dedupes', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { navbarShortcuts: ['global_home', 'global_home', OPTIONS_NAVBAR_IDS[0]] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings.navbarShortcuts, ['global_home', OPTIONS_NAVBAR_IDS[0]]);
  });

  test('400 for more than six navbar shortcuts', async () => {
    const { collection, token } = await seed();
    const seven = ['global_home', 'global_collection', 'global_wishlist', ...OPTIONS_NAVBAR_IDS].slice(0, 7);
    assert.equal(seven.length, 7);
    const res = await patch(token, collection, { navbarShortcuts: seven });
    assert.equal(res.status, 400);
  });

  test('400 for an unknown navbar shortcut', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { navbarShortcuts: ['nope'] });
    assert.equal(res.status, 400);
  });

  test('statsWidgets accepts a declared widget and rejects unknown', async () => {
    const { collection, token } = await seed();
    const ok = await patch(token, collection, { statsWidgets: ['total', OPTIONS_WIDGET_ID] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.settings.statsWidgets, ['total', OPTIONS_WIDGET_ID]);
    const bad = await patch(token, collection, { statsWidgets: ['nope'] });
    assert.equal(bad.status, 400);
  });

  test('fastAdd accepts a declared value or the disabled empty string', async () => {
    const { collection, token } = await seed();
    const ok = await patch(token, collection, { fastAdd: OPTIONS_FAST_ADD });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.settings.fastAdd, OPTIONS_FAST_ADD);
    const off = await patch(token, collection, { fastAdd: '' });
    assert.equal(off.status, 200);
    assert.equal(off.body.settings.fastAdd, '');
    const bad = await patch(token, collection, { fastAdd: 'nope' });
    assert.equal(bad.status, 400);
  });

  test('rejects nested values of the wrong type without a 500', async () => {
    const { collection, token } = await seed();
    assert.equal((await patch(token, collection, { visibility: 'nope' })).status, 400);
    assert.equal((await patch(token, collection, { visibility: { hiddenItems: 'nope' } })).status, 400);
    assert.equal((await patch(token, collection, { theme: null })).status, 400);
    assert.equal((await patch(token, collection, { navbarShortcuts: 'nope' })).status, 400);
  });

  test('a failed PATCH writes nothing', async () => {
    const { collection, token } = await seed();
    await patch(token, collection, { aspectRatioClass: 'aspect-[16/9]' });
    const failed = await patch(token, collection, { aspectRatioClass: 'nope' });
    assert.equal(failed.status, 400);
    const after = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(after.body.settings.aspectRatioClass, 'aspect-[16/9]');
  });

  test('the same PATCH twice is idempotent', async () => {
    const { collection, token } = await seed();
    const body = { visibility: { applyToAdmin: true }, statsWidgets: ['total'] };
    const a = await patch(token, collection, body);
    const b = await patch(token, collection, body);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.settings.visibility, a.body.settings.visibility);
    assert.deepEqual(b.body.settings.statsWidgets, a.body.settings.statsWidgets);
  });

  test('module activity mirrors enabledByDefault when a stored doc predates a plugin', async () => {
    const { collection, token } = await seed();
    // Simulate a Settings doc written before `music` (enabledByDefault: true) existed.
    await Settings.collection.updateOne({ collection: collection._id }, { $unset: { 'modules.music': '' } });
    const storedModules: Record<string, boolean> = {};
    for (const p of registry.getAll()) {
      if (p.collectionType !== 'music') storedModules[p.collectionType] = false;
    }
    const res = await patch(token, collection, { modules: storedModules });
    assert.equal(res.status, 200); // music is absent from the doc but enabled by default
    assert.equal(res.body.settings.modules.music, true);
  });

  test('400 for a mixed valid+invalid payload writes nothing', async () => {
    const { collection, token } = await seed();
    const res = await patch(token, collection, { mergeDuplicates: false, modules: { nope: true } });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    const after = await request(app).get(`/api/v1/collections/${collection._id}/settings`).set(bearer(token));
    assert.equal(after.body.settings.mergeDuplicates, true);
  });

  test('404 for a malformed or unknown collection on PATCH', async () => {
    const { token } = await seed();
    const malformed = await request(app).patch('/api/v1/collections/not-an-id/settings').set(bearer(token)).send({ mergeDuplicates: false });
    assert.equal(malformed.status, 404);
    const unknown = await request(app).patch(`/api/v1/collections/${unknownId}/settings`).set(bearer(token)).send({ mergeDuplicates: false });
    assert.equal(unknown.status, 404);
  });
});

describe('GET /api/v1/collections/:id/settings/options', () => {
  test('401 without a bearer token', async () => {
    const { collection } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`);
    assert.equal(res.status, 401);
  });

  test('403 for a viewer', async () => {
    const { collection, token } = await seed('viewer');
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    assert.equal(res.status, 403);
  });

  test('404 for an unknown collection', async () => {
    const { token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${unknownId}/settings/options`).set(bearer(token));
    assert.equal(res.status, 404);
  });

  test('200 exposes every registered plugin as a module with its settings schema', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    assert.equal(res.status, 200);
    const options = res.body.options;
    const ids = options.modules.map((m: any) => m.pluginId);
    assert.ok(ids.includes('music'));
    assert.ok(ids.includes(OPTIONS_PLUGIN_ID));

    const ours = options.modules.find((m: any) => m.pluginId === OPTIONS_PLUGIN_ID);
    assert.equal(ours.collectionType, OPTIONS_PLUGIN_TYPE);
    assert.equal(ours.enabledByDefault, false);
    assert.equal(ours.apiKeysReady, true);
    assert.equal(ours.settings[0].key, OPTIONS_SETTING_KEY);
    assert.equal(ours.settings[0].type, 'boolean');
  });

  test('200 exposes theme presets including default', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    const presets = res.body.options.themePresets;
    assert.ok(presets.some((p: any) => p.value === 'default'));
    assert.equal(typeof presets[0].label, 'string');
  });

  test('200 exposes exactly the allowed aspect ratios', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    assert.deepEqual(
      res.body.options.aspectRatios.map((a: any) => a.value),
      [...CARD_ASPECT_RATIOS]
    );
  });

  test('200 exposes global and plugin navbar shortcut groups', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    const groups = res.body.options.navbarShortcuts;
    assert.equal(groups[0].group, 'global');
    assert.ok(groups[0].options.some((o: any) => o.id === 'global_home' && o.label === 'nav.home'));
    const ours = groups.find((g: any) => g.pluginId === OPTIONS_PLUGIN_ID);
    assert.deepEqual(ours.options.map((o: any) => o.id), OPTIONS_NAVBAR_IDS);
  });

  test('200 exposes stats widgets with their kind', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    const groups = res.body.options.statsWidgets;
    const global = groups[0];
    assert.equal(global.group, 'global');
    assert.equal(global.options[0].id, 'total');
    assert.equal(global.options[0].kind, 'count');
    const ours = groups.find((g: any) => g.pluginId === OPTIONS_PLUGIN_ID);
    assert.deepEqual(ours.options.map((w: any) => w.id), [OPTIONS_WIDGET_ID]);
  });

  test('200 exposes the disabled fastAdd entry plus plugin options', async () => {
    const { collection, token } = await seed();
    const res = await request(app).get(`/api/v1/collections/${collection._id}/settings/options`).set(bearer(token));
    const fastAdd = res.body.options.fastAdd;
    assert.equal(fastAdd[0].value, '');
    const ours = fastAdd.find((o: any) => o.value === OPTIONS_FAST_ADD);
    assert.equal(ours.pluginId, OPTIONS_PLUGIN_ID);
  });

  test('the builder is pure and needs no collection document', async () => {
    const options = buildSettingsOptions();
    assert.ok(Array.isArray(options.modules));
    assert.ok(Array.isArray(options.themePresets));
    assert.ok(Array.isArray(options.aspectRatios));
    assert.ok(Array.isArray(options.navbarShortcuts));
    assert.ok(Array.isArray(options.statsWidgets));
    assert.ok(Array.isArray(options.fastAdd));
  });
});
