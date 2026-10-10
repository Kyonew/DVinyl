import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFields, buildExtractionMessages } from './prompt';
import { ImportTargetField } from '../csvMapping';
import { AiContentPart } from './types';

const fields: ImportTargetField[] = [
  { name: 'title', label: 'Title', type: 'text', required: true, group: 'plugin' },
  { name: 'author', label: 'Author', type: 'text', required: true, group: 'plugin' },
  { name: 'pages', label: 'Pages', type: 'number', required: false, group: 'plugin' },
  {
    name: 'format', label: 'Format', type: 'select', required: false, group: 'plugin',
    options: [
      { value: 'paperback', label: 'Paperback' },
      { value: 'hardcover', label: 'Hardcover' }
    ]
  }
];

test('every field name appears with its type', () => {
  const described = describeFields(fields);
  for (const name of ['title', 'author', 'pages', 'format']) {
    assert.match(described, new RegExp(name), `missing ${name}`);
  }
  assert.match(described, /number/);
});

test('required fields are marked', () => {
  const described = describeFields(fields);
  const titleLine = described.split('\n').find(l => l.startsWith('- title'));
  const pagesLine = described.split('\n').find(l => l.startsWith('- pages'));
  assert.match(String(titleLine), /required/i);
  assert.doesNotMatch(String(pagesLine), /required/i);
});

test('a select lists its allowed values on its own line', () => {
  const formatLine = describeFields(fields).split('\n').find(l => l.startsWith('- format'));
  assert.match(String(formatLine), /one of: paperback, hardcover/);
});

test('the messages demand a JSON array and forbid invention', () => {
  const messages = buildExtractionMessages(fields, 'Extract the books.', [{ type: 'text', text: 'Dune by Frank Herbert' }]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  const system = String(messages[0]?.content);
  assert.match(system, /JSON array/i);
  assert.match(system, /title/);
  assert.match(system, /empty string/i);
});

test('the user message carries the instruction then the given content parts', () => {
  const parts: AiContentPart[] = [
    { type: 'text', text: 'look at this' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }
  ];
  const messages = buildExtractionMessages(fields, 'Extract.', parts);
  const content = messages[1]?.content;
  assert.ok(Array.isArray(content));
  assert.equal((content as AiContentPart[]).length, 3, 'instruction plus both parts');
  assert.deepEqual((content as AiContentPart[])[0], { type: 'text', text: 'Extract.' });
  assert.equal((content as AiContentPart[])[2]?.type, 'image_url');
});
