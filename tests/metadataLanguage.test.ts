import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { baseLanguage, metadataLanguage, withRegion } from '../core/metadataLanguage';
import { castCredits, castOf, TMDBProvider } from '../plugins/dvds/tmdb';
import { formatSeasonCount } from '../plugins/dvds/constants';
import dvdPlugin from '../plugins/dvds/index';

/** Answers TMDB calls from `pages` by path, and keeps what was asked. */
async function withTmdb<T>(pages: Record<string, any>, run: (asked: URL[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const previous = process.env.TMDB_API_KEY;
  const asked: URL[] = [];
  globalThis.fetch = (async (url: string) => {
    const parsed = new URL(url);
    asked.push(parsed);
    const page = pages[parsed.pathname.replace('/3/', '')];
    return new Response(JSON.stringify(page ?? {}), { status: page ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  process.env.TMDB_API_KEY = 'key';
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previous;
  }
}

const SHAWSHANK = {
  id: 278, title: 'Skazani na Shawshank', original_title: 'The Shawshank Redemption', release_date: '1994-09-23', runtime: 142,
  credits: {
    crew: [{ job: 'Director', name: 'Frank Darabont' }],
    cast: [
      { id: 192, name: 'Morgan Freeman', character: 'Ellis Boyd "Red" Redding', profile_path: '/jPsLqiYGSofU4s6BjrxnefMfabb.jpg', order: 1 },
      { id: 504, name: 'Tim Robbins', character: 'Andy Dufresne', profile_path: 'javascript:alert(1)', order: 0 },
      { name: 'Morgan Freeman', order: 5 },
      { name: '', order: 2 }
    ]
  }
};

describe('metadata language', () => {
  it('takes the collection\'s choice, else the reader\'s language', () => {
    const req = (settings: any, language = 'fr') => ({ language, res: { locals: { settings } } });
    assert.equal(metadataLanguage(req({ metadataLanguage: 'pl' })), 'pl');
    assert.equal(metadataLanguage(req({ metadataLanguage: '' })), 'fr');
    assert.equal(metadataLanguage(req({ metadataLanguage: 'klingon' })), 'fr', 'anything not offered is ignored');
    assert.equal(metadataLanguage(req(undefined, '')), 'en');
    assert.equal(metadataLanguage(undefined), 'en');
  });

  it('gives TMDB a language with its region', () => {
    assert.equal(withRegion('fr'), 'fr-FR');
    assert.equal(withRegion('en'), 'en-US');
    assert.equal(withRegion('pl'), 'pl-PL');
    assert.equal(withRegion('ja'), 'ja-JP');
    assert.equal(withRegion('pt-BR'), 'pt-BR');
    assert.equal(withRegion(''), 'en-US');
    assert.equal(withRegion('<script>'), 'en-US');
    assert.equal(baseLanguage('zh-TW'), 'zh');
  });

  it('words a season count in English for a language it has no words for', () => {
    assert.equal(formatSeasonCount(2, 'pt-BR'), '2 seasons');
    assert.equal(formatSeasonCount(1, 'de'), '1 Staffel');
  });
});

describe('TMDB cast and original title', () => {
  it('keeps the leading actors once each, in billing order', () => {
    assert.deepEqual(castOf(SHAWSHANK.credits), ['Tim Robbins', 'Morgan Freeman']);
    assert.deepEqual(castOf(undefined), []);
    const crowd = { cast: Array.from({ length: 30 }, (_, i) => ({ name: `Actor ${i}`, order: i })) };
    assert.equal(castOf(crowd).length, 10);
  });

  it('keeps each actor\'s part and portrait, only ever as a TMDB image path', () => {
    assert.deepEqual(castCredits(SHAWSHANK.credits), [
      { name: 'Tim Robbins', character: 'Andy Dufresne', photo: '', tmdb_id: 504 },
      { name: 'Morgan Freeman', character: 'Ellis Boyd "Red" Redding', photo: '/jPsLqiYGSofU4s6BjrxnefMfabb.jpg', tmdb_id: 192 }
    ]);
  });

  it('names a show\'s actor by the part played in the most episodes', () => {
    const credits = { cast: [{ id: 1, name: 'Ian', order: 0, roles: [{ character: 'Cameo', episode_count: 1 }, { character: 'Lead', episode_count: 40 }] }] };
    assert.equal(castCredits(credits)[0]!.character, 'Lead');
  });

  it('reads a film in the language asked, with its original title and cast', async () => {
    await withTmdb({ 'movie/278': SHAWSHANK }, async asked => {
      const film: any = await new TMDBProvider().getDetails('movie_278', { language: 'pl' });
      assert.equal(asked[0]!.searchParams.get('language'), 'pl-PL');
      assert.equal(film.title, 'Skazani na Shawshank');
      assert.equal(film.original_title, 'The Shawshank Redemption');
      assert.deepEqual(film.cast, ['Tim Robbins', 'Morgan Freeman']);
      assert.equal(film.director, 'Frank Darabont');
    });
  });

  it('leaves the original title empty when it is the title, and takes a show\'s cast across its seasons', async () => {
    const show = {
      id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17', number_of_seasons: 8,
      created_by: [{ name: 'David Benioff' }],
      credits: { cast: [{ name: 'Latest Season Only', order: 0 }] },
      aggregate_credits: { cast: [{ name: 'Emilia Clarke', order: 1 }, { name: 'Peter Dinklage', order: 0 }] }
    };
    await withTmdb({ 'tv/1399': show }, async asked => {
      const found: any = await new TMDBProvider().getDetails('tv_1399', { language: 'en' });
      assert.equal(asked[0]!.searchParams.get('append_to_response'), 'credits,aggregate_credits');
      assert.equal(found.original_title, '');
      assert.deepEqual(found.cast, ['Peter Dinklage', 'Emilia Clarke']);
    });
  });

  it('refreshes in the collection\'s language, bringing the cast and original title to an old item', async () => {
    await withTmdb({ 'movie/278': SHAWSHANK }, async asked => {
      const req = { language: 'en', res: { locals: { settings: { metadataLanguage: 'pl' } } } };
      const patch = await dvdPlugin.refreshItem!({ tmdb_id: 278, media_type: 'movie', title: 'My own title' }, req);
      assert.equal(asked[0]!.searchParams.get('language'), 'pl-PL');
      assert.equal(patch.original_title, 'The Shawshank Redemption');
      assert.deepEqual(patch.cast, ['Tim Robbins', 'Morgan Freeman']);
      assert.equal(patch.title, undefined, 'a film keeps the title it was given');
      assert.equal(patch.duration, '142 min');
    });
  });

  it('splits a cast typed on the form into names', () => {
    const data: any = { cast: 'Tim Robbins, Morgan Freeman ,' };
    dvdPlugin.normalizeForSave!(data);
    assert.deepEqual(data.cast, ['Tim Robbins', 'Morgan Freeman']);
    assert.equal('cast_details' in data, false, 'an edit, which posts none, leaves them alone');
  });

  it('keeps only plain text and TMDB portraits from posted parts', () => {
    const data: any = { cast_details: [
      { name: ' Tim Robbins ', character: 'Andy', photo: '/a1.jpg', tmdb_id: 504 },
      { name: 'Evil', character: { $gt: '' }, photo: 'https://evil.example/x.jpg', tmdb_id: '1' },
      { name: '' }, null, 'text'
    ] };
    dvdPlugin.normalizeForSave!(data);
    assert.deepEqual(data.cast_details, [
      { name: 'Tim Robbins', character: 'Andy', photo: '/a1.jpg', tmdb_id: 504 },
      { name: 'Evil', character: '', photo: '', tmdb_id: null }
    ]);
    const odd: any = { cast_details: 'nope' };
    dvdPlugin.normalizeForSave!(odd);
    assert.deepEqual(odd.cast_details, []);
  });
});
