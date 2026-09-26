import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeItem, itemModel } from '../../../test/helpers/factories';
import {
  loadPluginsOnce, registerRefreshPlugin, REFRESH_PLUGIN_KIND, refreshPluginState
} from '../../../test/helpers/plugins';
import { collectRefreshItems, runPluginRefresh } from '../../../utils/refreshAll';
import Item from '../../../models/Item';

before(async () => { loadPluginsOnce(); registerRefreshPlugin(); await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => {
  await clearDb();
  refreshPluginState.outcomes = [];
  refreshPluginState.calls = [];
  refreshPluginState.delayMs = 0;
});

async function seed(role: 'admin' = 'admin') {
  const { user } = await makeUser();
  const collection = await makeCollection({ members: [{ user, role }] });
  return { user, collection };
}

async function makeRefreshItem(user: any, collection: any, data: Record<string, any> = {}) {
  return makeItem(REFRESH_PLUGIN_KIND, {
    title: data.title ?? 'Item',
    owner: user._id,
    collection: collection._id,
    test_external_id: data.test_external_id ?? 'ext-1',
    ...data
  });
}

describe('collectRefreshItems', () => {
  test('selects only plugin items that carry an external id', async () => {
    const { user, collection } = await seed();
    const withId = await makeRefreshItem(user, collection, { test_external_id: 'x1' });
    const noId = await makeRefreshItem(user, collection, { title: 'No id', test_external_id: 'temp' });
    // Unset rather than omit: the schema defaults the path to '', and the web query only
    // excludes null/absent values, so an empty string would still be selected. Remove it.
    await itemModel(REFRESH_PLUGIN_KIND).updateOne({ _id: noId._id }, { $unset: { test_external_id: 1 } });

    const items = await collectRefreshItems(registerRefreshPlugin(), collection._id, 'all');
    assert.deepEqual(items.map((i: any) => String(i._id)), [String(withId._id)]);
  });

  test('mode "missing" narrows the selection to items with empty genre metadata', async () => {
    const { user, collection } = await seed();
    const empty = await makeRefreshItem(user, collection, { title: 'Empty', test_external_id: 'e1' });
    const full = await makeRefreshItem(user, collection, {
      title: 'Full', test_external_id: 'f1', genre: 'Rock', genres: ['Rock'], styles: ['Indie']
    });

    const items = await collectRefreshItems(registerRefreshPlugin(), collection._id, 'missing');
    const ids = items.map((i: any) => String(i._id));
    assert.ok(ids.includes(String(empty._id)));
    assert.ok(!ids.includes(String(full._id)));
  });
});

describe('runPluginRefresh', () => {
  test('refreshes each item and reports progress once per item', async () => {
    const { user, collection } = await seed();
    const first = await makeRefreshItem(user, collection, { title: 'First', test_external_id: 'a' });
    const second = await makeRefreshItem(user, collection, { title: 'Second', test_external_id: 'b' });
    const items = [first, second];

    const progress: string[] = [];
    const result = await runPluginRefresh({
      plugin: registerRefreshPlugin(),
      items,
      mode: 'all',
      req: {},
      onProgress: p => progress.push(`${p.current}/${p.total}`)
    });

    assert.deepEqual(result, { refreshed: 2, failed: 0 });
    assert.deepEqual(progress, ['1/2', '2/2']);
    const reloaded: any = await Item.findById(first._id).lean();
    assert.equal(reloaded.creator, 'Refreshed Creator');
    assert.ok(reloaded.synced_at, 'the sync stamp is written');
  });

  test('mode "missing" writes only genre fields', async () => {
    const { user, collection } = await seed();
    const item = await makeRefreshItem(user, collection, { title: 'Plain', creator: 'Original', test_external_id: 'm1' });

    const result = await runPluginRefresh({
      plugin: registerRefreshPlugin(), items: [item], mode: 'missing', req: {}
    });

    assert.deepEqual(result, { refreshed: 1, failed: 0 });
    const reloaded: any = await Item.findById(item._id).lean();
    assert.equal(reloaded.genre, 'Rock');
    assert.equal(reloaded.creator, 'Original', 'non-genre fields are untouched in missing mode');
  });

  test('a permanent failure counts as failed without aborting the run', async () => {
    const { user, collection } = await seed();
    const bad = await makeRefreshItem(user, collection, { title: 'Bad', test_external_id: 'bad' });
    const good = await makeRefreshItem(user, collection, { title: 'Good', test_external_id: 'good' });
    refreshPluginState.outcomes = ['permanent'];

    const result = await runPluginRefresh({
      plugin: registerRefreshPlugin(), items: [bad, good], mode: 'all', req: {}
    });

    assert.deepEqual(result, { refreshed: 1, failed: 1 });
    assert.equal(refreshPluginState.calls.length, 2, 'a permanent error is not retried');
  });

  test('a transient failure is retried and can still succeed', async () => {
    const { user, collection } = await seed();
    const item = await makeRefreshItem(user, collection, { title: 'Flaky', test_external_id: 'flaky' });
    refreshPluginState.outcomes = ['transient'];

    const result = await runPluginRefresh({
      plugin: registerRefreshPlugin(), items: [item], mode: 'all', req: {}
    });

    assert.deepEqual(result, { refreshed: 1, failed: 0 });
    assert.equal(refreshPluginState.calls.length, 2, 'the first attempt failed, the retry succeeded');
  });
});
