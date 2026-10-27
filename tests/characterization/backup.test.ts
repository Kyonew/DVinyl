import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import {
  ADMIN, addMusic, exportInstance, InstanceDump, itemByTitle, login, normalizeDump, seedEverything, titles
} from './fixtures';

const source = backendFor('backup_source');
const target = backendFor('backup_target');

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

describe('instance backup', { skip: !source || !target }, () => {
  let origin: App;
  let restored: App;
  let admin: Client;
  let dump: InstanceDump;

  before(async () => {
    origin = await startApp(source!);
    admin = await seedEverything(origin);
    dump = await exportInstance(admin);
  });
  after(async () => {
    await origin?.stop();
    await restored?.stop();
  });

  it('exports every table with the dump metadata', async () => {
    assert.deepEqual(Object.keys(dump).sort(), [
      'albums', 'collections', 'customPlugins', 'furniture', 'instanceSettings', 'lists', 'logs', 'metadata',
      'priceHistory', 'requestTypes', 'requests', 'settings', 'users'
    ]);
    assert.equal(dump.metadata.version, require('../../package.json').version);
    assert.deepEqual(titles(dump), ['Abbey Road', 'Blue Train', 'Dune', 'Other Shelf', 'The Wall']);
    assert.equal(dump.collections.length, 2);
    assert.equal(dump.settings.length, 2);
    assert.equal(dump.lists.length, 2);
    assert.equal(dump.furniture.length, 1);
    assert.equal(itemByTitle(dump, 'Dune').kind, 'Book');
  });

  it('restores into an empty instance, before any account exists, to the same content', async () => {
    restored = await startApp(target!);
    const anonymous = restored.client();
    const reply = await anonymous.postJson('/backup/import', dump);
    assert.equal(reply.status, 200, reply.text);
    assert.deepEqual(reply.json(), { success: true, message: 'Import successful' });

    const restoredAdmin = await login(restored, ADMIN.email, ADMIN.password);
    const again = await exportInstance(restoredAdmin);
    // The restore re-runs the boot migrations, which give an item carrying a Discogs id
    // but no source the matching source pair. Everything else comes back as it left.
    const expected = normalizeDump(dump);
    const wall = expected.albums.find((a: any) => a.title === 'The Wall');
    wall.source = 'discogs';
    wall.source_id = '1';
    assert.deepEqual(normalizeDump(again), expected);
    assert.deepEqual(again.albums.map(a => String(a._id)).sort(), dump.albums.map(a => String(a._id)).sort(),
      'ids survive a restore, so links and list entries keep pointing at the same items');
  });

  it('serves the restored data the way the original did', async () => {
    const restoredAdmin = await login(restored, ADMIN.email, ADMIN.password);
    const page = async (client: Client) => (await client.get('/collection?limit=200&sort=title_asc')).text;
    const ids = (html: string) => [...html.matchAll(/data-item-id="([0-9a-f]{24})"/g)].map(m => m[1]);
    assert.deepEqual(ids(await page(restoredAdmin)), ids(await page(admin)));

    const token = dump.collections.find(c => c.name === 'Vinyl').shareLinks[0].token;
    const visitor = restored.client();
    assert.equal((await visitor.get(`/share/${token}`)).location, '/collection');
    assert.deepEqual(ids(await page(visitor)).length, 3);
  });

  it('refuses to restore a collection backup over the whole instance', async () => {
    const collectionDump = (await admin.get('/backup/collection/export')).json();
    const restoredAdmin = await login(restored, ADMIN.email, ADMIN.password);
    const before = normalizeDump(await exportInstance(restoredAdmin));
    const reply = await restoredAdmin.postJson('/backup/import', collectionDump);
    assert.equal(reply.status, 400);
    assert.deepEqual(normalizeDump(await exportInstance(restoredAdmin)), before);
  });

  it('refuses an instance restore from a non-admin once accounts exist', async () => {
    const reply = await restored.client().postJson('/backup/import', dump);
    assert.notEqual(reply.status, 200);
  });
});

