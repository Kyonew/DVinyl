import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenLibraryProvider, parseSeries, languageFromMarc } from '../plugins/books/openLibrary';
import booksPlugin from '../plugins/books/index';

// Trimmed from the real records of ISBN 9780141346052 (issue #198), which Hardcover does
// not know: the edition names no author, its work does.
const PAGES: Record<string, any> = {
  '/isbn/9780141346052.json': { key: '/books/OL62553552M' },
  '/books/OL62553552M.json': {
    key: '/books/OL62553552M', title: 'Hollywood, Ending', publishers: ['Penguin Random House NZ'],
    isbn_13: ['9780141346052'], works: [{ key: '/works/OL45985843W' }]
  },
  '/works/OL45985843W.json': { title: 'Hollywood, Ending', authors: [{ author: { key: '/authors/OL4271523A' } }] },
  '/authors/OL4271523A.json': { name: 'John Green' },
  '/books/OL7353617M.json': {
    title: "Harry Potter and the Philosopher's Stone", publishers: ['Bloomsbury Publishing'], number_of_pages: 223,
    series: ['Harry Potter, #1'], covers: [7355968, -1], isbn_13: ['9780747532699'], publish_date: 'June 26, 1997',
    languages: [{ key: '/languages/eng' }], works: [{ key: '/works/OL82563W' }], authors: [{ key: '/authors/OL23919A' }]
  },
  '/works/OL82563W.json': { description: { type: '/type/text', value: 'Turning the envelope over...' }, subjects: ['Wizards', 'Fantasy', 'Magic'] },
  '/authors/OL23919A.json': { name: 'J. K. Rowling' }
};

async function withOpenLibrary<T>(run: (asked: string[]) => Promise<T>, extra: Record<string, any> = {}): Promise<T> {
  const original = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    asked.push(path);
    assert.match(new Headers(init.headers).get('user-agent') || '', /^DVinyl /);
    const page = { ...PAGES, ...extra }[parsed.pathname === '/search.json' ? path : parsed.pathname];
    return new Response(JSON.stringify(page ?? {}), { status: page ? 200 : 404 });
  }) as typeof fetch;
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = original;
  }
}

describe('Open Library as a search source', () => {
  it('finds a book by ISBN, its author read from its work', async () => {
    await withOpenLibrary(async () => {
      const [hit] = await new OpenLibraryProvider().search('978-0-14-134605-2', {} as any) as any[];
      assert.equal(hit.id, 'OL62553552M');
      assert.equal(hit.title, 'Hollywood, Ending');
      assert.equal(hit.author, 'John Green');
      assert.equal(hit.publisher, 'Penguin Random House NZ');
      assert.equal(hit.isbn, '9780141346052');
      assert.deepEqual(hit.confirmQuery, { isbn: '9780141346052' });
    });
  });

  it('answers an ISBN it does not know with no results', async () => {
    await withOpenLibrary(async () => {
      assert.deepEqual(await new OpenLibraryProvider().search('9780000000002', {} as any), []);
    });
  });

  it('describes an edition from it and its work', async () => {
    await withOpenLibrary(async () => {
      const book: any = await new OpenLibraryProvider().getDetails('OL7353617M', {});
      assert.deepEqual(
        { author: book.author, year: book.year, pages: book.pages, language: book.language, series: book.series, volume: book.volume, genres: book.genres },
        { author: 'J. K. Rowling', year: '1997', pages: 223, language: 'English', series: 'Harry Potter', volume: 1, genres: ['Fantasy'] }
      );
      assert.equal(book.cover_image, 'https://covers.openlibrary.org/b/id/7355968-L.jpg');
      assert.equal(book.description, 'Turning the envelope over...');
    });
  });

  it('refuses anything but an edition id, before asking anything', async () => {
    await withOpenLibrary(async asked => {
      await assert.rejects(() => new OpenLibraryProvider().getDetails('../../admin', {}));
      assert.deepEqual(asked, []);
    });
  });

  it('turns a text search into editions', async () => {
    const search = '/search.json?q=harry%20potter&fields=title,author_name,first_publish_year,cover_i,cover_edition_key,edition_key&limit=24';
    await withOpenLibrary(async () => {
      const hits: any[] = await new OpenLibraryProvider().search('harry potter', {} as any);
      assert.deepEqual(hits.map(h => [h.id, h.author, h.year]), [['OL7353617M', 'J. K. Rowling', '1997'], ['OL2M', '', '']]);
    }, { [search]: { docs: [
      { title: 'HP', author_name: ['J. K. Rowling'], first_publish_year: 1997, cover_edition_key: 'OL7353617M', cover_i: 1 },
      { title: 'No print', edition_key: ['bad', 'OL2M'] },
      { title: 'Nothing to add' }
    ] } });
  });

  it('refreshes a book added from it, and links it there', async () => {
    await withOpenLibrary(async () => {
      const item = { source: 'openlibrary', source_id: 'OL7353617M', isbn: '1', barcode: '1', barcode_locked: true };
      const patch = await booksPlugin.refreshItem!(item, {});
      assert.equal(patch.pages, 223);
      assert.equal(patch.isbn, '1', 'a locked barcode stays');
      assert.deepEqual(booksPlugin.externalLink!(item), { label: 'Open Library', url: 'https://openlibrary.org/books/OL7353617M' });
    });
  });

  it('reads series and languages the way Open Library writes them', () => {
    assert.deepEqual(parseSeries('Harry Potter, #1'), { series: 'Harry Potter', volume: 1 });
    assert.deepEqual(parseSeries('Discworld vol. 12'), { series: 'Discworld', volume: 12 });
    assert.deepEqual(parseSeries('Penguin Classics'), { series: 'Penguin Classics', volume: null });
    assert.equal(languageFromMarc('fre'), 'fr');
    assert.equal(languageFromMarc('xyz'), 'xyz');
  });
});
