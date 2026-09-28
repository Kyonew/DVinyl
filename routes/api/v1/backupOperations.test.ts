import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionBackup, buildCollectionCsv } from '../../../utils/backupOperations';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeItem, makeSettings } from '../../../test/helpers/factories';
import { loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_KIND, TEST_PLUGIN_TYPE } from '../../../test/helpers/plugins';

before(async () => { loadPluginsOnce(); registerTestPlugin(); await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

async function seedCollection(items: any[] = []) {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role: 'admin' }] });
  const settings = await makeSettings(collection, { modules: { [TEST_PLUGIN_TYPE]: true } });
  const created: any[] = [];
  for (const item of items) {
    created.push(await makeItem(TEST_PLUGIN_KIND, { ...item, owner: user._id, collection: collection._id }));
  }
  return { collection, settings, created };
}

describe('buildCollectionBackup', () => {
  test('dumps the collection items and strips owner/collection/__v', async () => {
    const { collection, created } = await seedCollection([{ title: 'Alpha', creator: 'Ann' }]);
    const dump = await buildCollectionBackup(collection._id, collection);
    assert.equal(dump.collectionName, collection.name);
    assert.equal(dump.metadata.type, 'collection');
    assert.equal(dump.albums.length, 1);
    assert.equal(dump.albums[0].title, 'Alpha');
    assert.equal(dump.albums[0].owner, undefined);
    assert.equal(dump.albums[0].collection, undefined);
    assert.equal(dump.albums[0].__v, undefined);
    assert.equal(String(dump.albums[0]._id), String(created[0]._id));
  });

  test('carries the settings document without its internals', async () => {
    const { collection } = await seedCollection([]);
    const dump = await buildCollectionBackup(collection._id, collection);
    assert.ok(dump.settings);
    assert.equal(dump.settings._id, undefined);
    assert.equal(dump.settings.collection, undefined);
  });
});

describe('buildCollectionCsv', () => {
  test('renders a header plus one row per item and a BOM', async () => {
    const { collection, settings } = await seedCollection([
      { title: 'Alpha', creator: 'Ann' },
      { title: 'Beta', creator: 'Bob' }
    ]);
    const req: any = {
      t: (key: string, opts?: any) => opts?.defaultValue ?? key,
      get: () => 'localhost',
      protocol: 'http',
      headers: {}
    };
    const { csv, fileName } = await buildCollectionCsv({ req, collectionId: collection._id, collection, settings });
    assert.ok(csv.startsWith('\uFEFF'));
    const lines = csv.replace(/^\uFEFF/, '').split('\n');
    assert.equal(lines.length, 3);
    assert.match(fileName, /^dvinyl_collection-.*\.csv$/);
    assert.match(lines[0]!, /title/i);
    assert.match(lines[1]!, /Alpha/);
    assert.match(lines[2]!, /Beta/);
  });
});
