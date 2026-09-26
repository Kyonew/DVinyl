import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../core/markdown';

test('escapes whatever markup the author typed', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('links web, mail and instance addresses', () => {
  assert.match(renderMarkdown('[a](https://example.com)'), /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">a<\/a>/);
  assert.match(renderMarkdown('[a](mailto:me@example.com)'), /<a href="mailto:me@example\.com">a<\/a>/);
  assert.match(renderMarkdown('[a](/collection)'), /<a href="\/collection">a<\/a>/);
});

test('keeps the text of a link that would leave the instance or run code', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example']) {
    assert.doesNotMatch(renderMarkdown(`[a](${url})`), /<a /, url);
  }
});
