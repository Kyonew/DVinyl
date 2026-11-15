import assert from 'node:assert/strict';
import { test } from 'node:test';
import { physicalFrom, physicalFromDiscogs, wordsOf } from '../plugins/music/formatDetails';
import { canonicalQuery, newSavedFilter, savedFiltersOf } from '../core/savedFilters';

test('reads size, speed, release type and disc count off Discogs format words', () => {
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', qty: '2', descriptions: ['12"', '33 ⅓ RPM', 'LP', 'Album', 'Compilation'] }),
    { disc_size: '12"', speed: '33 ⅓ RPM', release_type: 'LP', disc_count: 2 });
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', qty: '1', descriptions: ['7"', '45 RPM', 'Single', 'Album'] }),
    { disc_size: '7"', speed: '45 RPM', release_type: 'Single', disc_count: 1 });
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', descriptions: ["10''", '33 1/3 rpm', 'EP'], text: 'Blue' }),
    { disc_size: '10"', speed: '33 ⅓ RPM', release_type: 'EP' });
  assert.deepEqual(physicalFromDiscogs(undefined), {});
});

test('reads the same off the lines an older item stores, guessing nothing', () => {
  assert.deepEqual(physicalFrom(wordsOf('Vinyl, LP, Album', 'Blue')), { release_type: 'LP' }, 'an LP is not assumed to be 12"');
  assert.deepEqual(physicalFrom(wordsOf('2xVinyl, 12"', '45 RPM, Red')), { disc_size: '12"', speed: '45 RPM', disc_count: 2 });
  assert.deepEqual(physicalFrom(wordsOf('', '')), {});
});

test('a saved view is the page query in one spelling', () => {
  assert.equal(canonicalQuery('?type=music&nf_speed=45+RPM&page=3&search='), 'nf_speed=45+RPM&type=music');
  assert.equal(canonicalQuery({ type: 'music', nf_speed: '45 RPM', page: '2' }), canonicalQuery('nf_speed=45%20RPM&type=music'));
  const saved = newSavedFilter('  7" singles  ', '?type=music&nf_disc_size=7%22&page=2') as any;
  assert.equal(saved.name, '7" singles');
  assert.equal(saved.query, 'nf_disc_size=7%22&type=music');
  assert.deepEqual(newSavedFilter('', 'type=music'), { error: 'name_required' });
  assert.deepEqual(newSavedFilter('All', '?page=2'), { error: 'nothing_to_save' });
  assert.deepEqual(savedFiltersOf({ savedFilters: [{ id: 'a', name: 'x', query: 'type=music' }, { name: 'broken' }] }), [{ id: 'a', name: 'x', query: 'type=music' }]);
});
