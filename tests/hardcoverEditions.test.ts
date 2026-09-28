import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { HardcoverProvider, normalizeIsbn, preferPickedEdition } from '../plugins/books/hardcover';

// Untyped package, loaded the way Express loads it for the views.
const ejs = require('ejs');

const edition = (id: number, isbn: string, publisher: string, extra: Record<string, any> = {}) => ({
  id,
  isbn_13: isbn,
  isbn_10: null,
  publisher: { name: publisher },
  language: { language: 'English' },
  pages: 400,
  release_date: '2012-06-26',
  edition_format: null,
  physical_format: 'Paperback',
  image: null,
  ...extra
});

function mockHardcover(book: any): { bodies: any[]; restore: () => void } {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ data: { books_by_pk: book } }), { status: 200 });
  }) as any;
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

const baseBook = () => ({
  id: 280359,
  slug: 'the-shining',
  title: 'The Shining',
  release_year: 1977,
  image: { url: 'https://example.test/work.jpg' },
  editions: [edition(1, '9780307743657', 'Anchor'), edition(2, '9780385121675', 'Doubleday')]
});

test('normalizeIsbn accepts ISBN-10 and ISBN-13 only', () => {
  assert.equal(normalizeIsbn('978-2-253-15162-3'), '9782253151623');
  assert.equal(normalizeIsbn('225315162x'), '225315162X');
  assert.equal(normalizeIsbn('12345'), '');
  assert.equal(normalizeIsbn({ $ne: null }), '');
  assert.equal(normalizeIsbn(['9782253151623', '9780307743657']), '');
});

test('preferPickedEdition moves the matched edition first without duplicating it', () => {
  const book: any = baseBook();
  book.picked = [book.editions[1]];
  assert.equal(preferPickedEdition(book), true);
  assert.deepEqual(book.editions.map((e: any) => e.id), [2, 1]);
  assert.equal(preferPickedEdition({ editions: [], picked: [] }), false);
});

test('getDetails preselects the edition of the searched ISBN, even outside the most read ones', async () => {
  const book: any = baseBook();
  book.picked = [edition(3, '9782253151623', 'Le Livre de Poche', {
    language: { language: 'French' },
    image: { url: 'https://example.test/poche.jpg' }
  })];
  const mock = mockHardcover(book);
  try {
    const details: any = await new HardcoverProvider().getDetails('280359', { isbn: '978-2-253-15162-3' });
    assert.equal(mock.bodies[0].variables.isbn, '9782253151623');
    assert.equal(details.isbn, '9782253151623');
    assert.equal(details.publisher, 'Le Livre de Poche');
    assert.equal(details.language, 'French');
    assert.equal(details.cover_image, 'https://example.test/poche.jpg');
    assert.deepEqual(details.editions.map((e: any) => e.id), [3, 1, 2]);
  } finally {
    mock.restore();
  }
});

test('getDetails without an ISBN keeps the most read edition and asks for no picked one', async () => {
  const mock = mockHardcover(baseBook());
  try {
    const details: any = await new HardcoverProvider().getDetails('280359', {});
    assert.equal(mock.bodies[0].variables.isbn, undefined);
    assert.doesNotMatch(mock.bodies[0].query, /picked/);
    assert.equal(details.publisher, 'Anchor');
    assert.equal(details.cover_image, 'https://example.test/work.jpg');
  } finally {
    mock.restore();
  }
});

test('the edition picker cannot be broken out of its script tag by edition data', async () => {
  const hostile = '</script><script>window.pwned=1</script>';
  const html = await ejs.renderFile(
    path.join(__dirname, '../plugins/books/partials/edition-picker.ejs'),
    {
      item: { cover_image: '', editions: [{ id: 1, publisher: hostile, isbn: '1' }, { id: 2, publisher: 'B', isbn: '2' }] },
      t: (key: string) => key
    }
  );
  assert.equal(html.includes('<script>window.pwned'), false);
  assert.match(html, /\\u003c\/script>/);
});
