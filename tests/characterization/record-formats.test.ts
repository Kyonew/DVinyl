import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, exportInstance, itemByTitle, listedTitles, setupAdmin } from './fixtures';

const backend = backendFor('record_formats');

describe('record sizes, speeds and release types, and saved views', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, { title: 'Big Single', artist: 'A', format_type: 'Vinyl, 7"', variant_color: '45 RPM, Single, Blue' });
    await addMusic(admin, { title: 'Long Player', artist: 'A', format_type: '2xVinyl, LP, Album' });
    await addMusic(admin, { title: 'Chosen', artist: 'A', format_type: 'Vinyl, 12"', disc_size: '10"' });
  });
  after(async () => { await app?.stop(); });

  it('fills what older items already say, after a restore, without guessing', async () => {
    const backup = (await admin.get('/backup/collection/export')).json();
    // As an item from before the fields existed: none of them stored.
    for (const item of backup.albums) for (const f of ['disc_size', 'speed', 'release_type', 'disc_count']) if (item.title !== 'Chosen') delete item[f];
    assert.equal((await admin.postJson('/backup/collection/import', backup)).status, 200);

    const dump = await exportInstance(admin);
    const single = itemByTitle(dump, 'Big Single');
    assert.deepEqual([single.disc_size, single.speed, single.release_type], ['7"', '45 RPM', 'Single']);
    assert.equal(single.variant_color, 'Blue', 'format words leave the edition line');
    assert.match(single.format_type, /45 RPM/);
    const lp = itemByTitle(dump, 'Long Player');
    assert.deepEqual([lp.disc_size, lp.release_type, lp.disc_count], [undefined, 'LP', 2]);
    assert.equal(itemByTitle(dump, 'Chosen').disc_size, '10"', 'a value already set is left alone');
  });

  it('filters the collection on them from the start', async () => {
    const page = (await admin.get('/collection?type=music')).text;
    assert.match(page, /name="nf_speed"|data-filter="nf_speed"|nf_speed/);
    const html = (await admin.get('/collection?type=music&nf_speed=' + encodeURIComponent('45 RPM'))).text;
    assert.deepEqual(listedTitles(html, await exportInstance(admin)), ['Big Single']);
  });

  it('saves a view for every member, marks it when shown, and deletes it', async () => {
    let reply = await admin.postJson('/collection/saved-filters', { name: '45s', query: '?nf_speed=45+RPM&type=music&page=2' });
    assert.equal(reply.status, 200);
    const id = reply.json().filter.id;
    assert.equal((await admin.postJson('/collection/saved-filters', { name: '', query: 'type=music' })).status, 400);

    const shown = (await admin.get('/collection?type=music&nf_speed=45%20RPM')).text;
    assert.match(shown, /href="\/collection\?nf_speed=45\+RPM&amp;type=music"[^>]*>45s</);
    assert.match(shown, /bg-primary-theme text-white[^"]*">\s*<a href="\/collection\?nf_speed/);
    assert.doesNotMatch(shown, /<button type="button" data-save-view/, 'the view shown is already saved');
    assert.match((await admin.get('/collection?type=music')).text, /<button type="button" data-save-view/);

    assert.deepEqual((await exportInstance(admin)).settings[0].savedFilters, [{ id, name: '45s', query: 'nf_speed=45+RPM&type=music' }]);
    reply = await admin.postJson(`/collection/saved-filters/${id}/delete`, {});
    assert.equal(reply.status, 200);
    assert.equal((await exportInstance(admin)).settings[0].savedFilters.length, 0);
  });
});
