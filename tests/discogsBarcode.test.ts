import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscogsProvider } from '../plugins/music/discogs';
import { confirmPathFor } from '../core/helpers';

// Trimmed from the real answers for 724385522925, a CD pressing of OK Computer (discussion #236).
const SEARCH = { results: [{ id: 83182, title: 'Radiohead - OK Computer', year: '1997', country: 'Europe', format: ['CD', 'Album'] }] };
const RELEASE = {
  id: 83182, title: 'OK Computer', year: 1997, country: 'Europe',
  artists: [{ name: 'Radiohead' }], labels: [{ name: 'Parlophone' }],
  formats: [{ name: 'CD', qty: '1', descriptions: ['Album'] }],
  identifiers: [{ type: 'Barcode', value: '724385522925' }],
  tracklist: [], images: []
};

async function withDiscogs<T>(run: (asked: URL[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const asked: URL[] = [];
  globalThis.fetch = (async (url: string) => {
    const parsed = new URL(url);
    asked.push(parsed);
    const body = parsed.pathname.startsWith('/releases/') ? RELEASE : SEARCH;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = original;
  }
}

describe('Discogs barcode search', () => {
  it('asks for the barcode without the format picked on the form', async () => {
    await withDiscogs(async asked => {
      const results = await new DiscogsProvider().search('7 24385-52292 5', { type: 'vinyl' } as any);
      assert.equal(asked.length, 1);
      assert.equal(asked[0]!.searchParams.get('barcode'), '724385522925');
      assert.equal(asked[0]!.searchParams.get('format'), null);
      assert.equal(asked[0]!.searchParams.get('q'), null);
      assert.deepEqual(results[0]!.confirmQuery, { by_barcode: '1' });
    });
  });

  it('keeps a format typed in the advanced filters', async () => {
    await withDiscogs(async asked => {
      await new DiscogsProvider().search('724385522925', { type: 'vinyl', format_filter: 'SACD' } as any);
      assert.equal(asked[0]!.searchParams.get('format'), 'SACD');
    });
  });

  it('leaves a text search filtered on the picked format', async () => {
    await withDiscogs(async asked => {
      const results = await new DiscogsProvider().search('OK Computer', { type: 'cd' } as any);
      assert.equal(asked[0]!.searchParams.get('format'), 'cd');
      assert.equal(asked[0]!.searchParams.get('barcode'), null);
      assert.equal(results[0]!.confirmQuery, undefined);
    });
  });

  it('takes the media type from the release once found by its barcode', async () => {
    await withDiscogs(async () => {
      const result = (await new DiscogsProvider().search('724385522925', { type: 'vinyl' } as any))[0]!;
      const path = confirmPathFor('music', { ...result, source: 'discogs' }, { searchType: 'vinyl' });
      const query = Object.fromEntries(new URL(path, 'http://x').searchParams);
      const details: any = await new DiscogsProvider().getDetails(result.id, query);
      assert.equal(details.media_type, 'cd');
    });
  });

  it('still follows the picked format for a release found by text', async () => {
    await withDiscogs(async () => {
      const details: any = await new DiscogsProvider().getDetails('83182', { type: 'vinyl' });
      assert.equal(details.media_type, 'vinyl');
    });
  });
});
