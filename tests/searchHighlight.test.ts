import assert from 'node:assert/strict';
import test from 'node:test';
import { highlightMatches } from '../core/searchHighlight';

const marked = (s: string) => s.replace(/<mark class="[^"]*">/g, '[').replace(/<\/mark>/g, ']');

test('marks every occurrence, ignoring case, keeping the original casing', () => {
  assert.equal(marked(highlightMatches('Lord of the Rings', 'lord o')), '[Lord o]f the Rings');
  assert.equal(marked(highlightMatches('Abba abba', 'ABBA')), '[Abba] [abba]');
});

test('escapes the text and the matched part alike', () => {
  assert.equal(marked(highlightMatches('<b>Tom & Jerry</b>', '& j')), '&lt;b&gt;Tom [&amp; J]erry&lt;/b&gt;');
  assert.equal(highlightMatches('<script>', ''), '&lt;script&gt;');
});

test('treats the query as plain text, not a pattern', () => {
  assert.equal(marked(highlightMatches('What? (Live)', '(live)')), 'What? [(Live)]');
  assert.equal(marked(highlightMatches('a.b axb', 'a.b')), '[a.b] axb');
});

test('prints nothing for missing text and leaves text alone without a query', () => {
  assert.equal(highlightMatches(null, 'x'), '');
  assert.equal(highlightMatches(undefined, undefined), '');
  assert.equal(highlightMatches(1994, '99'), '1<mark class="bg-primary-theme/25 text-inherit rounded-sm">99</mark>4');
  assert.equal(highlightMatches('Abbey Road', '   '), 'Abbey Road');
});