describe('collection backup', { skip: !source }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(source!);
    admin = await seedEverything(app);
  });
  after(async () => { await app?.stop(); });

  it('exports the active collection only', async () => {
    const reply = await admin.get('/backup/collection/export');
    assert.equal(reply.status, 200);
    const data = reply.json();
    assert.equal(data.collectionName, 'Vinyl');
    assert.deepEqual(data.albums.map((a: any) => a.title).sort(), ['Abbey Road', 'Blue Train', 'Dune', 'The Wall']);
    assert.ok(!('users' in data), 'a collection backup carries no accounts');
    assert.equal(data.lists.length, 2);
    assert.equal(data.furniture.length, 1);
  });

  it('replaces the collection with the backup content, leaving other collections alone', async () => {
    const backup = (await admin.get('/backup/collection/export')).json();
    const before = await exportInstance(admin);

    await admin.delete(`/api/album/${itemByTitle(before, 'Abbey Road')._id}`);
    await addMusic(admin, { title: 'Added After', artist: 'Late' });

    const reply = await admin.postJson('/backup/collection/import', backup);
    assert.equal(reply.status, 200, reply.text);

    const after = await exportInstance(admin);
    assert.deepEqual(titles(after), ['Abbey Road', 'Blue Train', 'Dune', 'Other Shelf', 'The Wall']);
    const vinylId = String(after.collections.find(c => c.name === 'Vinyl')._id);
    const lists = after.lists.filter(l => String(l.collection) === vinylId);
    assert.deepEqual(lists.map(l => [l.name, l.entries.length]).sort(), [['Favourites', 2], ['Mix', 1]]);
    for (const list of lists) {
      for (const entry of list.entries) {
        assert.ok(after.albums.some(a => String(a._id) === String(entry.item)), 'list entries point at restored items');
      }
    }
  });

  it('exports a CSV of the active collection', async () => {
    const reply = await admin.get('/backup/collection/export-csv');
    assert.equal(reply.status, 200);
    const [header, ...rows] = reply.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    // The header is what a later CSV import maps from, so its labels and order are kept.
    assert.equal(header, [
      'Type', 'Title', 'Cover (URL)', 'Year', 'Main genre', 'Genres', 'Styles', 'Barcode', 'Location', 'Quantity',
      'Personal notes', 'Date added', 'Artist', 'Media Type / Support', 'Format (Music)', 'Color / Edition', 'Label',
      'Catalog', 'Country', 'Sleeve Condition', 'discogs_id', 'Author(s)', 'Publisher', 'Format (Books)', 'Pages',
      'Language', 'Series', 'Volume', 'Status', 'Rating (out of 5)', 'hardcover_slug', 'ISBN', 'Description', 'Wishlist'
    ].join(','));
    assert.equal(rows.length, 4);
    assert.ok(rows.some(row => row.includes('The Wall') && row.includes('Pink Floyd') && row.includes('5099902894225')));
  });

  it('imports a mapped CSV in the background, skipping rows that match an owned item', async () => {
    const csv = 'Name;Band;Released\nThe Wall;Pink Floyd;1979\nMeddle;Pink Floyd;1971\nAnimals;Pink Floyd;1977\n';
    const reply = await admin.postJson('/import/csv', {
      csv,
      plugin: 'music',
      delimiter: ';',
      mapping: {
        title: { source: 'column', column: 'Name' },
        artist: { source: 'column', column: 'Band' },
        year: { source: 'column', column: 'Released' },
        media_type: { source: 'const', value: 'vinyl' }
      }
    });
    assert.equal(reply.status, 202, reply.text);

    const after = await eventually(
      () => exportInstance(admin),
      dump => titles(dump).includes('Animals') && titles(dump).includes('Meddle'),
      'the CSV rows'
    );
    assert.equal(itemByTitle(after, 'Meddle').year, '1971');
    assert.equal(itemByTitle(after, 'Meddle').kind, 'Music');
    assert.equal(itemByTitle(after, 'Meddle').media_type, 'vinyl');
    assert.equal(itemByTitle(after, 'The Wall').quantity, 1);
  });
});

describe('legacy backup', { skip: !target }, () => {
  let app: App;

  before(async () => { app = await startApp(target!); });
  after(async () => { await app?.stop(); });

  it('restores a dump from before collections and item types into a default collection', async () => {
    // Shape of a 2.x dump: one global settings object, no collections, items without kind.
    const hash = '$2b$10$G78cq0e0qnWb1BebNpnT5up.32b.R1tTKv29Et2QfIs22qNRJziyC';
    const userId = '64b000000000000000000001';
    const legacy = {
      users: [{ _id: userId, username: 'old', email: 'old@example.test', password: hash, isAdmin: true, lastChange: '2020-01-01T00:00:00.000Z' }],
      albums: [
        { _id: '64b000000000000000000010', title: 'The Wall', artist: 'Pink Floyd', year: '1979', media_type: 'vinyl', owner: userId, quantity: 1, in_wishlist: false, added_at: '2020-01-02T00:00:00.000Z' },
        { _id: '64b000000000000000000011', title: 'Low', artist: 'David Bowie', media_type: 'cd', owner: userId, in_wishlist: true }
      ],
      settings: { siteName: 'Old DVinyl' },
      metadata: { version: '2.6.0' }
    };
    const reply = await app.client().postJson('/backup/import', legacy);
    assert.equal(reply.status, 200, reply.text);

    const admin = await login(app, 'old@example.test', 'Test1234*');
    const dump = await exportInstance(admin);
    assert.equal(dump.collections.length, 1);
    const [collection] = dump.collections;
    assert.deepEqual(collection.members.map((m: any) => [String(m.user), m.role]), [[userId, 'admin']]);
    for (const item of dump.albums) {
      assert.equal(String(item.collection), String(collection._id));
      assert.equal(item.kind, 'Music');
    }
    assert.equal(itemByTitle(dump, 'The Wall').sort_title, 'wall');
    assert.equal(itemByTitle(dump, 'Low').in_wishlist, true);
    assert.deepEqual(
      [...(await admin.get('/collection?limit=200')).text.matchAll(/data-item-id="([0-9a-f]{24})"/g)].map(m => m[1]),
      ['64b000000000000000000010']
    );
  });
});
