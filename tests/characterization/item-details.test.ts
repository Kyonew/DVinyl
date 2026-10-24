import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { ADMIN, addMusic, exportInstance, itemByTitle, login, setupAdmin, titles } from './fixtures';

const backend = backendFor('item_details');

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

describe('item pages, tracks and plugin tools', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const tracks = [{ position: 'A1', title: 'Come Together', duration: '4:20' }, { position: 'A2', title: 'Something', duration: '3:03' }];

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles', discogs_id: '24047', tracklist_json: JSON.stringify(tracks) });
    await addMusic(admin, { title: 'abbey road', artist: 'the beatles', media_type: 'cd' });
    await addMusic(admin, { title: 'Let It Be', artist: 'The Beatles' });
    await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles', media_type: 'cassette', in_wishlist: 'true' });
  });
  after(async () => { await app?.stop(); });

  it('lists the other owned editions of a work on its page', async () => {
    const dump = await exportInstance(admin);
    const vinyl = dump.albums.find(a => a.media_type === 'vinyl' && a.title === 'Abbey Road');
    const cd = dump.albums.find(a => a.media_type === 'cd');
    const html = (await admin.get(`/album/${vinyl._id}`)).text;
    const linked = new Set([...html.matchAll(/\/album\/([0-9a-f]{24})/g)].map(m => m[1]));
    assert.ok(linked.has(String(cd._id)), 'the CD edition is offered');
    assert.ok(!linked.has(String(itemByTitle(dump, 'Let It Be')._id)), 'another work is not');
    const wished = dump.albums.find(a => a.in_wishlist);
    assert.ok(!linked.has(String(wished._id)), 'a wishlist entry is not an owned edition');
  });

  it('hands the owned Discogs ids to the estimate page', async () => {
    const reply = await admin.get('/api/collection/ids');
    const { success, albums } = reply.json();
    assert.equal(success, true);
    assert.deepEqual(albums.map((a: any) => [a.discogs_id ?? null, a.quantity]).sort(), [[24047, 1], [null, 1], [null, 1]].sort());
  });

  it('records what the owner notes about a track', async () => {
    const item = (await exportInstance(admin)).albums.find(a => a.media_type === 'vinyl' && a.title === 'Abbey Road');
    const [first, second] = item.tracklist;
    const meta = (trackId: string, body: any) => admin.postJson(`/api/album/${item._id}/track/${trackId}/meta`, body);

    let reply = await meta(first._id, { rating: 4, tags: 'groove, bass ,', bpm: '82', key: 'Dm', notes: 'Opener' });
    assert.deepEqual(reply.json(), { success: true });
    reply = await meta(second._id, { lyrics: 'Something in the way she moves' });
    assert.deepEqual(reply.json(), { success: true });

    let stored = (await exportInstance(admin)).albums.find(a => String(a._id) === String(item._id));
    const pick = (t: any) => ({ rating: t.rating, tags: t.tags, bpm: t.bpm, key: t.key, notes: t.notes, lyrics: t.lyrics });
    assert.deepEqual(pick(stored.tracklist[0]),
      { rating: 4, tags: ['groove', 'bass'], bpm: 82, key: 'Dm', notes: 'Opener', lyrics: undefined });
    assert.equal(stored.tracklist[1].lyrics, 'Something in the way she moves');
    assert.ok(stored.modified_by, 'a track note counts as an edit of the item');
    assert.deepEqual(stored.tracklist.map((t: any) => String(t._id)), [String(first._id), String(second._id)]);

    reply = await meta(first._id, { rating: 0, bpm: '' });
    stored = (await exportInstance(admin)).albums.find(a => String(a._id) === String(item._id));
    assert.equal(stored.tracklist[0].rating, undefined, 'a zero rating clears it');
    assert.equal(stored.tracklist[0].bpm, undefined);
    assert.equal(stored.tracklist[0].key, 'Dm');

    assert.equal((await meta(first._id, { rating: 9 })).status, 400);
    assert.equal((await meta(first._id, {})).status, 400);
    assert.equal((await meta('0123456789abcdef01234567', { notes: 'x' })).status, 404);

    reply = await admin.get(`/api/album/${item._id}/track/${second._id}/lyrics`);
    assert.deepEqual(reply.json(), { success: true, lyrics: 'Something in the way she moves', cached: true });
  });

  it('sets barcodes in bulk from Discogs ids', async () => {
    const reply = await admin.postForm('/api/batch-update-barcodes', { barcodeList: '24047:5099969944611\n999:123\nnonsense' });
    assert.equal(reply.location, '/admin?msg=batch_barcode_success&count=1');
    const vinyl = (await exportInstance(admin)).albums.find(a => a.discogs_id === 24047);
    assert.equal(vinyl.barcode, '5099969944611');
    assert.equal(vinyl.barcode_locked, true);
  });

  it('imports a CSV into the wishlist, kept apart from what is owned', async () => {
    const csv = 'Title,Artist\nAbbey Road,The Beatles\nLet It Be,The Beatles\nHelp!,The Beatles\n';
    const reply = await admin.postJson('/import/csv', {
      csv, plugin: 'music', type: 'wishlist',
      mapping: {
        title: { source: 'column', column: 'Title' },
        artist: { source: 'column', column: 'Artist' },
        media_type: { source: 'const', value: 'cassette' }
      }
    });
    assert.equal(reply.status, 202, reply.text);
    const dump = await eventually(() => exportInstance(admin), d => titles(d).includes('Help!'), 'the wishlist rows');
    const wished = dump.albums.filter(a => a.in_wishlist).map(a => a.title).sort();
    // Abbey Road was already wished for; Let It Be is owned, which does not stop a wish.
    assert.deepEqual(wished, ['Abbey Road', 'Help!', 'Let It Be']);
  });
});

