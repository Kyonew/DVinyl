import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, exportInstance, setupAdmin } from './fixtures';

const backend = backendFor('table_columns');

describe('table view columns', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let field: Record<string, string>;

  const headers = (html: string) => [...html.slice(html.indexOf('<thead'), html.indexOf('</thead>')).matchAll(/<th[^>]*>\s*([^<]*?)\s*<\/th>/g)]
    .map(match => match[1]!).filter(Boolean);
  const table = async (url = '/collection?type=music&view=table') => {
    const html = (await admin.get(url)).text;
    return { html, headers: headers(html) };
  };
  const customize = (body: Record<string, unknown>) => admin.postJson('/create-plugin/customize/music', { extraFields: [
    { name: field.Signed, label: 'Signed', type: 'boolean' },
    { name: field.Plant, label: 'Plant', type: 'text' }
  ], ...body });

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    const reply = await admin.postJson('/create-plugin/customize/music', {
      extraFields: [{ label: 'Signed', type: 'boolean' }, { label: 'Plant', type: 'text' }]
    });
    assert.deepEqual(reply.json(), { success: true });
    const [settings] = (await exportInstance(admin)).settings;
    field = Object.fromEntries(settings.pluginExtraFields.music.map((f: any) => [f.label, f.name]));
    await addMusic(admin, { title: 'Alpha', artist: 'Miles', year: '1959', location: 'Shelf 2', [field.Signed!]: 'on', [field.Plant!]: 'EMI Hayes' });
  });
  after(async () => { await app?.stop(); });

  it('gives each card field and the location a column of its own, with no Info column', async () => {
    const { headers: names, html } = await table();
    assert.ok(names.includes('Location'));
    assert.ok(names.includes('Artist / Band') || names.some(n => /artist/i.test(n)), names.join());
    assert.ok(!names.includes('Info'));
    assert.equal(names.filter(n => n === 'Location').length, 1);
    assert.match(html, /Shelf 2/);
  });

  it('draws the columns a collection chose, a true flag as a tick', async () => {
    assert.deepEqual((await customize({ tableColumns: [field.Plant!, field.Signed!, 'location'] })).json(), { success: true });
    const { headers: names, html } = await table();
    assert.deepEqual(names, ['Title', 'Location', 'Signed', 'Plant'], 'in the order the type declares them');
    assert.match(html, /title="EMI Hayes"/);
    assert.match(html, /fa-check text-primary-theme/);
  });

  it('goes down to the title alone when every box is off', async () => {
    await customize({ tableColumns: [] });
    assert.deepEqual((await table()).headers, ['Title']);
  });

  it('never trusts the submission with a field the type does not offer', async () => {
    await customize({ tableColumns: ['password', '$where', 'location'] });
    const [settings] = (await exportInstance(admin)).settings;
    assert.deepEqual(settings.pluginCustomization.music.tableColumns, ['location']);
  });

  it('stores nothing while the boxes stay as they opened, the table then following the cards', async () => {
    await customize({});
    const reply = await customize({ cardFields: ['year'], tableColumns: ['artist', 'location', 'format_type', 'variant_color'] });
    assert.deepEqual(reply.json(), { success: true });
    const [settings] = (await exportInstance(admin)).settings;
    assert.equal(settings.pluginCustomization.music.tableColumns, undefined);
    assert.ok((await table()).headers.some(n => /year/i.test(n)));
  });

  it('keeps Info and Location with every type shown, without the location twice', async () => {
    await customize({ cardFields: ['artist', 'location'] });
    const { headers: names, html } = await table('/collection?view=table');
    assert.ok(names.includes('Info') && names.includes('Location'));
    const rows = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'));
    assert.equal((rows.match(/Shelf 2/g) || []).length, 2, 'its column, and the line a phone reads under the title');
  });
});
