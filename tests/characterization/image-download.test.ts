import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { enableModules, exportInstance, itemByTitle, saveItem, setupAdmin } from './fixtures';

const backend = backendFor('image_download');
const LOOPBACK = 'http://127.0.0.1/cover.jpg';

describe('copies of linked images', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const modulesForm = (extra: Record<string, string>) => admin.postForm('/admin/modules/save', { dvdActive: 'on', mergeDuplicates: 'on', ...extra });
  const waitFor = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 50; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
    assert.fail('timed out');
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['dvd']);
  });
  after(async () => { await app?.stop(); });

  it('is off until the instance admin turns it on', async () => {
    assert.equal((await admin.get('/admin/instance/images')).json().enabled, false);
    assert.equal((await admin.postForm('/admin/instance/images', { enabled: 'on' })).status, 302);
    const state = (await admin.get('/admin/instance/images')).json();
    assert.equal(state.enabled, true);
    assert.ok(state.since);
  });

  it('never fetches an address of the machine itself, and does not try it again on its own', async () => {
    await saveItem(admin, 'dvd', { title: 'Loop', director: 'X', format: 'dvd', media_type: 'movie', images_json: JSON.stringify([LOOPBACK]) });
    await waitFor(async () => Array.isArray(itemByTitle(await exportInstance(admin), 'Loop').image_download_failed));
    const item = itemByTitle(await exportInstance(admin), 'Loop');
    assert.equal(item.cover_image, LOOPBACK);
    assert.deepEqual(item.image_download_failed, [LOOPBACK]);
    assert.equal(item.image_origins, undefined);
  });

  it('counts what an explicit run would take, per collection, as the collection says', async () => {
    assert.deepEqual((await admin.get('/admin/images')).json().pending, { items: 1, images: 1, failed: 1 });
    await modulesForm({ imageDownload: 'keep' });
    assert.deepEqual((await admin.get('/admin/images')).json().pending, { items: 0, images: 0, failed: 0 });
    await modulesForm({ imageDownload: 'download' });
    const settings = (await exportInstance(admin)).settings[0];
    assert.equal(settings.imageDownload, 'download');
    assert.ok(settings.imageDownloadSince);
  });

  it('runs once at a time and ends with what it did', async () => {
    const started = (await admin.postJson('/admin/images/run', {})).json();
    assert.equal(started.success, true);
    await waitFor(async () => (await admin.get('/admin/images')).json().status.running === false);
    const status = (await admin.get('/admin/images')).json().status;
    assert.deepEqual([status.items, status.doneItems, status.copied, status.failed], [1, 1, 0, 1]);
  });
});
