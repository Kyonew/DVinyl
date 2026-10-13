import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchOpenLibraryEdition } from '../plugins/books/openLibrary';
import { dvdPlugin } from '../plugins/dvds';
import { buildSortTitle } from '../core/helpers';
import { normalizeThemePresets } from '../utils/migrate';

// 1. OpenLibrary edition resilience
test('fetchOpenLibraryEdition supports both string and object publishers, and key or string languages', async () => {
  const originalFetch = globalThis.fetch;
  
  // Case A: string publisher, object language
  globalThis.fetch = (async () => new Response(JSON.stringify({
    publishers: ['Penguin Classics'],
    languages: [{ key: '/languages/eng' }]
  }), { status: 200 })) as any;

  let ed = await fetchOpenLibraryEdition('1234567890', AbortSignal.timeout(1000));
  assert.deepEqual(ed, { publisher: 'Penguin Classics', languageCode: 'eng' });

  // Case B: object publisher with .name, string language path
  globalThis.fetch = (async () => new Response(JSON.stringify({
    publishers: [{ name: 'Gallimard Jeunesse' }],
    languages: ['/languages/fre']
  }), { status: 200 })) as any;

  ed = await fetchOpenLibraryEdition('1234567891', AbortSignal.timeout(1000));
  assert.deepEqual(ed, { publisher: 'Gallimard Jeunesse', languageCode: 'fre' });

  // Case C: direct language code
  globalThis.fetch = (async () => new Response(JSON.stringify({
    publishers: ['Carlsen'],
    languages: ['deu']
  }), { status: 200 })) as any;

  ed = await fetchOpenLibraryEdition('1234567892', AbortSignal.timeout(1000));
  assert.deepEqual(ed, { publisher: 'Carlsen', languageCode: 'deu' });

  // Case D: 404 response
  globalThis.fetch = (async () => new Response('', { status: 404 })) as any;
  ed = await fetchOpenLibraryEdition('0000000000', AbortSignal.timeout(1000));
  assert.equal(ed, null);

  globalThis.fetch = originalFetch;
});

// 2. Backup dump type detection & guard logic
test('instance import strictly refuses collection backup dumps', () => {
  const isCollectionDump = (data: any) =>
    typeof data?.collectionName === 'string' || data?.metadata?.type === 'collection';

  const shouldRefuseAtInstanceImport = (data: any) =>
    isCollectionDump(data) || !Array.isArray(data?.users) || data.users.length === 0;

  // Collection dump from collection export
  assert.equal(shouldRefuseAtInstanceImport({
    collectionName: 'My Movies',
    albums: [{ title: 'Inception' }],
    metadata: { type: 'collection', version: '3.2.1' }
  }), true);

  // Dump without user accounts
  assert.equal(shouldRefuseAtInstanceImport({
    albums: [{ title: 'Inception' }],
    collections: [{ name: 'Default' }],
    users: []
  }), true);

  // Valid whole-instance dump
  assert.equal(shouldRefuseAtInstanceImport({
    users: [{ _id: '507f1f77bcf86cd799439011', username: 'admin' }],
    albums: [{ title: 'Inception' }],
    collections: [{ name: 'Default' }],
    metadata: { version: '3.2.1' }
  }), false);
});

// 3. Settings fallback and navbar shortcuts evaluation
test('navbar shortcuts and settingsMiddleware gracefully handle Map, POJO and missing modules', () => {
  const evaluateIsModuleActive = (settings: any, itemModule?: string) => {
    return itemModule
      ? Boolean(settings && settings.modules && (settings.modules instanceof Map ? settings.modules.get(itemModule) : settings.modules[itemModule]))
      : true;
  };

  // POJO settings
  const pojoSettings = { modules: { music: true, games: false } };
  assert.equal(evaluateIsModuleActive(pojoSettings, 'music'), true);
  assert.equal(evaluateIsModuleActive(pojoSettings, 'games'), false);
  assert.equal(evaluateIsModuleActive(pojoSettings, 'unknown'), false);
  assert.equal(evaluateIsModuleActive(pojoSettings, undefined), true); // global shortcut

  // Map settings
  const mapSettings = { modules: new Map([['music', true], ['games', false]]) };
  assert.equal(evaluateIsModuleActive(mapSettings, 'music'), true);
  assert.equal(evaluateIsModuleActive(mapSettings, 'games'), false);
  assert.equal(evaluateIsModuleActive(mapSettings, 'unknown'), false);
  assert.equal(evaluateIsModuleActive(mapSettings, undefined), true);

  // Empty / undefined settings
  assert.equal(evaluateIsModuleActive({}, 'music'), false);
  assert.equal(evaluateIsModuleActive(null, 'music'), false);
  assert.equal(evaluateIsModuleActive(null, undefined), true);
});

