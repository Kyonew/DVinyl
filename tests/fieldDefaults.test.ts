import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeFieldDefault, withFieldDefaults } from '../core/fieldDefaults';
import { FieldDefinition } from '../core/types';

describe('field defaults', () => {
  it('keeps what each type can hold and drops the rest', () => {
    assert.equal(sanitizeFieldDefault('text', '  Shelf A '), 'Shelf A');
    assert.equal(sanitizeFieldDefault('text', '   '), undefined);
    assert.equal(sanitizeFieldDefault('number', '1'), 1);
    assert.equal(sanitizeFieldDefault('number', '2,5'), 2.5);
    assert.equal(sanitizeFieldDefault('number', 'abc'), undefined);
    assert.equal(sanitizeFieldDefault('date', '2026-11-10'), '2026-11-10');
    assert.equal(sanitizeFieldDefault('date', '10/11/2026'), undefined);
    assert.deepEqual(sanitizeFieldDefault('tags', 'a, b, a,'), ['a', 'b']);
    assert.equal(sanitizeFieldDefault('boolean', true), true);
    assert.equal(sanitizeFieldDefault('boolean', false), undefined);
    assert.equal(sanitizeFieldDefault('rows', 'x'), undefined);
  });

  it('stores a list default as the key of the option named', () => {
    const options = [{ value: 'very_good', label: 'Very good' }, { value: 'mint', label: 'Mint' }];
    assert.equal(sanitizeFieldDefault('select', 'very good', options), 'very_good');
    assert.equal(sanitizeFieldDefault('select', 'mint', options), 'mint');
    assert.equal(sanitizeFieldDefault('select', 'Poor', options), undefined);
  });

  it('fills only the empty added fields of a new item', () => {
    const fields: FieldDefinition[] = [
      { name: 'qty', label: 'Qty', type: 'number', showIn: ['manual'], extraField: true, default: 1 },
      { name: 'cond', label: 'Cond', type: 'text', showIn: ['manual'], extraField: true, default: 'NM' },
      { name: 'boxed', label: 'Boxed', type: 'boolean', showIn: ['manual'], extraField: true, default: true },
      { name: 'tags', label: 'Tags', type: 'tags', showIn: ['manual'], extraField: true, default: ['x'] },
      { name: 'format', label: 'Format', type: 'select', showIn: ['manual'], default: 'cd' }
    ];
    const out = withFieldDefaults(fields, { cond: 'VG', boxed: false, tags: [], format: '' });
    assert.equal(out.qty, 1);
    assert.equal(out.cond, 'VG');
    assert.equal(out.boxed, true);
    assert.deepEqual(out.tags, ['x']);
    // A plugin's own field keeps what the plugin chose.
    assert.equal(out.format, '');
    // The default is copied, never shared with the definition.
    out.tags.push('y');
    assert.deepEqual(fields[3]!.default, ['x']);
  });
});
