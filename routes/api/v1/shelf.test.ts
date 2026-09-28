import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeItem, makeSettings, itemModel } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_KIND } from '../../../test/helpers/plugins';
import { shelfNames } from '../../../core/shelfStore';
import Furniture from '../../../models/Furniture';

const app = buildApiApp();

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

/** owner=admin, editor, viewer, plus a non-member outsider. */
async function seedCollectionWithRoles() {
  const owner = (await makeUser()).user;
  const editor = (await makeUser()).user;
  const viewer = (await makeUser()).user;
  const outsider = (await makeUser()).user;
  const collection = await makeCollection({
    members: [
      { user: owner, role: 'admin' },
      { user: editor, role: 'editor' },
      { user: viewer, role: 'viewer' }
    ]
  });
  return {
    owner, editor, viewer, outsider, collection,
    ownerToken: signAccessToken(owner._id),
    editorToken: signAccessToken(editor._id),
    viewerToken: signAccessToken(viewer._id),
    outsiderToken: signAccessToken(outsider._id)
  };
}

/** A piece with cells given as [name, capacity?] pairs in reading order. */
async function seedFurniture(ctx: any, over: Record<string, any> = {}) {
  const columns = over.columns ?? 4;
  const cells = (over.cells ?? []).map((entry: any, index: number) => ({
    name: entry[0],
    key: entry[0].toLocaleLowerCase(),
    row: Math.floor(index / columns),
    column: index % columns,
    capacity: entry[1] ?? 0
  }));
  return Furniture.create({
    collection: ctx.collection._id,
    name: over.name ?? 'Billy',
    layout: over.layout ?? 'cubes',
    columns,
    rows: over.rows ?? Math.max(1, Math.ceil(cells.length / columns)),
    order: over.order ?? 100,
    cells,
    createdBy: ctx.owner._id
  });
}

describe('GET /api/v1/collections/:id/shelves', () => {
  test('200 lists compartment names plus stray item locations, sorted and deduped', async () => {
    const ctx = await seedCollectionWithRoles();
    await seedFurniture(ctx, { cells: [['Salon'], ['Vitrine']] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Stray', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Garage' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Variant', owner: ctx.owner._id, collection: ctx.collection._id, location: 'salon' });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/shelves`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.shelves, ['Garage', 'Salon', 'Vitrine']);
  });

  test('401 without a token, 403 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    assert.equal((await request(app).get(`/api/v1/collections/${ctx.collection._id}/shelves`)).status, 401);
    assert.equal((await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/shelves`)
      .set(bearer(ctx.outsiderToken))).status, 403);
  });
});

describe('GET /api/v1/collections/:id/furniture', () => {
  test('200 lists pieces in order, with cells and per-cell counts', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    await seedFurniture(ctx, { name: 'Billy', order: 200, cells: [['Salon', 40], ['Vitrine']] });
    await seedFurniture(ctx, { name: 'Kallax', order: 100, cells: [['Cave']] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'A', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'B', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'C', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon', in_wishlist: true });
    await makeItem(TEST_PLUGIN_KIND, { title: 'D', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Cave' });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/furniture`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.furniture.map((p: any) => p.name), ['Kallax', 'Billy']);

    const billy = res.body.furniture.find((p: any) => p.name === 'Billy');
    assert.equal(billy.layout, 'cubes');
    assert.equal(billy.columns, 4);
    const salon = billy.cells.find((c: any) => c.name === 'Salon');
    assert.deepEqual(
      { key: salon.key, row: salon.row, column: salon.column, capacity: salon.capacity, count: salon.count },
      { key: 'salon', row: 0, column: 0, capacity: 40, count: 2 }
    );
    assert.equal(billy.cells.find((c: any) => c.name === 'Vitrine').count, 0);
    assert.equal(res.body.furniture.find((p: any) => p.name === 'Kallax').cells[0].count, 1);
  });

  test('counts respect the caller\'s visibility filter', async () => {
    const ctx = await seedCollectionWithRoles();
    await seedFurniture(ctx, { cells: [['Salon']] });
    const hidden = await makeItem(TEST_PLUGIN_KIND, { title: 'Hidden', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });
    await makeSettings(ctx.collection, { visibility: { applyToAdmin: false, hiddenItems: [String(hidden._id)] } });

    const viewer = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/furniture`)
      .set(bearer(ctx.viewerToken));
    assert.equal(viewer.body.furniture[0].cells[0].count, 0);

    const admin = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/furniture`)
      .set(bearer(ctx.ownerToken));
    assert.equal(admin.body.furniture[0].cells[0].count, 1);
  });

  test('an item in another collection is not counted', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    const other = await makeCollection({ members: [{ user: ctx.owner, role: 'admin' }] });
    await seedFurniture(ctx, { cells: [['Salon']] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Mine', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Theirs', owner: ctx.owner._id, collection: other._id, location: 'Salon' });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/furniture`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.body.furniture[0].cells[0].count, 1);
  });

  test('a collection with no furniture answers an empty list', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/furniture`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.furniture, []);
  });
});

