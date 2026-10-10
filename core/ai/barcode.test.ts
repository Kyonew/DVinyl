import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBarcodePrompt, parseBarcodeReply } from './barcode';

test('the prompt carries the code and the media kind, and demands JSON', () => {
  const messages = buildBarcodePrompt('9782266283321', 'book');
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[1]?.role, 'user');
  const all = JSON.stringify(messages);
  assert.match(all, /9782266283321/);
  assert.match(all, /book/i);
  assert.match(all, /JSON/i);
  assert.match(all, /confidence/i);
});

test('parses a confident reply', () => {
  const guess = parseBarcodeReply('{"title":"Dune","creator":"Frank Herbert","year":"1965","confidence":0.9}');
  assert.equal(guess?.title, 'Dune');
  assert.equal(guess?.creator, 'Frank Herbert');
  assert.equal(guess?.year, '1965');
  assert.equal(guess?.confidence, 0.9);
});

test('parses a fenced reply', () => {
  const guess = parseBarcodeReply('```json\n{"title":"Dune","confidence":0.8}\n```');
  assert.equal(guess?.title, 'Dune');
  assert.equal(guess?.creator, '');
});

test('returns null when the model declines or is unsure', () => {
  assert.equal(parseBarcodeReply('{"title":"","confidence":0.9}'), null);
  assert.equal(parseBarcodeReply('{"title":"Dune","confidence":0.2}'), null);
  assert.equal(parseBarcodeReply('I do not know that barcode.'), null);
  assert.equal(parseBarcodeReply(''), null);
});

test('a missing confidence is treated as too low to act on', () => {
  assert.equal(parseBarcodeReply('{"title":"Dune"}'), null);
});

test('coerces a numeric-string confidence', () => {
  assert.equal(parseBarcodeReply('{"title":"Dune","confidence":"0.9"}')?.confidence, 0.9);
});
