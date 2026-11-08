import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { enableModules, exportInstance, itemByTitle, listedTitles, saveItem, setupAdmin } from './fixtures';

const backend = backendFor('inside_items');

describe('an item kept inside another one', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const ids: Record<string, string> = {};
  const shelf = async (query = '') => {
    const html = (await admin.get(`/collection?type=dvd${query}`)).text;
    return listedTitles(html, await exportInstance(admin));
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['dvd']);
    for (const title of ['The Entire Mystery', 'Fire Walk with Me', 'Heat']) {
      await saveItem(admin, 'dvd', { title, director: 'Someone', format: 'bluray', media_type: 'movie', images_json: '[]' });
    }
    const dump = await exportInstance(admin);
    for (const title of ['The Entire Mystery', 'Fire Walk with Me', 'Heat']) ids[title] = String(itemByTitle(dump, title)._id);
  });
  after(async () => { await app?.stop(); });

  it('offers the boxes of the collection, the item itself left out', async () => {
    const reply = await admin.get(`/api/inside/candidates?item=${ids['Fire Walk with Me']}&q=myst`);
    assert.deepEqual(reply.json().items.map((i: any) => i.title), ['The Entire Mystery']);
  });

  it('leaves the shelf once inside, and comes back in a search', async () => {
    const reply = await admin.postJson(`/api/inside/${ids['Fire Walk with Me']}`, { box: ids['The Entire Mystery'] });
    assert.equal(reply.status, 200);
    assert.deepEqual((await shelf()).sort(), ['Heat', 'The Entire Mystery']);
    assert.deepEqual(await shelf('&search=Fire'), ['Fire Walk with Me']);
  });

  it('is listed on the box page, and the box on its own', async () => {
    const box = (await admin.get(`/dvd/${ids['The Entire Mystery']}`)).text;
    assert.match(box, /id="insideItems"/);
    assert.match(box, new RegExp(`href="/dvd/${ids['Fire Walk with Me']}"`));
    const film = (await admin.get(`/dvd/${ids['Fire Walk with Me']}`)).text;
    assert.match(film, new RegExp(`href="/dvd/${ids['The Entire Mystery']}"[^>]*>The Entire Mystery`));
  });

  it('refuses a box inside a box and an item holding others', async () => {
    assert.equal((await admin.postJson(`/api/inside/${ids['Heat']}`, { box: ids['Fire Walk with Me'] })).status, 400);
    assert.equal((await admin.postJson(`/api/inside/${ids['The Entire Mystery']}`, { box: ids['Heat'] })).status, 400);
    assert.equal((await admin.postJson(`/api/inside/${ids['Heat']}`, { box: ids['Heat'] })).status, 400);
  });

  it('goes back on the shelf when taken out', async () => {
    assert.equal((await admin.postJson(`/api/inside/${ids['Fire Walk with Me']}/out`, {})).status, 200);
    assert.deepEqual((await shelf()).sort(), ['Fire Walk with Me', 'Heat', 'The Entire Mystery']);
  });

  it('goes back on the shelf when its box is deleted', async () => {
    await admin.postJson(`/api/inside/${ids['Fire Walk with Me']}`, { box: ids['The Entire Mystery'] });
    assert.equal((await admin.delete(`/api/dvd/${ids['The Entire Mystery']}`)).status, 200);
    assert.deepEqual((await shelf()).sort(), ['Fire Walk with Me', 'Heat']);
    assert.equal(itemByTitle(await exportInstance(admin), 'Fire Walk with Me').inside, undefined);
  });
});
