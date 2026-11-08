import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, enableModules, exportInstance, itemByTitle, setupAdmin } from './fixtures';

const backend = backendFor('field_lookalikes');

describe('a collection field the plugin now has itself', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let key = '';

  const fields = async () => (await exportInstance(admin)).settings[0].pluginExtraFields?.music || [];

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['music']);
    await admin.postJson('/create-plugin/customize/music', { extraFields: [{ label: 'Label', type: 'text' }, { label: 'Mood', type: 'text' }] });
    key = (await fields()).find((f: any) => f.label === 'Label').name;
    await addMusic(admin, { title: 'Empty', artist: 'A', [key]: 'Sire' });
    await addMusic(admin, { title: 'Same', artist: 'B', label: 'Atlantic', [key]: 'atlantic' });
    await addMusic(admin, { title: 'Other', artist: 'C', label: 'Polydor', [key]: 'Vertigo' });
  });
  after(async () => { await app?.stop(); });

  it('is reported on the customize page, and says what a transfer would do', async () => {
    assert.match((await admin.get('/create-plugin')).text, new RegExp(`"lookalikeNames":\\{"${key}":"label"\\}`));
    const plan = (await admin.get(`/create-plugin/customize/music/fields/${key}`)).json();
    assert.deepEqual([plan.withValue, plan.move, plan.same, plan.conflict, plan.native.name], [3, 1, 1, 1, 'label']);
  });

  it('moves values only where the plugin field was empty, and stays for the rest', async () => {
    const done = (await admin.postJson(`/create-plugin/customize/music/fields/${key}/transfer`, {})).json();
    assert.deepEqual([done.moved, done.cleared, done.left, done.removed], [1, 1, 1, false]);
    const dump = await exportInstance(admin);
    assert.equal(itemByTitle(dump, 'Empty').label, 'Sire');
    assert.equal(itemByTitle(dump, 'Empty').extra?.[key], undefined);
    assert.equal(itemByTitle(dump, 'Same').extra?.[key], undefined);
    assert.equal(itemByTitle(dump, 'Other').label, 'Polydor');
    assert.equal(itemByTitle(dump, 'Other').extra[key], 'Vertigo');
    assert.ok((await fields()).some((f: any) => f.name === key));
  });

  it('is no longer reported once kept on purpose, and stays kept through a save', async () => {
    assert.equal((await admin.postJson(`/create-plugin/customize/music/fields/${key}/keep`, {})).status, 200);
    assert.doesNotMatch((await admin.get('/create-plugin')).text, new RegExp(`"lookalikeNames":\\{"${key}"`));
    const saved = await fields();
    await admin.postJson('/create-plugin/customize/music', { extraFields: saved });
    assert.equal((await fields()).find((f: any) => f.name === key).keepBeside, 'label');
  });

  it('counts the items holding a value before a field is removed', async () => {
    const mood = (await fields()).find((f: any) => f.label === 'Mood').name;
    const usage = (await admin.get(`/create-plugin/customize/music/fields/${mood}`)).json();
    assert.deepEqual([usage.withValue, usage.native], [0, null]);
  });
});
