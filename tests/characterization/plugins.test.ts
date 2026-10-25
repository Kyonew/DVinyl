import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import {
  addMusic, enableModules, exportInstance, InstanceDump, itemByTitle, listedTitles, saveItem, setupAdmin
} from './fixtures';

const backend = backendFor('plugins');

const ALL_MODULES = ['music', 'books', 'dvd', 'games', 'lego', 'boardgames'];

async function save(client: Client, pluginId: string, fields: Record<string, string>) {
  const reply = await saveItem(client, pluginId, fields);
  assert.equal(reply.status, 302, `save-${pluginId} failed (${reply.status}): ${reply.text.slice(0, 300)}`);
  return reply;
}

const copies = (dump: InstanceDump, title: string) =>
  dump.albums.filter(item => item.title === title).map(item => item.quantity).sort();

describe('built-in item types', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ALL_MODULES);
  });
  after(async () => { await app?.stop(); });

  it('stores each type under its own kind, served under its own route', async () => {
    await save(admin, 'books', { title: 'Dune', author: 'Frank Herbert', isbn: '978-0-441-17271-9', format: 'paperback', pages: '412' });
    await save(admin, 'dvd', { title: 'The Matrix', director: 'Wachowskis', format: 'bluray', tmdb_id: '603', zone: 'B' });
    await save(admin, 'games', { title: 'Zelda', developer: 'Nintendo', platform: 'switch', format: 'physical', igdb_id: '119388' });
    await save(admin, 'lego', { title: 'Millennium Falcon', theme: 'Star Wars', set_num: '75192-1', format: 'built', pieces: '7541' });
    await save(admin, 'boardgames', { title: 'Catan', designer: 'Klaus Teuber', bgg_id: '13', format: 'boxed' });
    await addMusic(admin, { title: 'Kind of Blue', artist: 'Miles Davis' });

    const dump = await exportInstance(admin);
    const expected: [string, string, string][] = [
      ['Dune', 'Book', '/book'], ['The Matrix', 'Dvd', '/dvd'], ['Zelda', 'Game', '/game'],
      ['Millennium Falcon', 'Lego', '/lego'], ['Catan', 'BoardGame', '/boardgame'], ['Kind of Blue', 'Music', '/album']
    ];
    for (const [title, kind, prefix] of expected) {
      const item = itemByTitle(dump, title);
      assert.equal(item.kind, kind);
      assert.equal((await admin.get(`${prefix}/${item._id}`)).status, 200, `${prefix}/${item._id}`);
    }

    const dune = itemByTitle(dump, 'Dune');
    assert.equal(dune.author, 'Frank Herbert');
    assert.equal(dune.pages, 412);
    assert.equal(itemByTitle(dump, 'Millennium Falcon').pieces, 7541);
    assert.equal(itemByTitle(dump, 'The Matrix').tmdb_id, 603);
    assert.equal(itemByTitle(dump, 'Zelda').igdb_id, 119388);
    assert.equal(itemByTitle(dump, 'Catan').bgg_id, '13');
  });

  it('lists one type at a time, or all of them', async () => {
    const dump = await exportInstance(admin);
    const shown = async (type: string) =>
      listedTitles((await admin.get(`/collection?type=${type}&sort=title_asc&limit=200`)).text, dump);
    assert.deepEqual(await shown('books'), ['Dune']);
    assert.deepEqual(await shown('dvd'), ['The Matrix']);
    assert.deepEqual(await shown('all'),
      ['Catan', 'Dune', 'Kind of Blue', 'The Matrix', 'Millennium Falcon', 'Zelda']);
  });

  it('hides a type whose module is turned off, without losing its items', async () => {
    await enableModules(admin, ['music', 'books']);
    const dump = await exportInstance(admin);
    const shown = listedTitles((await admin.get('/collection?type=all&sort=title_asc&limit=200')).text, dump);
    assert.deepEqual(shown, ['Dune', 'Kind of Blue']);
    assert.equal(dump.albums.length, 6);
    await enableModules(admin, ALL_MODULES);
  });

  it('matches book duplicates on the ISBN whatever its dashes, and keeps formats apart', async () => {
    await save(admin, 'books', { title: 'Dune (reprint title)', author: 'F. Herbert', isbn: '9780441172719', format: 'paperback' });
    await save(admin, 'books', { title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719', format: 'hardcover' });
    const dump = await exportInstance(admin);
    assert.deepEqual(copies(dump, 'Dune'), [1, 2]);
    assert.ok(!dump.albums.some(item => item.title === 'Dune (reprint title)'));
  });

  it('keeps another disc zone or game platform apart', async () => {
    await save(admin, 'dvd', { title: 'The Matrix', director: 'Wachowskis', format: 'bluray', tmdb_id: '603', zone: 'b' });
    await save(admin, 'dvd', { title: 'The Matrix', director: 'Wachowskis', format: 'bluray', tmdb_id: '603', zone: 'A' });
    await save(admin, 'games', { title: 'Zelda', developer: 'Nintendo', platform: 'switch', format: 'physical', igdb_id: '119388' });
    await save(admin, 'games', { title: 'Zelda', developer: 'Nintendo', platform: 'wiiu', format: 'physical', igdb_id: '119388' });
    const dump = await exportInstance(admin);
    assert.deepEqual(copies(dump, 'The Matrix'), [1, 2]);
    assert.deepEqual(copies(dump, 'Zelda'), [1, 2]);
  });

  it('matches LEGO sets on their number and board games on their BGG id', async () => {
    await save(admin, 'lego', { title: 'Falcon (UCS)', theme: 'Star Wars', set_num: '75192-1', format: 'built' });
    await save(admin, 'lego', { title: 'Millennium Falcon', theme: 'Star Wars', set_num: '75192-1', format: 'sealed' });
    await save(admin, 'boardgames', { title: 'Settlers of Catan', designer: 'Klaus Teuber', bgg_id: '13', format: 'boxed' });
    const dump = await exportInstance(admin);
    assert.deepEqual(copies(dump, 'Millennium Falcon'), [1, 2]);
    assert.deepEqual(copies(dump, 'Catan'), [2]);
  });
});

