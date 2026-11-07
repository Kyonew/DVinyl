import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepOwnerValues, offeredSourceValues, sameValue, trackOwnerEdits } from '../core/keptFields';
import { refreshPatchFor } from '../core/sources';

test('a refresh leaves the kept fields alone and notes what the source said', async () => {
  const item = { title: 'Catan', description: 'Mijn eigen tekst', year: '1995', kept_fields: ['description'] };
  const plugin: any = { refreshItem: async () => ({ description: 'English text', year: '1996' }) };
  const patch = await refreshPatchFor(plugin, item);
  assert.deepEqual(patch, { year: '1996', source_values: { description: 'English text' } });
  assert.deepEqual(offeredSourceValues({ ...item, ...patch }), [{ field: 'description', value: 'English text' }]);
  assert.deepEqual(keepOwnerValues({ title: 'x' }, { year: '1' }), { year: '1' }, 'nothing kept, patch untouched');
});

test('an edit marks what changed, ignores round trips and the owner own fields', () => {
  const before = { title: 'Heat', description: 'Line one\nLine two', year: 1995, genres: ['Crime'], location: 'A', comments: '' };
  const after = { ...before, description: 'Line one\r\nLine two', year: '1995', location: 'B', comments: 'mine' };
  assert.equal(trackOwnerEdits(before, after), null);

  const edited = trackOwnerEdits(before, { ...before, description: 'Eigen tekst', title: 'Heat (1995)' });
  assert.deepEqual(edited, { set: { kept_fields: ['description', 'title'] }, unset: ['source_values'] });
});

test('changing a field back to the source value, or handing it back, unkeeps it', () => {
  const before = { description: 'Mine', cover_image: 'a.jpg', kept_fields: ['description', 'cover_image'], source_values: { description: 'Theirs', cover_image: 'b.jpg' } };
  assert.deepEqual(trackOwnerEdits(before, { ...before, description: 'Theirs' }), {
    set: { kept_fields: ['cover_image'], source_values: { cover_image: 'b.jpg' } }, unset: []
  });
  assert.deepEqual(trackOwnerEdits(before, before, ['cover_image', 'unknown']), {
    set: { cover_image: 'b.jpg', kept_fields: ['description'], source_values: { description: 'Theirs' } }, unset: []
  });
  assert.deepEqual(trackOwnerEdits({ ...before, kept_fields: ['description'], source_values: { description: 'Theirs' } }, before, ['description']), {
    set: { description: 'Theirs' }, unset: ['kept_fields', 'source_values']
  });
  assert.ok(sameValue(null, ''));
  assert.ok(!sameValue(['a'], ['b']));
});
