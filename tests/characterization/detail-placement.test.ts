import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, enableModules, exportInstance, itemByTitle, setupAdmin } from './fixtures';

const backend = backendFor('detail_placement');

describe('where fields sit on the item page', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let page: () => Promise<{ main: string; more: string }>;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['music']);
    await addMusic(admin, {
      title: 'Discovery', artist: 'Daft Punk', label: 'Virgin',
      pressing_plant: 'MPO', runouts_json: JSON.stringify([{ side: 'A', inscription: 'MPO 07243 A2', notes: 'runout' }])
    });
    const id = itemByTitle(await exportInstance(admin), 'Discovery')._id;
    page = async () => {
      const html = (await admin.get(`/album/${id}`)).text;
      const start = html.indexOf('<details');
      const end = html.indexOf('</details>', start);
      return start === -1 ? { main: html, more: '' } : { main: html.slice(0, start) + html.slice(end), more: html.slice(start, end) };
    };
  });
  after(async () => { await app?.stop(); });

  it('folds the pressing details of a record into More details by default', async () => {
    const { main, more } = await page();
    assert.match(more, /More details/);
    assert.match(more, /MPO 07243 A2/);
    assert.match(more, />MPO</);
    assert.doesNotMatch(main, /MPO 07243 A2/);
    assert.match(main, /Virgin/);
  });

  it('lets the collection show a field, hide another, and keeps only what differs', async () => {
    const reply = await admin.postJson('/create-plugin/customize/music', {
      detailFields: { runouts: 'shown', label: 'hidden', pressing_plant: 'more', nonsense: 'shown', year: 'everywhere' }
    });
    assert.equal(reply.status, 200, reply.text.slice(0, 300));
    const stored = (await exportInstance(admin)).settings[0].pluginCustomization.music.detailFields;
    assert.deepEqual(stored, { runouts: 'shown', label: 'hidden' });

    const { main, more } = await page();
    assert.match(main, /MPO 07243 A2/);
    assert.doesNotMatch(main + more, /Virgin/);
    assert.match(more, />MPO</);
  });

  it('offers every field of the page in the workshop, with where it sits', async () => {
    const html = (await admin.get('/create-plugin')).text;
    const data = html.match(/"detailChoices":(\[.*?\])/);
    assert.ok(data, 'detailChoices sent to the workshop');
    const choices = JSON.parse(data![1]!.replace(/\\u003c/g, '<'));
    const byName = Object.fromEntries(choices.map((c: any) => [c.name, c]));
    assert.equal(byName.runouts.placement, 'shown');
    assert.equal(byName.runouts.byDefault, 'more');
    assert.equal(byName.label.placement, 'hidden');
    assert.ok(!byName.title && !byName.artist && !byName.location);
  });
});