describe('custom fields', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  type FieldLabel = 'Signed' | 'Audio' | 'Pressing plant' | 'Weight';
  let field: Record<FieldLabel, string>;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    const reply = await admin.postJson('/create-plugin/customize/music', {
      extraFields: [
        { label: 'Signed', type: 'boolean' },
        { label: 'Audio', type: 'select', options: ['Mono', 'Stereo'] },
        { label: 'Pressing plant', type: 'text' },
        { label: 'Weight', type: 'number' }
      ]
    });
    assert.deepEqual(reply.json(), { success: true });
    const [settings] = (await exportInstance(admin)).settings;
    field = Object.fromEntries(settings.pluginExtraFields.music.map((f: any) => [f.label, f.name])) as Record<FieldLabel, string>;

    await addMusic(admin, { title: 'Alpha', artist: 'A', [field.Signed]: 'on', [field.Audio]: 'mono', [field['Pressing plant']]: 'EMI Hayes', [field.Weight]: '180' });
    await addMusic(admin, { title: 'Beta', artist: 'B', [field.Audio]: 'stereo', [field['Pressing plant']]: 'Pallas', [field.Weight]: '140' });
    await addMusic(admin, { title: 'Gamma', artist: 'C' });
  });
  after(async () => { await app?.stop(); });

  const shown = async (params: Record<string, string>) => {
    const dump = await exportInstance(admin);
    const query = new URLSearchParams({ type: 'music', sort: 'title_asc', limit: '200', ...params });
    return listedTitles((await admin.get(`/collection?${query}`)).text, dump);
  };

  it('declares fields under generated keys and stores values under extra', async () => {
    const [settings] = (await exportInstance(admin)).settings;
    assert.deepEqual(settings.pluginExtraFields.music.map((f: any) => [f.label, f.type]),
      [['Signed', 'boolean'], ['Audio', 'select'], ['Pressing plant', 'text'], ['Weight', 'number']]);
    for (const name of Object.values(field)) assert.match(name, /^custom_[0-9a-f]{12}$/);
    assert.deepEqual(settings.pluginExtraFields.music[1].options,
      [{ value: 'mono', label: 'Mono' }, { value: 'stereo', label: 'Stereo' }]);

    const dump = await exportInstance(admin);
    assert.deepEqual(itemByTitle(dump, 'Alpha').extra, {
      [field.Signed]: true, [field.Audio]: 'mono', [field['Pressing plant']]: 'EMI Hayes', [field.Weight]: 180
    });
    assert.deepEqual(itemByTitle(dump, 'Gamma').extra, { [field.Signed]: false });
  });

  it('keeps the values of fields an edit does not post', async () => {
    const alpha = itemByTitle(await exportInstance(admin), 'Alpha');
    await saveItem(admin, 'music', {
      mongo_id: String(alpha._id), title: 'Alpha', artist: 'A', media_type: 'vinyl', tracklist_json: '[]',
      [field.Signed]: 'on', [field.Weight]: '200'
    });
    assert.deepEqual(itemByTitle(await exportInstance(admin), 'Alpha').extra, {
      [field.Signed]: true, [field.Audio]: 'mono', [field['Pressing plant']]: 'EMI Hayes', [field.Weight]: 200
    });
  });

  it('filters on a value, a range, filled in or empty', async () => {
    const param = (label: FieldLabel, suffix = '') => `xf_${field[label]}${suffix}`;
    assert.deepEqual(await shown({ [param('Audio')]: 'stereo' }), ['Beta']);
    assert.deepEqual(await shown({ [param('Signed')]: 'true' }), ['Alpha']);
    assert.deepEqual(await shown({ [param('Signed')]: 'false' }), ['Beta', 'Gamma']);
    assert.deepEqual(await shown({ [param('Weight', '_from')]: '150' }), ['Alpha']);
    assert.deepEqual(await shown({ [param('Weight', '_to')]: '150' }), ['Beta']);
    assert.deepEqual(await shown({ [param('Pressing plant')]: '__any__' }), ['Alpha', 'Beta']);
    assert.deepEqual(await shown({ [param('Pressing plant')]: '__none__' }), ['Gamma']);
  });

  it('sorts on a field and finds its values from the search box', async () => {
    assert.deepEqual(await shown({ sort: `xf:${field.Weight}_asc` }), ['Gamma', 'Beta', 'Alpha']);
    assert.deepEqual(await shown({ sort: `xf:${field.Weight}_desc` }), ['Alpha', 'Beta', 'Gamma']);
    assert.deepEqual(await shown({ search: 'hayes' }), ['Alpha']);
    assert.deepEqual(await shown({ search: 'Stereo' }), ['Beta'], 'a select field is searched by its label');
  });

  it('removes the declaration but keeps the stored values when fields are cleared', async () => {
    const reply = await admin.postJson('/create-plugin/customize/music', { extraFields: [] });
    assert.deepEqual(reply.json(), { success: true });
    const dump = await exportInstance(admin);
    assert.equal(dump.settings[0].pluginExtraFields?.music, undefined);
    assert.equal(itemByTitle(dump, 'Beta').extra[field['Pressing plant']], 'Pallas');
  });
});