describe('items listing shelf filters', () => {
  test('location returns exactly that compartment; a longer name is not a match', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    await seedFurniture(ctx, { cells: [['Salon'], ['Étagère du salon']] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'In salon', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'On the shelf', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Étagère du salon' });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?location=Salon`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((i: any) => i.title), ['In salon']);
    assert.equal(res.body.totalItems, 1);
  });

  test('location on an empty compartment is empty', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    await seedFurniture(ctx, { cells: [['Salon'], ['Vitrine']] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'In salon', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?location=Vitrine`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.totalItems, 0);
  });

  test('unshelved returns the reserve, including an item with no location at all', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    await seedFurniture(ctx, { cells: [['Salon']] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Shelved', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Salon' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Stray', owner: ctx.owner._id, collection: ctx.collection._id, location: 'Garage' });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Nowhere', owner: ctx.owner._id, collection: ctx.collection._id });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?unshelved=true`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((i: any) => i.title).sort(), ['Nowhere', 'Stray']);
  });

  test('400 when location and unshelved are combined', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?location=Salon&unshelved=true`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'location and unshelved cannot be combined');
  });
});

describe('item location canonicalisation', () => {
  test('creating with a variant spelling stores the compartment\'s own', async () => {
    const ctx = await seedCollectionWithRoles();
    await seedFurniture(ctx, { cells: [['Salon']] });

    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.editorToken))
      .send({ pluginId: 'testkind', title: 'Lamp', location: '  salon ' });
    assert.equal(res.status, 201);
    const stored: any = await itemModel(TEST_PLUGIN_KIND).findOne({ collection: ctx.collection._id, title: 'Lamp' }).lean();
    assert.equal(stored.location, 'Salon');
  });

  test('creating with an unknown name builds a compartment and keeps it, once', async () => {
    const ctx = await seedCollectionWithRoles();
    await seedFurniture(ctx, { cells: [['Salon']] });

    for (const title of ['One', 'Two']) {
      const res = await request(app)
        .post(`/api/v1/collections/${ctx.collection._id}/items`)
        .set(bearer(ctx.editorToken))
        .send({ pluginId: 'testkind', title, location: 'Garage' });
      assert.equal(res.status, 201);
      const stored: any = await itemModel(TEST_PLUGIN_KIND).findOne({ collection: ctx.collection._id, title }).lean();
      assert.equal(stored.location, 'Garage');
    }

    const names = await shelfNames(ctx.collection._id);
    assert.equal(names.filter((n: string) => n === 'Garage').length, 1);
  });

  test('editing canonicalises and an empty location clears it', async () => {
    const ctx = await seedCollectionWithRoles();
    await seedFurniture(ctx, { cells: [['Salon']] });
    const item = await makeItem(TEST_PLUGIN_KIND, { title: 'Lamp', owner: ctx.owner._id, collection: ctx.collection._id, location: 'salon' });

    const moved = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set(bearer(ctx.editorToken))
      .send({ location: 'salon' });
    assert.equal(moved.status, 200);
    let stored: any = await itemModel(TEST_PLUGIN_KIND).findById(item._id).lean();
    assert.equal(stored.location, 'Salon');

    const cleared = await request(app)
      .patch(`/api/v1/items/${item._id}`)
      .set(bearer(ctx.editorToken))
      .send({ location: '' });
    assert.equal(cleared.status, 200);
    stored = await itemModel(TEST_PLUGIN_KIND).findById(item._id).lean();
    assert.equal(stored.location, '');
  });
});
