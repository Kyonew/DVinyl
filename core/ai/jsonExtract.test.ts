import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonArray, extractJsonObject } from './jsonExtract';

test('parses a bare JSON array', () => {
  assert.deepEqual(extractJsonArray('[{"title":"Dune"}]'), [{ title: 'Dune' }]);
});

test('parses an array inside a fenced code block', () => {
  const text = 'Here you go:\n```json\n[{"title":"Dune","author":"Herbert"}]\n```\nHope that helps!';
  assert.deepEqual(extractJsonArray(text), [{ title: 'Dune', author: 'Herbert' }]);
});

test('parses an array surrounded by prose without any fence', () => {
  const text = 'I found one book. [{"title":"Dune"}] Let me know if you need more.';
  assert.deepEqual(extractJsonArray(text), [{ title: 'Dune' }]);
});

test('handles brackets inside string values', () => {
  const text = '[{"title":"Brackets [not json] here"}]';
  assert.deepEqual(extractJsonArray(text), [{ title: 'Brackets [not json] here' }]);
});

test('handles escaped quotes inside string values', () => {
  const text = '[{"title":"He said \\"hi\\""}]';
  assert.deepEqual(extractJsonArray(text), [{ title: 'He said "hi"' }]);
});

test('wraps a single object into a one-element array', () => {
  assert.deepEqual(extractJsonArray('{"title":"Dune"}'), [{ title: 'Dune' }]);
});

test('unwraps a common {"items": [...]} envelope', () => {
  assert.deepEqual(extractJsonArray('{"items":[{"title":"Dune"}]}'), [{ title: 'Dune' }]);
});

test('drops non-object entries', () => {
  assert.deepEqual(extractJsonArray('[{"title":"Dune"}, "junk", 42, null]'), [{ title: 'Dune' }]);
});

test('returns an empty array for unparseable or empty text', () => {
  assert.deepEqual(extractJsonArray('I could not identify this item.'), []);
  assert.deepEqual(extractJsonArray(''), []);
  assert.deepEqual(extractJsonArray('[{"title": unterminated'), []);
});

test('extractJsonObject finds a fenced object and returns null on failure', () => {
  assert.deepEqual(extractJsonObject('```json\n{"title":"Dune","year":"1965"}\n```'), { title: 'Dune', year: '1965' });
  assert.equal(extractJsonObject('nothing here'), null);
});
