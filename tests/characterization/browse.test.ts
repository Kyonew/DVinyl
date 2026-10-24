import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import {
  addMusic, exportInstance, InstanceDump, itemByTitle, listedTitles, setupAdmin, totalBadge, uniqueTitlesBadge
} from './fixtures';

const backend = backendFor('browse');

/** Values offered by the genre and style pickers, and the creator autocomplete. */
function filterChoices(html: string) {
  const checkboxes = (kind: string) =>
    [...html.matchAll(new RegExp(`class="${kind}-checkbox[^"]*"\\s+value="([^"]*)"`, 'g'))].map(m => m[1]);
  const artists = html.match(/const allArtists = (\[.*?\]);/);
  const locations = html.match(/<datalist id="locations-list">([\s\S]*?)<\/datalist>/);
  return {
    genres: checkboxes('genre'),
    styles: checkboxes('style'),
    artists: artists ? JSON.parse(artists[1]!) : null,
    locations: locations ? [...locations[1]!.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]) : null
  };
}

describe('browsing a collection', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let dump: InstanceDump;

  /** Titles shown by the music listing for these query parameters, sorted and paged explicitly. */
  const shown = async (params: Record<string, string>) => {
    const query = new URLSearchParams({ type: 'music', sort: 'title_asc', limit: '200', ...params });
    const reply = await admin.get(`/collection?${query}`);
    assert.equal(reply.status, 200);
    return listedTitles(reply.text, dump);
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    const seed: Record<string, string>[] = [
      { title: 'The Wall', artist: 'Pink Floyd', year: '1979', genres: 'Rock', styles: 'Prog Rock', location: 'Shelf A', barcode: '5099902894225' },
      { title: 'Wall', artist: 'Fake Band', year: '1985', media_type: 'cd', genres: 'Pop', location: 'Shelf B' },
      { title: 'Écoute', artist: 'Élise', year: '1999', media_type: 'cd', genres: 'Chanson' },
      { title: 'Abbey Road', artist: 'The Beatles', year: '1969', genres: 'Rock, Pop', styles: 'Pop Rock', location: 'Shelf A' },
      { title: 'Abbey Road', artist: 'The Beatles', year: '1969', media_type: 'cd', genres: 'Rock' },
      { title: 'Kind of Blue', artist: 'Miles Davis', year: '1959', genres: 'Jazz', styles: 'Modal' },
      { title: 'Blue Train', artist: 'John Coltrane', year: '1957', genres: 'Jazz', in_wishlist: 'true' }
    ];
    for (const [index, fields] of seed.entries()) {
      await addMusic(admin, { ...fields, added_at: `2020-01-0${index + 1}T12:00:00.000Z` });
    }
    dump = await exportInstance(admin);
  });
  after(async () => { await app?.stop(); });

  it('sorts on the normalized title, then the raw one', async () => {
    assert.deepEqual(await shown({ sort: 'title_asc' }),
      ['Abbey Road', 'Abbey Road', 'Écoute', 'Kind of Blue', 'The Wall', 'Wall']);
    assert.deepEqual(await shown({ sort: 'title_desc' }),
      ['Wall', 'The Wall', 'Kind of Blue', 'Écoute', 'Abbey Road', 'Abbey Road']);
  });

  it('sorts on the added date and the year', async () => {
    assert.deepEqual(await shown({ sort: 'added_desc' }),
      ['Kind of Blue', 'Abbey Road', 'Abbey Road', 'Écoute', 'Wall', 'The Wall']);
    assert.deepEqual(await shown({ sort: 'added_asc' }),
      ['The Wall', 'Wall', 'Écoute', 'Abbey Road', 'Abbey Road', 'Kind of Blue']);
    assert.deepEqual(await shown({ sort: 'year_asc' }),
      ['Kind of Blue', 'Abbey Road', 'Abbey Road', 'The Wall', 'Wall', 'Écoute']);
  });

  it('sorts on the creator by raw code point, accented initials last', async () => {
    assert.deepEqual(await shown({ sort: 'artist_asc' }),
      ['Wall', 'Kind of Blue', 'The Wall', 'Abbey Road', 'Abbey Road', 'Écoute']);
  });

  it('remembers the last sort and page size of the browser', async () => {
    await shown({ sort: 'year_asc', limit: '2' });
    const reply = await admin.get('/collection?type=music');
    assert.deepEqual(listedTitles(reply.text, dump), ['Kind of Blue', 'Abbey Road']);
  });

  it('pages through the results', async () => {
    assert.deepEqual(await shown({ limit: '2', page: '2' }), ['Écoute', 'Kind of Blue']);
    assert.deepEqual(await shown({ limit: '2', page: '9' }), []);
    // Out-of-range sizes are clamped rather than refused.
    assert.equal((await shown({ limit: '0' })).length, 6);
  });

  it('searches titles, creators, barcodes and ids, ignoring case', async () => {
    assert.deepEqual(await shown({ search: 'WALL' }), ['The Wall', 'Wall']);
    assert.deepEqual(await shown({ search: 'floyd' }), ['The Wall']);
    assert.deepEqual(await shown({ search: '50999' }), ['The Wall']);
    assert.deepEqual(await shown({ search: ' road ' }), ['Abbey Road', 'Abbey Road']);
    assert.deepEqual(await shown({ search: String(itemByTitle(dump, 'Kind of Blue')._id) }), ['Kind of Blue']);
    assert.deepEqual(await shown({ search: 'a.b' }), [], 'the search text is literal, not a pattern');
  });

  it('matches accented letters only as typed', async () => {
    assert.deepEqual(await shown({ search: 'écoute' }), ['Écoute']);
    assert.deepEqual(await shown({ search: 'ÉCOUTE' }), ['Écoute']);
    assert.deepEqual(await shown({ search: 'ecoute' }), []);
    assert.deepEqual(await shown({ artist: 'élise' }), ['Écoute']);
  });

  it('filters on format, shelf, creator, genre, style and decade', async () => {
    assert.deepEqual(await shown({ format: 'CD' }), ['Abbey Road', 'Écoute', 'Wall']);
    assert.deepEqual(await shown({ location: 'shelf a' }), ['Abbey Road', 'The Wall']);
    assert.deepEqual(await shown({ artist: 'beatles' }), ['Abbey Road', 'Abbey Road']);
    assert.deepEqual(await shown({ genre: 'rock' }), ['Abbey Road', 'Abbey Road', 'The Wall']);
    assert.deepEqual(await shown({ genre: 'Jazz,Chanson' }), ['Écoute', 'Kind of Blue']);
    assert.deepEqual(await shown({ style: 'prog' }), ['The Wall']);
    assert.deepEqual(await shown({ decade: '1960' }), ['Abbey Road', 'Abbey Road']);
    assert.deepEqual(await shown({ decade: '1950,1990' }), ['Écoute', 'Kind of Blue']);
    assert.deepEqual(await shown({ genre: 'rock', format: 'cd' }), ['Abbey Road']);
  });

  it('hides what matches instead of showing it', async () => {
    assert.deepEqual(await shown({ genre: 'rock', filterMode: 'hide' }), ['Écoute', 'Kind of Blue', 'Wall']);
  });

  it('counts items and distinct works', async () => {
    let html = (await admin.get('/collection?type=music&limit=200')).text;
    assert.equal(totalBadge(html), 6);
    assert.deepEqual(uniqueTitlesBadge(html), { count: 5, hidden: false });

    html = (await admin.get('/collection?type=music&format=cd&limit=200')).text;
    assert.equal(totalBadge(html), 3);
    assert.deepEqual(uniqueTitlesBadge(html), { count: 3, hidden: true });

    html = (await admin.get('/collection?limit=200')).text;
    assert.equal(totalBadge(html), 6);
    assert.equal(uniqueTitlesBadge(html).count, 5);
  });

  it('offers the values in use as filter choices', async () => {
    const choices = filterChoices((await admin.get('/collection?type=music&limit=200')).text);
    assert.deepEqual(choices.genres, ['Chanson', 'Jazz', 'Pop', 'Rock']);
    assert.deepEqual(choices.styles, ['Modal', 'Pop Rock', 'Prog Rock']);
    assert.deepEqual(choices.artists, ['Fake Band', 'Miles Davis', 'Pink Floyd', 'The Beatles', 'Élise']);
    assert.deepEqual(choices.locations, ['Shelf A', 'Shelf B']);
  });

  it('lists only wishlist entries on the wishlist', async () => {
    const html = (await admin.get('/wishlist?limit=200&sort=title_asc')).text;
    assert.deepEqual(listedTitles(html, dump), ['Blue Train']);
    assert.equal(totalBadge(html), 1);
  });

  it('finds owned items from the global search, on titles and creators only', async () => {
    const found = async (q: string) => {
      const html = (await admin.get(`/search?q=${encodeURIComponent(q)}`)).text;
      const byId = new Map(dump.albums.map(item => [String(item._id), item.title]));
      return [...new Set([...html.matchAll(/\/album\/([0-9a-f]{24})/g)].map(m => byId.get(m[1]!)))].sort();
    };
    assert.deepEqual(await found('blue'), ['Kind of Blue']);
    assert.deepEqual(await found('BEATLES'), ['Abbey Road']);
    assert.deepEqual(await found('5099902894225'), []);
  });
});
