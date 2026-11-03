import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultTableColumnNames, getTableCell, getTableColumns, sanitizeTableColumns, tableColumnNames } from '../core/cardFields';

const plugin: any = {
  id: 'music',
  creatorField: 'artist',
  defaultCardFields: ['year', 'artist'],
  formFields: [
    { name: 'title', label: 'f.title', type: 'text' },
    { name: 'artist', label: 'f.artist', type: 'text' },
    { name: 'year', label: 'f.year', type: 'text' },
    { name: 'signed', label: 'f.signed', type: 'boolean' },
    { name: 'audio', label: 'f.audio', type: 'select', options: [{ value: 'mono', label: 'audio.mono' }] },
    { name: 'tags', label: 'f.tags', type: 'tags' },
    { name: 'tracks', label: 'f.tracks', type: 'textarea' },
    { name: 'secret', label: 'f.secret', type: 'text', group: 'hidden' },
    { name: 'location', label: 'f.location', type: 'text' }
  ]
};

describe('table columns', () => {
  it('shows what the cards show plus the location until a collection chooses, in the field order', () => {
    assert.deepEqual(defaultTableColumnNames(plugin), ['artist', 'year', 'location']);
    assert.deepEqual(defaultTableColumnNames({ ...plugin, defaultCardFields: ['location'] }), ['location']);
    assert.deepEqual(defaultTableColumnNames({ ...plugin, defaultCardFields: undefined }), ['artist', 'location']);
  });

  it('takes a choice over the default, an empty one included', () => {
    assert.deepEqual(tableColumnNames({ ...plugin, tableColumns: ['audio'] }), ['audio']);
    assert.deepEqual(tableColumnNames({ ...plugin, tableColumns: [] }), []);
  });

  it('drops a field no longer declared, and the location from a share view', () => {
    const chosen = { ...plugin, tableColumns: ['artist', 'gone', 'location'] };
    assert.deepEqual(getTableColumns(chosen).map(c => c.name), ['artist', 'location']);
    assert.deepEqual(getTableColumns(chosen, { isShareView: true }), [{ name: 'artist', label: 'f.artist' }]);
  });

  it('reads a cell from the item or its custom fields, flags a true boolean', () => {
    const cell = (name: string, item: any) => getTableCell(plugin, { name, label: '' }, item);
    assert.deepEqual(cell('artist', { artist: 'Miles' }), { value: 'Miles', translate: false, flag: false });
    assert.deepEqual(cell('year', { extra: { year: 1959 } }), { value: '1959', translate: false, flag: false });
    assert.deepEqual(cell('tags', { tags: ['a', 'b'] }), { value: 'a, b', translate: false, flag: false });
    assert.deepEqual(cell('audio', { audio: 'mono' }), { value: 'audio.mono', translate: true, flag: false });
    assert.equal(cell('signed', { signed: true }).flag, true);
    assert.deepEqual(cell('signed', { signed: false }), { value: '', translate: false, flag: false });
    assert.equal(cell('artist', {}).value, '');
  });

  it('stores a choice in the field order, limited to what the type offers', () => {
    const none: string[][] = [];
    assert.deepEqual(sanitizeTableColumns(plugin, ['location', 'audio', 'secret', 'tracks', 'title', '$where', 3], none), ['audio', 'location']);
    assert.deepEqual(sanitizeTableColumns(plugin, [], none), []);
  });

  it('stores nothing for boxes left as they opened, so the table keeps following the cards', () => {
    const before = ['artist', 'location'];
    const after = ['year', 'location'];
    assert.equal(sanitizeTableColumns(plugin, before, [before, after]), undefined);
    assert.equal(sanitizeTableColumns(plugin, after, [before, after]), undefined);
    assert.deepEqual(sanitizeTableColumns(plugin, ['audio'], [before, after]), ['audio']);
    assert.deepEqual(sanitizeTableColumns(plugin, [], [before, after]), [], 'title only is a choice');
  });
});