describe('episodes of a season', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const HASH = '$2b$10$G78cq0e0qnWb1BebNpnT5up.32b.R1tTKv29Et2QfIs22qNRJziyC';
  const USER = '64d000000000000000000001';
  const COLLECTION = '64d000000000000000000002';
  const SEASON = '64d000000000000000000021';

  before(async () => {
    app = await startApp(backend!);
    const dump = {
      users: [{ _id: USER, username: ADMIN.username, email: ADMIN.email, password: HASH, isAdmin: true, lastActiveCollectionId: COLLECTION, lastChange: '2020-01-01T00:00:00.000Z' }],
      collections: [{ _id: COLLECTION, name: 'Films', slug: 'films', createdBy: USER, isDefault: true, shelvesSeeded: true, members: [{ user: USER, role: 'admin' }], shareLinks: [] }],
      settings: [{ collection: COLLECTION, modules: { music: true, dvd: true, books: false, games: false, lego: false, boardgames: false } }],
      albums: [
        { _id: '64d000000000000000000020', kind: 'Dvd', title: 'Dark', director: 'Baran bo Odar', media_type: 'tv', format: 'bluray', tmdb_id: 70523, owner: USER, collection: COLLECTION, in_wishlist: false, quantity: 1 },
        { _id: SEASON, kind: 'Dvd', title: 'Dark: Season 1', director: 'Baran bo Odar', media_type: 'tv', format: 'bluray', tmdb_id: 70523, season: 1, parent: '64d000000000000000000020', owner: USER, collection: COLLECTION, in_wishlist: false, quantity: 1,
          episodes: [{ number: 1, name: 'Secrets', runtime: 51 }, { number: 2, name: 'Lies', runtime: 44 }] }
      ],
      metadata: { version: '3.3.0' }
    };
    const reply = await app.client().postJson('/backup/import', dump);
    assert.equal(reply.status, 200, reply.text);
    admin = await login(app, ADMIN.email, ADMIN.password);
  });
  after(async () => { await app?.stop(); });

  it('records what the owner notes about an episode', async () => {
    const meta = (number: number | string, body: any) => admin.postJson(`/api/dvd/${SEASON}/episode/${number}/meta`, body);
    let reply = await meta(2, { watched: true, rating: 3, notes: '  Twist  ' });
    assert.deepEqual(reply.json(), { success: true });

    const season = () => exportInstance(admin).then(d => d.albums.find(a => String(a._id) === SEASON));
    let stored = await season();
    assert.deepEqual(stored.episodes.map((e: any) => [e.number, e.name, e.watched, e.rating, e.notes]),
      [[1, 'Secrets', undefined, undefined, undefined], [2, 'Lies', true, 3, 'Twist']]);
    assert.ok(stored.modified_by);

    await meta(2, { rating: 0, notes: '' });
    stored = await season();
    assert.deepEqual([stored.episodes[1].rating, stored.episodes[1].notes, stored.episodes[1].watched], [undefined, undefined, true]);

    assert.equal((await meta(7, { watched: true })).status, 404);
    assert.equal((await meta('x', { watched: true })).status, 404);
    assert.equal((await meta(1, { rating: 8 })).status, 400);
    assert.equal((await meta(1, {})).status, 400);
  });

  it('opens the stored episodes of a season without asking TMDB', async () => {
    const reply = await admin.get(`/dvd/${SEASON}/episodes`);
    assert.equal(reply.status, 200);
    assert.match(reply.text, /Secrets/);
    assert.match(reply.text, /Lies/);
  });
});
