import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { ADMIN, exportInstance, listedTitles, login, totalBadge } from './fixtures';

const backend = backendFor('stats_contents');

// Hash of ADMIN.password.
const HASH = '$2b$10$G78cq0e0qnWb1BebNpnT5up.32b.R1tTKv29Et2QfIs22qNRJziyC';
const USER = '64c000000000000000000001';
const COLLECTION = '64c000000000000000000002';
const SHOW = '64c000000000000000000020';

/**
 * A dump as a 3.x instance writes it. Seasons cannot be added without reaching TMDB, so
 * a show and its seasons come in through a restore, the way they reach a new install.
 */
const DUMP = {
  users: [{
    _id: USER, username: ADMIN.username, email: ADMIN.email, password: HASH, isAdmin: true,
    lastActiveCollectionId: COLLECTION, lastChange: '2020-01-01T00:00:00.000Z'
  }],
  collections: [{
    _id: COLLECTION, name: 'Vinyl', slug: 'vinyl', createdBy: USER, isDefault: true, shelvesSeeded: true,
    members: [{ user: USER, role: 'admin' }], shareLinks: []
  }],
  settings: [{ collection: COLLECTION, modules: { music: true, dvd: true, books: false, games: false, lego: false, boardgames: false } }],
  albums: [
    { _id: '64c000000000000000000010', kind: 'Music', title: 'The Wall', artist: 'Pink Floyd', media_type: 'vinyl', quantity: 2, genres: ['Rock'], styles: ['Prog Rock'], in_wishlist: false, owner: USER, collection: COLLECTION, added_at: '2020-01-01T00:00:00.000Z' },
    { _id: '64c000000000000000000011', kind: 'Music', title: 'Abbey Road', artist: 'The Beatles', media_type: 'cd', quantity: 1, genre: 'Pop', in_wishlist: false, owner: USER, collection: COLLECTION, added_at: '2020-01-02T00:00:00.000Z' },
    { _id: '64c000000000000000000012', kind: 'Music', title: 'Blue Train', artist: 'John Coltrane', media_type: 'vinyl', quantity: 1, genres: ['Jazz'], in_wishlist: true, owner: USER, collection: COLLECTION, added_at: '2020-01-03T00:00:00.000Z' },
    { _id: SHOW, kind: 'Dvd', title: 'Breaking Bad', director: 'Vince Gilligan', media_type: 'tv', format: 'bluray', tmdb_id: 1396, quantity: 1, genres: ['Drama'], in_wishlist: false, owner: USER, collection: COLLECTION, added_at: '2020-01-04T00:00:00.000Z' },
    { _id: '64c000000000000000000021', kind: 'Dvd', title: 'Breaking Bad: Season 1', director: 'Vince Gilligan', media_type: 'tv', format: 'bluray', tmdb_id: 1396, season: 1, parent: SHOW, quantity: 1, genres: ['Crime'], in_wishlist: false, owner: USER, collection: COLLECTION, added_at: '2020-01-04T00:00:00.000Z' },
    { _id: '64c000000000000000000022', kind: 'Dvd', title: 'Breaking Bad: Season 2', director: 'Vince Gilligan', media_type: 'tv', format: 'bluray', tmdb_id: 1396, season: 2, parent: SHOW, quantity: 1, genres: ['Crime'], in_wishlist: false, owner: USER, collection: COLLECTION, added_at: '2020-01-04T00:00:00.000Z' }
  ],
  lists: [{ _id: '64c000000000000000000030', collection: COLLECTION, name: 'Favourites', kind: 'items', entries: [{ item: '64c000000000000000000010' }] }],
  furniture: [],
  metadata: { version: '3.3.0' }
};

describe('statistics and contained items', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    const reply = await app.client().postJson('/backup/import', DUMP);
    assert.equal(reply.status, 200, reply.text);
    admin = await login(app, ADMIN.email, ADMIN.password);
  });
  after(async () => { await app?.stop(); });

  it('restores contents pointing at their holder', async () => {
    const dump = await exportInstance(admin);
    const seasons = dump.albums.filter(item => item.parent);
    assert.deepEqual(seasons.map(item => [item.season, String(item.parent)]).sort(), [[1, SHOW], [2, SHOW]]);
  });

  it('shows holders only, in listings, counts and the global search', async () => {
    const dump = await exportInstance(admin);
    const html = (await admin.get('/collection?type=all&sort=title_asc&limit=200')).text;
    assert.deepEqual(listedTitles(html, dump), ['Abbey Road', 'Breaking Bad', 'The Wall']);
    assert.equal(totalBadge(html), 3);

    const search = (await admin.get('/search?q=breaking')).text;
    assert.deepEqual([...new Set([...search.matchAll(/\/dvd\/([0-9a-f]{24})/g)].map(m => m[1]))], [SHOW]);
    assert.equal((await admin.get(`/dvd/${SHOW}`)).status, 200);
  });

  it('sums owned quantities on the dashboard, next to the wishlist and list counts', async () => {
    const html = (await admin.get('/dashboard')).text;
    const tiles = [...html.matchAll(/<span class="text-2xl font-extrabold tracking-tight">\s*(\d+)\s*<\/span>/g)]
      .slice(0, 3).map(m => Number(m[1]));
    assert.deepEqual(tiles, [4, 1, 1]);
  });

  it('offers every genre and style of the holders on the visibility settings', async () => {
    const html = (await admin.get('/admin')).text;
    const genres = [...html.matchAll(/name="hiddenGenres" value="([^"]*)"/g)].map(m => m[1]).sort();
    assert.deepEqual(genres, ['Drama', 'Jazz', 'Pop', 'Prog Rock', 'Rock']);
  });

  it('counts holders per collection on the instance page, wishlist included', async () => {
    const html = (await admin.get('/admin/instance')).text;
    const stats = [...html.matchAll(/<p class="text-xl md:text-3xl font-black">\s*(\d+)\s*<\/p>/g)].map(m => Number(m[1]));
    assert.deepEqual(stats, [1, 1, 4, 0]);
    assert.match(html, /\b4 items\b/);
  });

  it('deletes contents with their holder and drops them from lists', async () => {
    const reply = await admin.delete(`/api/dvd/${SHOW}`);
    assert.equal(reply.status, 200);
    const dump = await exportInstance(admin);
    assert.deepEqual(dump.albums.map(item => item.title).sort(), ['Abbey Road', 'Blue Train', 'The Wall']);
    assert.deepEqual(dump.lists[0].entries.map((e: any) => String(e.item)), ['64c000000000000000000010']);
  });
});
