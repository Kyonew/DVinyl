import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaTypeOfFormat, physicalFrom, physicalFromDiscogs, wordsOf } from '../plugins/music/formatDetails';
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
  assert.deepEqual(physicalFrom(wordsOf('Vinyl, LP, Album', 'Blue')), { release_type: 'LP', disc_size: '12"', speed: '33 ⅓ RPM' }, 'a vinyl LP is 12" at 33 ⅓ (#232)');
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

test('an LP naming no size or speed is 12" at 33 ⅓, a size or speed given wins (#232)', () => {
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'] }),
    { disc_size: '12"', speed: '33 ⅓ RPM', release_type: 'LP', disc_count: 1 });
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', descriptions: ['10"', 'LP'] }),
    { disc_size: '10"', speed: '33 ⅓ RPM', release_type: 'LP' });
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', descriptions: ['LP', '45 RPM'] }),
    { disc_size: '12"', speed: '45 RPM', release_type: 'LP' });
  // A Discogs CSV line names no medium, and still reads as a vinyl.
  assert.deepEqual(physicalFrom(wordsOf('LP, Album')), { release_type: 'LP', disc_size: '12"', speed: '33 ⅓ RPM' });
  assert.deepEqual(physicalFrom(wordsOf('CD, LP')), { release_type: 'LP' }, 'only a vinyl');
  assert.deepEqual(physicalFromDiscogs({ name: 'Vinyl', descriptions: ['Album'] }), { release_type: 'Album' }, 'no LP, nothing assumed');
});

test('the media type comes from the Discogs format name (#232)', () => {
  assert.equal(mediaTypeOfFormat('File'), 'digital');
  assert.equal(mediaTypeOfFormat('CD'), 'cd');
  assert.equal(mediaTypeOfFormat('CDr'), 'cd');
  assert.equal(mediaTypeOfFormat('Hybrid'), 'cd');
  assert.equal(mediaTypeOfFormat('Cassette'), 'cassette');
  assert.equal(mediaTypeOfFormat('Cass'), 'cassette');
  assert.equal(mediaTypeOfFormat('Vinyl'), 'vinyl');
  assert.equal(mediaTypeOfFormat('Box Set'), 'vinyl');
  assert.equal(mediaTypeOfFormat(undefined), 'vinyl');
});
