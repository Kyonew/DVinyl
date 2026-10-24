import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, enableModules, exportInstance, itemByTitle, saveItem, setupAdmin, titles } from './fixtures';

const backend = backendFor('items');

describe('item lifecycle', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
  });
  after(async () => { await app?.stop(); });

  it('stores a manual add with typed values and derived fields', async () => {
    const reply = await addMusic(admin, {
      title: 'The Dark Side of the Moon',
      artist: 'Pink Floyd',
      year: '1973',
      genres: 'Rock, Psychedelic',
      styles: 'Prog Rock',
      discogs_id: '1873013',
      label: 'Harvest',
      location: 'Shelf A',
      comments: 'First pressing',
      quantity: '2'
    });
    assert.equal(reply.location, '/collection?type=music');

    const dump = await exportInstance(admin);
    const item = itemByTitle(dump, 'The Dark Side of the Moon');
    const [user] = dump.users;
    const [collection] = dump.collections;

    assert.equal(item.kind, 'Music');
    assert.equal(item.sort_title, 'dark side of the moon');
    assert.equal(item.artist, 'Pink Floyd');
    // The year stays the text the form posted, while the plugin's id field is a number.
    assert.equal(item.year, '1973');
    assert.equal(item.discogs_id, 1873013);
    assert.deepEqual(item.genres, ['Rock', 'Psychedelic']);
    assert.equal(item.genre, 'Rock');
    assert.deepEqual(item.styles, ['Prog Rock']);
    assert.equal(item.label, 'Harvest');
    assert.equal(item.location, 'Shelf A');
    assert.equal(item.comments, 'First pressing');
    assert.equal(item.quantity, 2);
    assert.equal(item.in_wishlist, false);
    assert.equal(item.media_type, 'vinyl');
    assert.deepEqual(item.images, []);
    assert.equal(item.cover_image, '');
    assert.equal(item.barcode, '');
    assert.equal(item.barcode_locked, false);
    assert.equal(item.source, '');
    assert.equal(item.source_id, '');
    assert.equal(String(item.owner), String(user._id));
    assert.equal(String(item.collection), String(collection._id));
    assert.ok(!Number.isNaN(Date.parse(item.added_at)));
  });

  it('merges a duplicate add into the existing item, ignoring case', async () => {
    await addMusic(admin, { title: 'the dark side of the moon', artist: 'PINK FLOYD', quantity: '1' });
    const dump = await exportInstance(admin);
    const item = itemByTitle(dump, 'The Dark Side of the Moon');
    assert.equal(item.quantity, 3);
    assert.equal(dump.albums.length, 1);
  });

  it('keeps another format or another variant apart', async () => {
    await addMusic(admin, { title: 'The Dark Side of the Moon', artist: 'Pink Floyd', media_type: 'cd' });
    await addMusic(admin, { title: 'The Dark Side of the Moon', artist: 'Pink Floyd', variant_color: 'Clear' });

    const dump = await exportInstance(admin);
    const copies = dump.albums.filter(item => item.title === 'The Dark Side of the Moon');
    assert.deepEqual(
      copies.map(item => [item.media_type, item.variant_color ?? '', item.in_wishlist, item.quantity]).sort(),
      [['cd', '', false, 1], ['vinyl', '', false, 3], ['vinyl', 'Clear', false, 1]].sort()
    );
  });

  it('merges a wishlist add matching an owned item into the owned one', async () => {
    // Current behaviour: the duplicate lookup only looks at owned items and ignores where
    // the add was headed, so the owned quantity grows and no wishlist entry is created,
    // while the reply still lands on the wishlist.
    const wish = await addMusic(admin, { title: 'The Dark Side of the Moon', artist: 'Pink Floyd', in_wishlist: 'true' });
    assert.equal(wish.location, '/wishlist');
    const dump = await exportInstance(admin);
    const vinyl = dump.albums.find(item =>
      item.title === 'The Dark Side of the Moon' && item.media_type === 'vinyl' && !item.variant_color);
    assert.equal(vinyl.quantity, 4);
    assert.equal(vinyl.in_wishlist, false);
    assert.ok(!dump.albums.some(item => item.in_wishlist));

    const fresh = await addMusic(admin, { title: 'Faith', artist: 'The Cure', in_wishlist: 'true' });
    assert.equal(fresh.location, '/wishlist');
    assert.equal(itemByTitle(await exportInstance(admin), 'Faith').in_wishlist, true);
  });

  it('backfills the external id of an item first added without one', async () => {
    await addMusic(admin, { title: 'Disintegration', artist: 'The Cure' });
    await addMusic(admin, { title: 'Disintegration', artist: 'The Cure', discogs_id: '367084', barcode: '042283935325' });
    const item = itemByTitle(await exportInstance(admin), 'Disintegration');
    assert.equal(item.quantity, 2);
    assert.equal(item.discogs_id, 367084);
    assert.equal(item.barcode, '042283935325');
  });

  it('adds a separate entry for every save once merging is turned off', async () => {
    await enableModules(admin, ['music'], { mergeDuplicates: false });
    await addMusic(admin, { title: 'Pornography', artist: 'The Cure' });
    await addMusic(admin, { title: 'Pornography', artist: 'The Cure' });
    await enableModules(admin, ['music']);
    const dump = await exportInstance(admin);
    assert.equal(dump.albums.filter(item => item.title === 'Pornography').length, 2);
  });

  it('edits in place: new sort title, kept date, cleared fields, edit stamp', async () => {
    const before = itemByTitle(await exportInstance(admin), 'Disintegration');
    const reply = await saveItem(admin, 'music', {
      mongo_id: String(before._id),
      title: 'The Head on the Door',
      artist: 'The Cure',
      media_type: 'vinyl',
      tracklist_json: '[]',
      discogs_id: '',
      barcode: '',
      label: 'Fiction',
      quantity: '5',
      return_to: '/collection?type=music&page=2'
    });
    assert.equal(reply.status, 302);
    assert.equal(
      reply.location,
      `/album/${before._id}?from=${encodeURIComponent('/collection?type=music&page=2')}`
    );

    const dump = await exportInstance(admin);
    const item = itemByTitle(dump, 'The Head on the Door');
    assert.equal(String(item._id), String(before._id));
    assert.equal(item.sort_title, 'head on the door');
    assert.equal(item.quantity, 5, 'an edit sets the quantity rather than adding to it');
    assert.equal(item.added_at, before.added_at);
    assert.equal(item.label, 'Fiction');
    assert.equal(item.barcode, '');
    assert.ok(!('discogs_id' in item), 'an emptied id field is removed, not stored blank');
    assert.equal(String(item.modified_by), String(dump.users[0]._id));
    assert.ok(item.modified_at);
  });

  it('refuses an edit naming no item of the active collection', async () => {
    const reply = await saveItem(admin, 'music', {
      mongo_id: '0123456789abcdef01234567',
      title: 'Ghost',
      artist: 'Nobody',
      media_type: 'vinyl',
      tracklist_json: '[]'
    });
    assert.equal(reply.status, 404);
    assert.ok(!titles(await exportInstance(admin)).includes('Ghost'));
  });

  it('moves an item between the wishlist and the collection', async () => {
    const id = String(itemByTitle(await exportInstance(admin), 'The Head on the Door')._id);

    let reply = await admin.postJson(`/api/album/${id}/move-to-wishlist`, {});
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json(), { success: true });
    assert.equal(itemByTitle(await exportInstance(admin), 'The Head on the Door').in_wishlist, true);

    reply = await admin.postJson(`/api/album/${id}/move-to-collection`, {});
    assert.deepEqual(reply.json(), { success: true });
    assert.equal(itemByTitle(await exportInstance(admin), 'The Head on the Door').in_wishlist, false);

    reply = await admin.postJson('/api/album/0123456789abcdef01234567/move-to-wishlist', {});
    assert.equal(reply.status, 404);
  });

  it('deletes one item, then a selection, leaving the wishlist alone', async () => {
    let dump = await exportInstance(admin);
    const head = String(itemByTitle(dump, 'The Head on the Door')._id);

    let reply = await admin.delete(`/api/album/${head}`);
    assert.equal(reply.status, 200);
    assert.equal(reply.json().success, true);
    reply = await admin.delete(`/api/album/${head}`);
    assert.equal(reply.status, 404);

    dump = await exportInstance(admin);
    const pornography = dump.albums.filter(item => item.title === 'Pornography').map(item => String(item._id));
    const wished = dump.albums.find(item => item.in_wishlist);
    reply = await admin.postJson('/api/collection/delete-selected', {
      ids: [...pornography, pornography[0], String(wished._id), 'not-an-id']
    });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json(), { success: true, deleted: 2, failed: 1 });

    dump = await exportInstance(admin);
    assert.ok(!titles(dump).includes('Pornography'));
    assert.ok(dump.albums.some(item => item.in_wishlist), 'the wishlist entry survives a collection selection');

    reply = await admin.postJson('/api/collection/delete-selected', { ids: [] });
    assert.equal(reply.status, 400);
  });

  it('leaves exactly the items the steps above kept', async () => {
    const dump = await exportInstance(admin);
    assert.deepEqual(titles(dump), [
      'Faith',
      'The Dark Side of the Moon',
      'The Dark Side of the Moon',
      'The Dark Side of the Moon'
    ]);
  });
});
