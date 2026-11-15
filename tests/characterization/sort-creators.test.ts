import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, enableModules, exportInstance, itemByTitle, listedTitles, saveItem, setupAdmin } from './fixtures';

const backend = backendFor('sort_creators');

describe('sorting by creator with the articles the collection ignores', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  const modulesForm = (extra: Record<string, string>) =>
    admin.postForm('/admin/modules/save', { musicActive: 'on', mergeDuplicates: 'on', ...extra });
  const byArtist = async (dir = 'asc') => {
    const html = (await admin.get(`/collection?type=music&sort=artist_${dir}&view=table`)).text;
    return listedTitles(html, await exportInstance(admin));
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['music']);
    await addMusic(admin, { title: 'Revolver', artist: 'The Beatles' });
    await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles' });
    await addMusic(admin, { title: 'Arrival', artist: 'ABBA' });
    await addMusic(admin, { title: 'Parachutes', artist: 'Coldplay' });
    await addMusic(admin, { title: 'Ágætis byrjun', artist: 'Sigur Rós' });
    await addMusic(admin, { title: 'Disintegration', artist: 'the cure' });
  });
  after(async () => { await app?.stop(); });

  it('files "The Beatles" under B, ignores case and accents, and orders one artist by title', async () => {
    assert.deepEqual(await byArtist(), ['Arrival', 'Abbey Road', 'Revolver', 'Parachutes', 'Disintegration', 'Ágætis byrjun']);
    assert.equal(itemByTitle(await exportInstance(admin), 'Revolver').sort_creator, 'beatles');
  });

  it('follows an edited artist', async () => {
    const parachutes = itemByTitle(await exportInstance(admin), 'Parachutes');
    const reply = await saveItem(admin, 'music', {
      mongo_id: String(parachutes._id), title: 'Parachutes', artist: 'Zebra', media_type: 'vinyl', tracklist_json: '[]'
    });
    assert.equal(reply.status, 302);
    assert.equal(itemByTitle(await exportInstance(admin), 'Parachutes').sort_creator, 'zebra');
    assert.equal((await byArtist()).at(-1), 'Parachutes');
  });

  it('files every stored artist again when the list changes', async () => {
    await modulesForm({ sortArticles: '' });
    assert.equal(itemByTitle(await exportInstance(admin), 'Revolver').sort_creator, 'the beatles');
    assert.deepEqual(await byArtist(), ['Arrival', 'Ágætis byrjun', 'Abbey Road', 'Revolver', 'Disintegration', 'Parachutes']);
    await modulesForm({ sortArticles: 'the' });
    assert.equal(itemByTitle(await exportInstance(admin), 'Revolver').sort_creator, 'beatles');
  });

  it('brings the keys back with a collection backup', async () => {
    const backup = (await admin.get('/backup/collection/export')).json();
    const reply = await admin.postJson('/backup/collection/import', backup);
    assert.equal(reply.status, 200, reply.text.slice(0, 300));
    assert.equal(itemByTitle(await exportInstance(admin), 'Revolver').sort_creator, 'beatles');
  });
});