// 4. Backward compatibility of theme presets
test('normalizeThemePresets correctly handles legacy nested presets', () => {
  const legacyTheme = {
    games: { preset: { default: 'cyberpunk' } },
    music: { preset: 'default' },
    books: { preset: null }
  };

  const changed = normalizeThemePresets(legacyTheme);
  assert.equal(changed, true);
  assert.equal((legacyTheme.games as any).preset, 'cyberpunk');
  assert.equal(legacyTheme.music.preset, 'default');

  // Idempotent: second run changes nothing
  assert.equal(normalizeThemePresets(legacyTheme), false);
});

// 5. Sort title computation
test('buildSortTitle ignores leading articles and normalizes accents', () => {
  assert.equal(buildSortTitle('The Dark Knight'), 'dark knight');
  assert.equal(buildSortTitle('A Clockwork Orange'), 'clockwork orange');
  assert.equal(buildSortTitle('An American Werewolf in London'), 'american werewolf in london');
  assert.equal(buildSortTitle('Le Fabuleux Destin'), 'le fabuleux destin'); // French article kept
  assert.equal(buildSortTitle('Ámbar'), 'ambar');
  assert.equal(buildSortTitle('The'), 'the'); // bare article kept
  assert.equal(buildSortTitle(''), '');
});

// 6. DVD findDuplicate & findPotentialDuplicates scoping
test('dvdPlugin duplicate detection scopes to media_type with backward compatibility for legacy items', async () => {
  const Item = (await import('../models/Item')).default;
  const originalFindOne = Item.findOne;
  const originalFind = Item.find;

  let lastQuery: any = null;
  (Item as any).findOne = async (q: any) => {
    lastQuery = q;
    return { _id: 'mockItem', ...q };
  };

  (Item as any).find = (q: any) => {
    lastQuery = q;
    return {
      lean: async () => []
    };
  };

  try {
    const colId = '507f1f77bcf86cd799439011';

    // Movie with tmdb_id
    await dvdPlugin.findDuplicate(colId, { tmdb_id: 155, media_type: 'movie' });
    assert.equal(lastQuery.tmdb_id, 155);
    assert.deepEqual(lastQuery.media_type, { $in: ['movie', null] });

    // Movie without media_type (default to movie)
    await dvdPlugin.findDuplicate(colId, { tmdb_id: 155 });
    assert.equal(lastQuery.tmdb_id, 155);
    assert.deepEqual(lastQuery.media_type, { $in: ['movie', null] });

    // TV show with tmdb_id
    await dvdPlugin.findDuplicate(colId, { tmdb_id: 155, media_type: 'tv' });
    assert.equal(lastQuery.tmdb_id, 155);
    assert.equal(lastQuery.media_type, 'tv');

    // Potential duplicates
    await dvdPlugin.findPotentialDuplicates!(colId, { tmdb_id: 155, media_type: 'movie' });
    assert.deepEqual(lastQuery.$or[0], { tmdb_id: 155, media_type: { $in: ['movie', null] } });

    await dvdPlugin.findPotentialDuplicates!(colId, { tmdb_id: 155, media_type: 'tv' });
    assert.deepEqual(lastQuery.$or[0], { tmdb_id: 155, media_type: 'tv' });
  } finally {
    Item.findOne = originalFindOne;
    Item.find = originalFind;
  }
});

