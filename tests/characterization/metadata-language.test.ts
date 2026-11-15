import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { enableModules, exportInstance, saveItem, setupAdmin } from './fixtures';

const backend = backendFor('metadata_language');

describe('films: cast, original title and the language of fetched information', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  const modulesForm = (extra: Record<string, string>) => admin.postForm('/admin/modules/save', { dvdActive: 'on', musicActive: 'on', mergeDuplicates: 'on', ...extra });
  const stored = async () => (await exportInstance(admin)).settings[0].metadataLanguage;
  const found = async (search: string) => {
    const html = (await admin.get(`/collection?type=dvd&search=${encodeURIComponent(search)}&view=table`)).text;
    return [...html.matchAll(/title="([^"]+)"><span|class="font-bold truncate block[^"]*" title="([^"]+)"/g)].map(m => m[1] || m[2]);
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await enableModules(admin, ['dvd', 'music']);
    const reply = await saveItem(admin, 'dvd', {
      title: 'Skazani na Shawshank', original_title: 'The Shawshank Redemption', director: 'Frank Darabont',
      cast: 'Tim Robbins, Morgan Freeman, Bob Gunton', format: 'bluray', media_type: 'movie',
      // What the confirm page carries from TMDB.
      cast_details_json: JSON.stringify([
        { name: 'Tim Robbins', character: 'Andy Dufresne', photo: '/hsCu1JUzQQ4pl7uFxAVFLOs9yHh.jpg', tmdb_id: 504 },
        { name: 'Morgan Freeman', character: 'Ellis Boyd Redding', photo: '/jPsLqiYGSofU4s6BjrxnefMfabb.jpg', tmdb_id: 192 },
        { name: 'Removed Later', character: 'Nobody', photo: '/x.jpg', tmdb_id: 1 }
      ])
    });
    assert.equal(reply.status, 302, reply.text.slice(0, 300));
    await saveItem(admin, 'dvd', { title: 'Heat', director: 'Michael Mann', cast: 'Al Pacino, Robert De Niro', format: 'dvd', media_type: 'movie' });
  });
  after(async () => { await app?.stop(); });

  it('stores the cast as names and the original title', async () => {
    const film = (await exportInstance(admin)).albums.find((a: any) => a.title === 'Skazani na Shawshank');
    assert.deepEqual(film.cast, ['Tim Robbins', 'Morgan Freeman', 'Bob Gunton']);
    assert.deepEqual(film.cast_details.map((c: any) => c.character), ['Andy Dufresne', 'Ellis Boyd Redding', 'Nobody']);
    assert.equal(film.original_title, 'The Shawshank Redemption');
  });

  it('finds a film by an actor or by its original title', async () => {
    assert.deepEqual(await found('morgan freeman'), ['Skazani na Shawshank']);
    assert.deepEqual(await found('Shawshank Redemption'), ['Skazani na Shawshank']);
    assert.deepEqual(await found('De Niro'), ['Heat']);
  });

  it('shows both on the item page', async () => {
    const film = (await exportInstance(admin)).albums.find((a: any) => a.title === 'Skazani na Shawshank');
    const page = (await admin.get(`/dvd/${film._id}`)).text;
    assert.match(page, /Original title/);
    assert.match(page, /The Shawshank Redemption/);
    assert.match(page, /Morgan Freeman/);
  });

  it('draws the cast as portraits with their parts, initials for a name TMDB did not give, nothing for one taken out', async () => {
    const film = (await exportInstance(admin)).albums.find((a: any) => a.title === 'Skazani na Shawshank');
    const page = (await admin.get(`/dvd/${film._id}`)).text;
    const row = page.slice(page.indexOf('image.tmdb.org/t/p/w185/hsCu') - 200);
    assert.match(page, /src="https:\/\/image\.tmdb\.org\/t\/p\/w185\/hsCu1JUzQQ4pl7uFxAVFLOs9yHh\.jpg"/);
    assert.match(row, /Andy Dufresne/);
    assert.match(row, />BG</, 'Bob Gunton has no portrait, so his initials');
    assert.doesNotMatch(page, /Removed Later|Nobody/, 'only the names still in the cast');
    assert.match(page, /href="\/collection\?type=dvd&amp;search=Morgan%20Freeman"/);
  });

  it('leaves the parts and portraits alone when the film is edited', async () => {
    const film = (await exportInstance(admin)).albums.find((a: any) => a.title === 'Skazani na Shawshank');
    const reply = await saveItem(admin, 'dvd', {
      mongo_id: String(film._id), title: film.title, original_title: film.original_title, director: film.director,
      cast: 'Tim Robbins, Morgan Freeman', format: 'bluray', media_type: 'movie'
    });
    assert.equal(reply.status, 302, reply.text.slice(0, 300));
    const after = (await exportInstance(admin)).albums.find((a: any) => a.title === 'Skazani na Shawshank');
    assert.equal(after.cast_details.length, 3);
    assert.deepEqual(after.cast, ['Tim Robbins', 'Morgan Freeman']);
  });

  it('keeps each member\'s language until the collection picks one, and nothing it does not offer', async () => {
    assert.equal(await stored(), '');
    assert.match((await admin.get('/admin')).text, /Language of fetched information/);
    await modulesForm({ metadataLanguage: 'pl' });
    assert.equal(await stored(), 'pl');
    assert.match((await admin.get('/admin')).text, /value="pl"[^>]*selected/);
    await modulesForm({ metadataLanguage: 'xx-evil' });
    assert.equal(await stored(), '');
  });
});
