import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, exportInstance, itemByTitle, listedTitles, setupAdmin } from './fixtures';

const backend = backendFor('pressing');

describe('pressing details, runouts and repeating fields', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, {
      title: 'Pride', artist: 'White Lion',
      pressing_plant: 'Record Service Alsdorf', mastering_studio: 'Sterling Sound, Masterdisk', rights_society: 'GEMA',
      runouts_json: JSON.stringify([
        { side: 'A', inscription: '781 768-1 A  Alsdorf', notes: 'DMM' },
        { side: '', inscription: '', notes: '' },
        { side: 'B', inscription: 'STA 876 427', bogus: 'x' }
      ])
    });
    await addMusic(admin, { title: 'Other', artist: 'Someone', pressing_plant: 'Columbia Pitman' });
  });
  after(async () => { await app?.stop(); });

  it('stores the companies as lists and the runouts as rows, empty ones dropped', async () => {
    const pride = itemByTitle(await exportInstance(admin), 'Pride');
    assert.deepEqual(pride.pressing_plant, ['Record Service Alsdorf']);
    assert.deepEqual(pride.mastering_studio, ['Sterling Sound', 'Masterdisk']);
    assert.deepEqual(pride.runouts.map((r: any) => [r.side, r.inscription, r.notes]), [
      ['A', '781 768-1 A  Alsdorf', 'DMM'],
      ['B', 'STA 876 427', '']
    ]);
  });

  it('shows the runouts as a table and offers them in the edit form', async () => {
    const pride = itemByTitle(await exportInstance(admin), 'Pride');
    const page = (await admin.get(`/album/${pride._id}`)).text;
    assert.match(page, /<td[^>]*>781 768-1 A  Alsdorf<\/td>/);
    assert.match(page, /Record Service Alsdorf/);
    const form = (await admin.get(`/album/edit/${pride._id}`)).text;
    assert.match(form, /name="runouts_json" value="\[\{&#34;side&#34;:&#34;A&#34;/);
  });

  it('finds a record by its runout or its plant, and filters on the plant', async () => {
    const dump = await exportInstance(admin);
    const find = async (query: string) => listedTitles((await admin.get(`/collection?${query}`)).text, dump);
    assert.deepEqual(await find('search=STA+876'), ['Pride']);
    assert.deepEqual(await find('search=alsdorf'), ['Pride']);
    assert.deepEqual(await find('type=music&nf_pressing_plant=' + encodeURIComponent('Columbia Pitman')), ['Other']);
    assert.match((await admin.get('/collection?type=music')).text, /name="nf_pressing_plant"|nf_pressing_plant/);
  });

  it('keeps the rows when a form does not carry the field, and clears them when emptied', async () => {
    const pride = itemByTitle(await exportInstance(admin), 'Pride');
    const save = (fields: Record<string, any>) => admin.postForm('/save-music', {
      quantity: 1, in_wishlist: 'false', images_json: '[]', title: 'Pride', artist: 'White Lion', mongo_id: String(pride._id), ...fields
    });
    await save({});
    assert.equal(itemByTitle(await exportInstance(admin), 'Pride').runouts.length, 2);
    await save({ runouts_json: '[]' });
    assert.deepEqual(itemByTitle(await exportInstance(admin), 'Pride').runouts, []);
  });

  it('lets a collection declare its own repeating field, saved and searched like any other', async () => {
    let reply = await admin.postJson('/create-plugin/customize/music', {
      extraFields: [{ label: 'Stampers', type: 'rows', options: ['Side', 'Code'] }]
    });
    assert.equal(reply.status, 200, reply.text.slice(0, 300));
    const field = (await exportInstance(admin)).settings[0].pluginExtraFields.music[0];
    assert.deepEqual(field.options.map((o: any) => o.value), ['side', 'code']);

    await addMusic(admin, { title: 'Stamped', artist: 'X', [`${field.name}_json`]: JSON.stringify([{ side: 'A', code: 'SP GER' }]) });
    const dump = await exportInstance(admin);
    assert.deepEqual(itemByTitle(dump, 'Stamped').extra[field.name], [{ side: 'A', code: 'SP GER' }]);
    assert.deepEqual(listedTitles((await admin.get('/collection?search=SP+GER')).text, dump), ['Stamped']);
    const form = (await admin.get('/add-music/manual')).text;
    assert.match(form, new RegExp(`name="${field.name}_json"`));
  });
});
