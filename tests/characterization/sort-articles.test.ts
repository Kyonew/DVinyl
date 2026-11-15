import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, enableModules, exportInstance, listedTitles, setupAdmin } from './fixtures';

const backend = backendFor('sort_articles');

describe('articles a collection ignores when sorting by title', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  const modulesForm = (extra: Record<string, string>) =>
    admin.postForm('/admin/modules/save', { musicActive: 'on', mergeDuplicates: 'on', ...extra });
  const sorted = async () => {
    const html = (await admin.get('/collection?sort=title_asc&view=table')).text;
    return listedTitles(html, await exportInstance(admin));
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['music']);
    for (const title of ['The Wall', 'Les Misérables', 'L’Écume des jours', 'Kind of Blue', 'Nevermind']) {
      await addMusic(admin, { title, artist: 'Someone' });
    }
  });
  after(async () => { await app?.stop(); });

  it('ignores English articles until the collection says otherwise', async () => {
    assert.deepEqual(await sorted(), ['Kind of Blue', 'Les Misérables', 'L’Écume des jours', 'Nevermind', 'The Wall']);
    assert.equal((await exportInstance(admin)).settings[0].sortArticles, undefined);
  });

  it('files every stored title again when the list changes, elided articles included', async () => {
    const reply = await modulesForm({ sortArticles: 'le, LA, les ; l’' });
    assert.equal(reply.status, 302);
    assert.deepEqual((await exportInstance(admin)).settings[0].sortArticles, ['le', 'la', 'les', "l'"]);
    assert.deepEqual(await sorted(), ['L’Écume des jours', 'Kind of Blue', 'Les Misérables', 'Nevermind', 'The Wall']);
  });

  it('uses the list on new items, and an empty list ignores nothing', async () => {
    await addMusic(admin, { title: 'La Bamba', artist: 'Someone' });
    const bamba = (await exportInstance(admin)).albums.find((a: any) => a.title === 'La Bamba');
    assert.equal(bamba.sort_title, 'bamba');

    await modulesForm({ sortArticles: '' });
    const titles = (await exportInstance(admin)).albums.map((a: any) => [a.title, a.sort_title]);
    assert.deepEqual(Object.fromEntries(titles)['La Bamba'], 'la bamba');
    assert.deepEqual(Object.fromEntries(titles)['The Wall'], 'the wall');
  });

  it('leaves the list alone when a form without the field is saved', async () => {
    await modulesForm({ sortArticles: 'the' });
    await modulesForm({});
    assert.deepEqual((await exportInstance(admin)).settings[0].sortArticles, ['the']);
  });

  it('brings the list back with a collection backup and files the items with it', async () => {
    const backup = (await admin.get('/backup/collection/export')).json();
    await modulesForm({ sortArticles: 'la' });
    const reply = await admin.postJson('/backup/collection/import', backup);
    assert.equal(reply.status, 200, reply.text.slice(0, 300));
    const dump = await exportInstance(admin);
    assert.deepEqual(dump.settings[0].sortArticles, ['the']);
    assert.equal(dump.albums.find((a: any) => a.title === 'La Bamba').sort_title, 'la bamba');
    assert.equal(dump.albums.find((a: any) => a.title === 'The Wall').sort_title, 'wall');
  });
});