describe('custom plugins', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
  });
  after(async () => { await app?.stop(); });

  it('creates a plugin, stores its definition and grows its folder', async () => {
    const reply = await admin.postJson('/create-plugin/save', {
      label: 'Comics', creatorLabel: 'Writer',
      fields: [{ label: 'Issue', type: 'number' }, { label: 'Publisher', type: 'text' }]
    });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.json().success, true);

    const dump = await exportInstance(admin);
    assert.equal(dump.customPlugins.length, 1);
    const [plugin] = dump.customPlugins;
    assert.equal(plugin.id, 'comics');
    assert.equal(plugin.kind, 'CustomComics');
    assert.equal(plugin.config.kind, 'CustomComics');
    assert.equal(plugin.config.creatorLabel, 'Writer');
    assert.deepEqual(plugin.config.fields.map((f: any) => [f.name, f.label, f.type]),
      [['issue', 'Issue', 'number'], ['publisher', 'Publisher', 'text']]);
    assert.ok(fs.existsSync(path.join(app.root, 'plugins', 'comics')));
  });

  it('adds and lists items of the new type once its module is on', async () => {
    await enableModules(admin, ['music', 'comics']);
    const page = await admin.get('/add-comics/manual');
    assert.equal(page.status, 200);
    const names = [...new Set([...page.text.matchAll(/<(?:input|select|textarea)[^>]*name="([^"$]+)"/g)].map(m => m[1]!))];
    const issue = names.find(n => n === 'issue');
    assert.ok(issue, `form fields: ${names.join(' ')}`);

    await save(admin, 'comics', { title: 'Watchmen', creator: 'Alan Moore', issue: '1', publisher: 'DC' });
    await save(admin, 'comics', { title: 'watchmen', creator: 'alan moore', issue: '1' });
    // The creator of a custom type is always stored as `creator`, and it is required.
    const refused = await saveItem(admin, 'comics', { title: 'Anonymous', issue: '2' });
    assert.equal(refused.status, 400, 'an add without its creator is refused as a bad form');
    assert.match(refused.text, /Writer/, 'the refusal names the field by its label');

    const dump = await exportInstance(admin);
    assert.ok(!dump.albums.some(a => a.title === 'Anonymous'));
    const item = itemByTitle(dump, 'Watchmen');
    assert.equal(item.kind, 'CustomComics');
    assert.equal(item.creator, 'Alan Moore');
    assert.equal(item.issue, 1);
    assert.equal(item.publisher, 'DC');
    assert.equal(item.quantity, 2, 'a custom type merges duplicates on title and creator');
    assert.deepEqual(
      listedTitles((await admin.get('/collection?type=comics&limit=200')).text, dump),
      ['Watchmen']
    );
  });
});
