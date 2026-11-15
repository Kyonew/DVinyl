import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, exportInstance, itemByTitle, setupAdmin } from './fixtures';

const backend = backendFor('purchase_price');

describe('the price paid for a copy', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  const item = async () => itemByTitle(await exportInstance(admin), 'Blue Train');
  const edit = (fields: Record<string, any>) => admin.postForm('/save-music', {
    quantity: 1, in_wishlist: 'false', images_json: '[]', title: 'Blue Train', artist: 'John Coltrane', format: 'Vinyl', ...fields
  });

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await admin.postForm('/settings/update-currency', { currency: 'EUR' });
    await addMusic(admin, { title: 'Blue Train', artist: 'John Coltrane', purchase_price: '12,5' });
  });
  after(async () => { await app?.stop(); });

  it('is stored with the currency of whoever entered it', async () => {
    const stored = await item();
    assert.equal(stored.purchase_price, 12.5);
    assert.equal(stored.purchase_currency, 'EUR');
  });

  it('is offered in every form and shown as money on the item page', async () => {
    const stored = await item();
    const form = (await admin.get(`/album/edit/${stored._id}`)).text;
    assert.match(form, /name="purchase_price"[^>]*value="12.5"/);
    assert.match(form, /EUR<\/span>/);
    assert.match((await admin.get('/add-music/manual')).text, /name="purchase_price"/);
    assert.match((await admin.get(`/album/${stored._id}`)).text, /12,50\s€|€12\.50/);
  });

  it('keeps its currency when someone counting in another one edits it', async () => {
    await admin.postForm('/settings/update-currency', { currency: 'USD' });
    const stored = await item();
    await edit({ mongo_id: String(stored._id), purchase_price: '20' });
    const after = await item();
    assert.equal(after.purchase_price, 20);
    assert.equal(after.purchase_currency, 'EUR');
  });

  it('goes away with its currency when emptied, and is left alone by a form without it', async () => {
    const stored = await item();
    await edit({ mongo_id: String(stored._id) });
    assert.equal((await item()).purchase_price, 20, 'a form without the field changes nothing');
    await edit({ mongo_id: String(stored._id), purchase_price: '' });
    const after = await item();
    assert.equal(after.purchase_price, undefined);
    assert.equal(after.purchase_currency, undefined);
  });
});
