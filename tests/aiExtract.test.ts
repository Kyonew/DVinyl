import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateRows, extractRows } from '../core/ai/extract';
import { textPart } from '../core/ai/client';
import { AiConfig } from '../core/ai/types';
import { ImportTargetField } from '../core/csvMapping';

const fields: ImportTargetField[] = [
  { name: 'title', label: 'Title', type: 'text', required: true, group: 'plugin' },
  { name: 'author', label: 'Author', type: 'text', required: true, group: 'plugin' },
  { name: 'pages', label: 'Pages', type: 'number', required: false, group: 'plugin' }
];

test('keeps known fields and stringifies their values', () => {
  const rows = validateRows([{ title: 'Dune', author: 'Herbert', pages: 412 }], fields);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.values, { title: 'Dune', author: 'Herbert', pages: '412' });
  assert.deepEqual(rows[0]?.missingRequired, []);
});

test('drops keys the plugin does not accept', () => {
  const rows = validateRows([{ title: 'Dune', author: 'H', nonsense: 'x', __proto__: 'y' }], fields);
  assert.equal(rows[0]?.values.nonsense, undefined);
  assert.deepEqual(Object.keys(rows[0]?.values || {}).sort(), ['author', 'title']);
});

test('reports missing required fields instead of dropping the row', () => {
  const rows = validateRows([{ title: 'Dune' }], fields);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.missingRequired, ['author']);
});

test('treats an empty or whitespace value as missing', () => {
  const rows = validateRows([{ title: 'Dune', author: '   ' }], fields);
  assert.deepEqual(rows[0]?.missingRequired, ['author']);
  assert.equal(rows[0]?.values.author, '');
});

test('skips rows that are entirely empty', () => {
  assert.equal(validateRows([{ title: '', author: '' }, { title: 'Dune', author: 'H' }], fields).length, 1);
});

test('trims values and drops null and undefined', () => {
  const rows = validateRows([{ title: '  Dune  ', author: 'H', pages: null }], fields);
  assert.equal(rows[0]?.values.title, 'Dune');
  assert.equal(rows[0]?.values.pages, undefined);
});

test('flattens an array value into a comma-separated string', () => {
  const withGenres: ImportTargetField[] = [
    ...fields,
    { name: 'genres', label: 'Genres', type: 'tags', required: false, group: 'plugin' }
  ];
  const rows = validateRows([{ title: 'Dune', author: 'H', genres: ['Sci-Fi', 'Classic'] }], withGenres);
  assert.equal(rows[0]?.values.genres, 'Sci-Fi, Classic');
});

test('returns an empty list for an empty input', () => {
  assert.deepEqual(validateRows([], fields), []);
});

test('a quantity of 0 is corrected to 1, not left as a literal zero', () => {
  const withQuantity: ImportTargetField[] = [
    ...fields,
    { name: 'quantity', label: 'Quantity', type: 'number', required: false, group: 'base' }
  ];
  // quantity's schema (models/Item.ts) is min:1 - a literal 0 would fail the save outright.
  const rows = validateRows([{ title: 'Dune', author: 'H', quantity: 0 }], withQuantity);
  assert.equal(rows[0]?.values.quantity, '1');
});

test('a genuine quantity is kept as-is', () => {
  const withQuantity: ImportTargetField[] = [
    ...fields,
    { name: 'quantity', label: 'Quantity', type: 'number', required: false, group: 'base' }
  ];
  const rows = validateRows([{ title: 'Dune', author: 'H', quantity: 3 }], withQuantity);
  assert.equal(rows[0]?.values.quantity, '3');
});

test('other number fields keep a literal 0 - only quantity is special-cased', () => {
  const rows = validateRows([{ title: 'Dune', author: 'H', pages: 0 }], fields);
  assert.equal(rows[0]?.values.pages, '0');
});

describe('extractRows', () => {
  const config: AiConfig = {
    enabled: true, provider: 'openai', baseUrl: 'https://api.test/v1',
    model: 'test-model', visionModel: 'test-vision', apiKey: 'sk-test', fromEnv: false
  };
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; });

  /** Answers each call with the next reply in the list and counts the calls. */
  function stubReplies(replies: { content: any; finish_reason?: string }[]) {
    const seen = { calls: 0 };
    console.warn = () => {};
    globalThis.fetch = (async () => {
      const reply = replies[Math.min(seen.calls++, replies.length - 1)]!;
      const body = { model: 'test-model', choices: [{ message: { content: reply.content }, finish_reason: reply.finish_reason ?? 'stop' }] };
      return { ok: true, status: 200, json: async () => body } as any;
    }) as any;
    return seen;
  }

  test('asks once more when the first reply has nothing usable', async () => {
    const seen = stubReplies([{ content: '' }, { content: '[{"title":"Alien"}]' }]);
    const rows = await extractRows(config, fields, 'list', [textPart('Alien')]);
    assert.equal(seen.calls, 2);
    assert.equal(rows[0]?.values.title, 'Alien');
  });

  test('a first reply with rows is not asked twice', async () => {
    const seen = stubReplies([{ content: '[{"title":"Alien"}]' }]);
    await extractRows(config, fields, 'list', [textPart('Alien')]);
    assert.equal(seen.calls, 1);
  });

  test('gives up after the second empty reply', async () => {
    const seen = stubReplies([{ content: 'Sorry.' }]);
    const rows = await extractRows(config, fields, 'list', [textPart('Alien')]);
    assert.equal(seen.calls, 2);
    assert.deepEqual(rows, []);
  });

  test('a reply cut by the token cap is not asked again', async () => {
    const seen = stubReplies([{ content: '[{"title":"Ali', finish_reason: 'length' }]);
    const rows = await extractRows(config, fields, 'list', [textPart('Alien')]);
    assert.equal(seen.calls, 1);
    assert.deepEqual(rows, []);
  });

  test('no retry when too little of the timeout is left for one', async () => {
    const seen = stubReplies([{ content: '' }, { content: '[{"title":"Alien"}]' }]);
    const rows = await extractRows(config, fields, 'list', [textPart('Alien')], { timeoutMs: 5000 });
    assert.equal(seen.calls, 1);
    assert.deepEqual(rows, []);
  });
});
