import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { ADMIN, enableModules, exportInstance, itemByTitle, login, saveItem, setupAdmin } from './fixtures';

const backend = backendFor('kept_fields');

describe('fields the owner rewrote are kept across refreshes', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let id: string;

  const film = async () => itemByTitle(await exportInstance(admin), 'Heat');
  // The edit form as the browser posts it: every value the page carries.
  const editForm = async (changes: Record<string, any> = {}) => {
    const html = (await admin.get(`/dvd/edit/${id}`)).text;
    const fields: Record<string, any> = {};
    for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) fields[m[1]!] = m[2];
    for (const m of html.matchAll(/<input(?![^>]*type="(?:hidden|checkbox|radio)")[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) fields[m[1]!] = m[2];
    for (const m of html.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) fields[m[1]!] = m[2]!.replace(/&#39;/g, "'").replace(/\n/g, '\r\n');
    for (const m of html.matchAll(/<select[^>]*name="([^"]+)"[\s\S]*?<\/select>/g)) {
      const picked = m[0].match(/<option[^>]*value="([^"]*)"[^>]*selected/);
      if (picked) fields[m[1]!] = picked[1];
    }
    return { html, post: () => saveItem(admin, 'dvd', { ...fields, images_json: '[]', ...changes }) };
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['dvd']);
    await saveItem(admin, 'dvd', {
      title: 'Heat', director: 'Michael Mann', year: '1995', format: 'dvd', media_type: 'movie',
      genres: 'Crime, Drama', description: 'A group of professional bank robbers.'
    });
    id = String((await film())._id);
  });
  after(async () => { await app?.stop(); });

  it('offers the summary for editing and marks nothing on an unchanged save', async () => {
    const form = await editForm();
    assert.match(form.html, /<textarea name="description"[^>]*>A group of professional bank robbers\.<\/textarea>/);
    assert.equal((await form.post()).status, 302);
    assert.equal((await film()).kept_fields, undefined);
  });

  it('keeps a rewritten summary, and only that', async () => {
    const reply = await (await editForm({ description: 'Een groep professionele bankrovers.' })).post();
    assert.equal(reply.status, 302);
    const item = await film();
    assert.equal(item.description, 'Een groep professionele bankrovers.');
    assert.deepEqual(item.kept_fields, ['description']);
  });

  it('offers back what a refresh noted, and hands the field back to the source', async () => {
    // What a refresh leaves behind: the source's summary, noted rather than written.
    const dump = await exportInstance(admin);
    itemByTitle(dump, 'Heat').source_values = { description: 'A group of professional bank robbers.' };
    assert.equal((await admin.postJson('/backup/import', dump)).status, 200);
    admin = await login(app, ADMIN.email, ADMIN.password);

    const form = await editForm();
    assert.match(form.html, /name="revert_fields" value="description"/);
    assert.match(form.html, /A group of professional bank robbers\./);

    const reply = await (await editForm({ revert_fields: 'description' })).post();
    assert.equal(reply.status, 302);
    const item = await film();
    assert.equal(item.description, 'A group of professional bank robbers.');
    assert.equal(item.kept_fields, undefined);
    assert.equal(item.source_values, undefined);
  });
});
