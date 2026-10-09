import assert from 'node:assert/strict';
import test from 'node:test';
import { booksPlugin } from '../plugins/books/index';

// Answers each GraphQL call with whatever `respond` returns for its body, keeping the
// bodies so a test can check which lookup was asked.
function mockHardcover(respond: (body: any) => any): { bodies: any[]; restore: () => void } {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return new Response(JSON.stringify({ data: respond(body) }), { status: 200 });
  }) as any;
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

const book = (slug: string) => ({
  id: 280359,
  slug,
  title: 'The Shining',
  release_year: 1977,
  image: { url: 'https://example.test/work.jpg' },
  editions: []
});

test('refresh looks a book up by its Hardcover id and follows a renamed slug', async () => {
  const mock = mockHardcover(() => ({ books_by_pk: book('the-shining-1977') }));
  try {
    const patch = await booksPlugin.refreshItem!(
      { source: 'hardcover', source_id: '280359', hardcover_slug: 'the-shinning' },
      {}
    );
    assert.equal(mock.bodies.length, 1);
    assert.match(mock.bodies[0].query, /books_by_pk/);
    assert.equal(mock.bodies[0].variables.id, 280359);
    assert.equal(patch.hardcover_slug, 'the-shining-1977');
  } finally {
    mock.restore();
  }
});

test('refresh falls back to the slug when the id no longer answers', async () => {
  const mock = mockHardcover(body => body.variables.id ? { books_by_pk: null } : { books: [book('the-shining')] });
  try {
    const patch = await booksPlugin.refreshItem!(
      { source: 'hardcover', source_id: '1', hardcover_slug: 'the-shining' },
      {}
    );
    assert.equal(mock.bodies.length, 2);
    assert.equal(mock.bodies[1].variables.slug, 'the-shining');
    assert.equal(patch.source_id, '280359');
  } finally {
    mock.restore();
  }
});

test('a book saved with only its slug records the Hardcover id on refresh', async () => {
  const mock = mockHardcover(() => ({ books: [book('the-shining')] }));
  try {
    const patch = await booksPlugin.refreshItem!({ hardcover_slug: 'the-shining' }, {});
    assert.equal(mock.bodies.length, 1);
    assert.match(mock.bodies[0].query, /slug/);
    assert.equal(patch.source, 'hardcover');
    assert.equal(patch.source_id, '280359');
  } finally {
    mock.restore();
  }
});

test('a book with neither id nor slug is not refreshable', async () => {
  await assert.rejects(() => booksPlugin.refreshItem!({}, {}), { name: 'PermanentRefreshError' });
});
