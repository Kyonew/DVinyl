import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterCandidates,
  filterOverrides,
  activeFilters,
  sanitizeFilterSelection,
  CORE_FILTER_IDS
} from '../core/filterFields';
import { buildExtraFieldConditions, filterParam } from '../core/pluginExtraFields';

const books: any = {
  id: 'books',
  kind: 'Book',
  creatorField: 'author',
  externalIdField: 'isbn',
  schemaDefinition: {
    author: String,
    readingStatus: { type: String, enum: ['to_read', 'reading', 'read'], default: 'to_read' }
  },
  formFields: [
    { name: 'author', label: 'confirm_book.field_author', type: 'text', showIn: ['edit'] },
    {
      name: 'format', label: 'confirm_book.field_format', type: 'select', showIn: ['edit'],
      options: [{ value: '', label: '-' }, { value: 'paperback', label: 'media.paperback' }]
    },
    {
      name: 'readingStatus', label: 'confirm_book.field_status', type: 'select', showIn: ['edit'],
      options: [
        { value: 'to_read', label: 'status.to_read' },
        { value: 'reading', label: 'status.reading' },
        { value: 'read', label: 'status.read' }
      ]
    },
    { name: 'signed', label: 'Signed', type: 'boolean', showIn: ['edit'] },
    { name: 'notes', label: 'Notes', type: 'textarea', showIn: ['edit'] }
  ]
};

const extraDefs: any[] = [
  { name: 'custom_0123456789ab', label: 'Loaned to', type: 'text' },
  { name: 'custom_ba9876543210', label: 'Review', type: 'textarea' }
];

test('candidates list core controls, fixed-value plugin fields and filterable user fields', () => {
  const ids = filterCandidates(books, extraDefs).map(c => c.id);
  assert.deepEqual(ids, [
    CORE_FILTER_IDS.decade,
    CORE_FILTER_IDS.genre,
    CORE_FILTER_IDS.creator,
    'readingStatus',
    'signed',
    'custom_0123456789ab'
  ]);
});

test('the creator control takes the plugin wording', () => {
  const creator = filterCandidates(books, []).find(c => c.id === CORE_FILTER_IDS.creator);
  assert.equal(creator?.label, 'confirm_book.field_author');
});

test('without overrides, plugin fields stay off and everything else stays on', () => {
  const candidates = filterCandidates(books, extraDefs);
  const on = activeFilters(candidates, filterOverrides({}, 'books')).map(c => c.id);
  assert.ok(!on.includes('readingStatus'));
  assert.ok(on.includes(CORE_FILTER_IDS.genre));
  assert.ok(on.includes('custom_0123456789ab'));
});

test('a submission is stored as its difference from the default', () => {
  const candidates = filterCandidates(books, extraDefs);
  const submitted = candidates
    .filter(c => c.defaultOn && c.id !== CORE_FILTER_IDS.genre)
    .map(c => c.id)
    .concat(['readingStatus', 'title', '$where', 42 as any]);
  const stored = sanitizeFilterSelection(candidates, submitted);
  assert.deepEqual(stored, { [CORE_FILTER_IDS.genre]: false, readingStatus: true });

  const on = activeFilters(candidates, filterOverrides({ books: { filters: stored } }, 'books')).map(c => c.id);
  assert.ok(on.includes('readingStatus'));
  assert.ok(!on.includes(CORE_FILTER_IDS.genre));
});

test('a plugin field filters on its own path, and its default also matches unset items', () => {
  const status = filterCandidates(books, [])
    .find(c => c.id === 'readingStatus')!.field!;
  assert.equal(filterParam(status), 'nf_readingStatus');

  assert.deepEqual(
    buildExtraFieldConditions([status], { nf_readingStatus: 'to_read' }),
    [{ readingStatus: { $in: ['to_read', null, ''] } }]
  );
  assert.deepEqual(
    buildExtraFieldConditions([status], { nf_readingStatus: 'read' }),
    [{ readingStatus: 'read' }]
  );
  // A repeated param arrives as an array and is ignored rather than passed to Mongo
  assert.deepEqual(buildExtraFieldConditions([status], { nf_readingStatus: ['read', 'reading'] }), []);
});

test('a user-defined field keeps its extra path and param', () => {
  const field = extraDefs[0];
  assert.equal(filterParam(field), 'xf_custom_0123456789ab');
  assert.deepEqual(
    buildExtraFieldConditions([field], { xf_custom_0123456789ab: 'Alex' }),
    [{ 'extra.custom_0123456789ab': 'Alex' }]
  );
});
