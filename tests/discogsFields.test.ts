import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscogsFieldMapper, addedDate, asNewItemFields, missingValues, ratingValues } from '../plugins/music/discogsFields';
import { ExtraFieldConfig, MAX_EXTRA_FIELDS_PER_PLUGIN } from '../core/pluginExtraFields';

const plugin: any = { id: 'music', kind: 'Music', creatorField: 'artist', formFields: [], storedFields: {} };

// As the API answers, read off a real collection.
const fields = [
  { id: 4, name: 'Hello', type: 'textarea' },
  { id: 1, name: 'Media Condition', type: 'dropdown', options: ['Mint (M)', 'Near Mint (NM or M-)'] },
  { id: 2, name: 'Sleeve Condition', type: 'dropdown', options: ['Generic', 'No Cover', 'Mint (M)'] },
  { id: 3, name: 'Notes', type: 'textarea' }
];

describe('Discogs custom fields', () => {
  it('sends the stock fields home and creates the others', () => {
    const mapper = new DiscogsFieldMapper(plugin, [], fields);
    const values = mapper.valuesFor([
      { field_id: 1, value: 'Near Mint (NM or M-)' },
      { field_id: 2, value: 'Mint (M)' },
      { field_id: 3, value: 'A word' },
      { field_id: 4, value: 'Test' }
    ]);
    assert.equal(values.sleeve_condition, 'M');
    assert.equal(values.comments, 'A word');
    assert.equal(mapper.changed, true);
    assert.equal(mapper.defs.length, 2);
    const media = mapper.defs.find(d => d.label === 'Media Condition')!;
    assert.equal(media.type, 'select');
    assert.equal(values[`extra.${media.name}`], media.options!.find(o => o.label === 'Near Mint (NM or M-)')!.value);
    assert.equal(values[`extra.${mapper.defs.find(d => d.label === 'Hello')!.name}`], 'Test');
  });

  it('creates nothing for a field no record fills', () => {
    const mapper = new DiscogsFieldMapper(plugin, [], fields);
    assert.deepEqual(mapper.valuesFor(undefined), {});
    assert.deepEqual(mapper.valuesFor([{ field_id: 4, value: '  ' }]), {});
    assert.equal(mapper.defs.length, 0);
    assert.equal(mapper.changed, false);
  });

  it('keeps a grade DVinyl has no entry for', () => {
    const mapper = new DiscogsFieldMapper(plugin, [], fields);
    assert.equal(mapper.valuesFor([{ field_id: 2, value: 'No Cover' }]).sleeve_condition, 'No Cover');
  });

  it('finds its field again once renamed, and adopts one of the same name', () => {
    const first = new DiscogsFieldMapper(plugin, [], fields);
    first.valuesFor([{ field_id: 4, value: 'x' }]);
    const renamed = first.defs.map(d => ({ ...d, label: 'Renamed' }));
    const second = new DiscogsFieldMapper(plugin, renamed, fields);
    const values = second.valuesFor([{ field_id: 4, value: 'y' }]);
    assert.equal(second.defs.length, 1);
    assert.equal(second.changed, false);
    assert.equal(values[`extra.${renamed[0]!.name}`], 'y');

    const own: ExtraFieldConfig[] = [{ name: 'custom_aaaaaaaaaaaa', label: 'hello', type: 'text' }];
    const third = new DiscogsFieldMapper(plugin, own, fields);
    assert.equal(third.valuesFor([{ field_id: 4, value: 'z' }])['extra.custom_aaaaaaaaaaaa'], 'z');
    assert.equal(third.defs.length, 1);
    assert.equal(third.defs[0]!.importKey, 'discogs:4');
  });

  it('reports what does not fit under the limit', () => {
    const full: ExtraFieldConfig[] = Array.from({ length: MAX_EXTRA_FIELDS_PER_PLUGIN }, (_, i) => ({
      name: `custom_00000000000${i.toString(16)}`, label: `F${i}`, type: 'text'
    }));
    const mapper = new DiscogsFieldMapper(plugin, full, fields);
    assert.deepEqual(mapper.valuesFor([{ field_id: 4, value: 'x' }]), {});
    assert.deepEqual([...mapper.leftOut], ['Hello']);
  });

  it('never replaces what an item holds', () => {
    const item = { comments: 'mine', sleeve_condition: '', extra: { custom_a: 'kept' } };
    assert.deepEqual(
      missingValues(item, { comments: 'theirs', sleeve_condition: 'M', 'extra.custom_a': 'theirs', 'extra.custom_b': 'new' }),
      { sleeve_condition: 'M', 'extra.custom_b': 'new', import_filled: ['sleeve_condition', 'extra.custom_b'] }
    );
  });

  it('does not bring back what was emptied after an import', () => {
    const item = { comments: '', user_rating: 0, import_filled: ['comments', 'user_rating'] };
    assert.deepEqual(missingValues(item, { comments: 'theirs', user_rating: 4 }), {});
  });

  it('fills a value Discogs gained since the last import', () => {
    const item = { comments: 'kept', import_filled: ['comments'] };
    assert.deepEqual(missingValues(item, { comments: 'x', user_rating: 3 }), { user_rating: 3, import_filled: ['comments', 'user_rating'] });
  });

  it('reads a rating only when there is one', () => {
    assert.deepEqual(ratingValues(4), { user_rating: 4 });
    assert.deepEqual(ratingValues(0), {});
    assert.deepEqual(ratingValues(undefined), {});
    assert.deepEqual(ratingValues(9), {});
  });

  it('dates a new item from Discogs, or now', () => {
    assert.equal(addedDate('2026-05-17T07:22:15-07:00').toISOString(), '2026-05-17T14:22:15.000Z');
    assert.ok(Date.now() - addedDate('nonsense').getTime() < 5000);
  });

  it('shapes the values of a new item', () => {
    assert.deepEqual(asNewItemFields({ comments: 'a', 'extra.custom_a': 'b' }), { comments: 'a', extra: { custom_a: 'b' }, import_filled: ['comments', 'extra.custom_a'] });
    assert.deepEqual(asNewItemFields({}), {});
  });
});
