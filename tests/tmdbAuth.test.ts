import assert from 'node:assert/strict';
import test from 'node:test';
import { tmdbFetch } from '../plugins/dvds/tmdb';

// TMDB_API_KEY may hold either credential from TMDB's settings page. These stub fetch to
// see how each one leaves: the short key as a query parameter, the Read Access Token
// (a JWT) as a bearer header and never in the URL, where v3 would answer it with a 401.
async function capture(credential: string, init?: RequestInit) {
  const original = globalThis.fetch;
  const previous = process.env.TMDB_API_KEY;
  let seen: { url: string; headers: Headers } | null = null;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    seen = { url, headers: new Headers(options.headers) };
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  process.env.TMDB_API_KEY = credential;
  try {
    await tmdbFetch('movie/155', { language: 'en-US', append_to_response: 'credits' }, init);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previous;
  }
  return seen!;
}

test('a plain API key goes in the query string', async () => {
  const { url, headers } = await capture('0123456789abcdef');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('api_key'), '0123456789abcdef');
  assert.equal(parsed.searchParams.get('append_to_response'), 'credits');
  assert.equal(headers.get('authorization'), null);
});

test('a Read Access Token goes in a bearer header, not the URL', async () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln';
  const { url, headers } = await capture(`  ${token}\n`);
  assert.equal(new URL(url).searchParams.has('api_key'), false);
  assert.equal(headers.get('authorization'), `Bearer ${token}`);
});

test('headers passed by the caller are kept alongside the bearer', async () => {
  const { headers } = await capture('a.b.c', { headers: { 'User-Agent': 'DVinylApp/2.0' } });
  assert.equal(headers.get('user-agent'), 'DVinylApp/2.0');
  assert.equal(headers.get('authorization'), 'Bearer a.b.c');
});
