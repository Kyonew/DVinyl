import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BulkValueError, bulkFieldsOf, bulkValueFor, sharedBulkFields, storedPath, tagsFor } from '../core/bulkEdit';
import { FieldDefinition, PluginDefinition } from '../core/types';

const field = (name: string, type: FieldDefinition['type'], extra: Partial<FieldDefinition> = {}): FieldDefinition =>
  ({ name, label: name, type, showIn: ['edit', 'detail'], ...extra });

const plugin = (id: string, formFields: FieldDefinition[]): PluginDefinition =>
  ({ id, kind: id, creatorField: 'artist', externalIdField: 'discogs_id', formFields } as any);

describe('bulk edit', () => {
  it('offers the plain fields of a plugin, not those that say which item it is', () => {
    const p = plugin('music', [
      field('title', 'text'), field('artist', 'text'), field('discogs_id', 'text'), field('location', 'text'),
      field('genres', 'tags'), field('condition', 'select', { options: [{ value: 'm', label: 'M' }] }),
      field('tracklist', 'custom'), field('notes', 'text', { partial: 'x' }), field('qty', 'number', { showIn: ['detail'] })
    ]);
    assert.deepEqual(bulkFieldsOf(p).map(f => f.name), ['genres', 'condition']);
  });

  it('offers a mixed selection only the fields its types have alike', () => {
    const a = plugin('a', [field('genres', 'tags'), field('format', 'select', { options: [{ value: 'cd', label: 'CD' }] }), field('year', 'number')]);
    const b = plugin('b', [field('year', 'number'), field('format', 'select', { options: [{ value: 'dvd', label: 'DVD' }] }), field('genres', 'tags')]);
    assert.deepEqual(sharedBulkFields([a, b]).map(f => f.name), ['genres', 'year']);
  });

  it('reads the posted value as the field holds it', () => {
    assert.equal(bulkValueFor(field('year', 'number'), '1986'), 1986);
    assert.equal(bulkValueFor(field('year', 'number'), ''), null);
    assert.throws(() => bulkValueFor(field('year', 'number'), 'abc'), BulkValueError);
    assert.throws(() => bulkValueFor(field('name', 'text', { required: true }), ' '), BulkValueError);
    assert.equal(bulkValueFor(field('rating', 'rating'), '9'), 5);
    assert.equal(bulkValueFor(field('boxed', 'boolean'), 'false'), false);
    assert.equal((bulkValueFor(field('on', 'date'), '2026-11-10') as Date).toISOString(), '2026-11-10T00:00:00.000Z');
    const select = field('c', 'select', { options: [{ value: 'm', label: 'M' }] });
    assert.equal(bulkValueFor(select, 'm'), 'm');
    assert.throws(() => bulkValueFor(select, 'x'), BulkValueError);
    assert.deepEqual(bulkValueFor(field('g', 'tags'), 'Rock, Jazz, Rock'), ['Rock', 'Jazz']);
  });

  it('adds, removes or replaces tags item by item', () => {
    assert.deepEqual(tagsFor(['Rock', 'Pop'], ['rock', 'Jazz'], 'add'), ['Rock', 'Pop', 'Jazz']);
    assert.deepEqual(tagsFor(['Rock', 'Pop'], ['rock'], 'remove'), ['Pop']);
    assert.deepEqual(tagsFor(['Rock'], ['Jazz'], 'replace'), ['Jazz']);
    assert.deepEqual(tagsFor(undefined, ['Jazz'], 'add'), ['Jazz']);
  });

  it('writes an added field under extra', () => {
    assert.equal(storedPath(field('x_1', 'text', { extraField: true })), 'extra.x_1');
    assert.equal(storedPath(field('genres', 'tags')), 'genres');
  });
});
