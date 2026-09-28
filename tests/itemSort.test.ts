import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemSort } from '../core/itemSort';
import { PluginDefinition } from '../core/types';

const plugin = {
  creatorField: 'author',
  sortOptions: [{ key: 'series', label: 'x', fields: ['series', 'volume'] }]
} as unknown as PluginDefinition;

const bare = { creatorField: 'author' } as unknown as PluginDefinition;

describe('resolveItemSort', () => {
  test('maps the built-in keys in both directions', () => {
    assert.deepEqual(resolveItemSort('added_desc'), { added_at: -1 });
    assert.deepEqual(resolveItemSort('added_asc'), { added_at: 1 });
    assert.deepEqual(resolveItemSort('title_asc'), { sort_title: 1, title: 1 });
    assert.deepEqual(resolveItemSort('title_desc'), { sort_title: -1, title: -1 });
    assert.deepEqual(resolveItemSort('year_desc'), { year: -1 });
    assert.deepEqual(resolveItemSort('year_asc'), { year: 1 });
  });

  test('maps artist onto the plugin creator field, or the title when the caller allows it', () => {
    assert.deepEqual(resolveItemSort('artist_asc', plugin), { author: 1 });
    assert.deepEqual(resolveItemSort('artist_desc', plugin), { author: -1 });
    // Without a selected type there is no creator field to name.
    assert.equal(resolveItemSort('artist_asc'), null);
    assert.deepEqual(
      resolveItemSort('artist_asc', undefined, { artistFallbackToTitle: true }),
      { sort_title: 1, title: 1 }
    );
  });

  test('expands a plugin sort option and ties it on the title', () => {
    assert.deepEqual(resolveItemSort('series_desc', plugin), { series: -1, volume: -1, sort_title: -1, title: -1 });
    // The option belongs to the plugin that declares it.
    assert.equal(resolveItemSort('series_asc', bare), null);
    assert.equal(resolveItemSort('series_asc'), null);
  });

  test('returns null for values outside the vocabulary', () => {
    assert.equal(resolveItemSort(undefined), null);
    assert.equal(resolveItemSort(null), null);
    assert.equal(resolveItemSort(''), null);
    assert.equal(resolveItemSort('title'), null);
    assert.equal(resolveItemSort('ghost_desc'), null);
  });
});
