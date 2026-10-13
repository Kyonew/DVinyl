import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchOpenLibraryEdition } from '../plugins/books/openLibrary';

// Trimmed from https://openlibrary.org/isbn/9782070612758.json (the edition record the
// /isbn/ path redirects to).
const gallimardEdition = {
  key: '/books/OL9567312M',
  title: 'Le Petit Prince',
  publishers: ['Editions Gallimard'],
  languages: [{ key: '/languages/fre' }],
  isbn_13: ['9782070612758']
};

function mockOpenLibrary(): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    urls.push(url);
    if (url === 'https://openlibrary.org/isbn/9782070612758.json') {
      return new Response(JSON.stringify(gallimardEdition), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as any;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

test('an edition gives its publisher and language', async () => {
  const mock = mockOpenLibrary();
  try {
    const edition = await fetchOpenLibraryEdition('9782070612758', AbortSignal.timeout(1000));
    assert.deepEqual(edition, { publisher: 'Editions Gallimard', languageCode: 'fre' });
    assert.deepEqual(mock.urls, ['https://openlibrary.org/isbn/9782070612758.json']);
  } finally {
    mock.restore();
  }
});

test('an ISBN Open Library does not know resolves to null', async () => {
  const mock = mockOpenLibrary();
  try {
    assert.equal(await fetchOpenLibraryEdition('9798888888888', AbortSignal.timeout(1000)), null);
  } finally {
    mock.restore();
  }
});

test('an edition without publisher or language gives empty strings', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ key: '/books/OL1M' }), { status: 200 })) as any;
  try {
    assert.deepEqual(
      await fetchOpenLibraryEdition('9780000000000', AbortSignal.timeout(1000)),
      { publisher: '', languageCode: '' }
    );
  } finally {
    globalThis.fetch = original;
  }
});
