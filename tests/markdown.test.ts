import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLinks, renderMarkdown } from '../core/markdown';

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

// What renderLinks puts on every link it builds.
const CLS = 'text-primary-theme underline underline-offset-2 break-all';
const link = (href: string, text = href) => `<a href="${href}" class="${CLS}" target="_blank" rel="noopener noreferrer">${text}</a>`;

test('a field keeps its text and only gains its links (#233)', () => {
  assert.equal(renderLinks('Scrobble: https://openscrobbler.com/scrobble-album/x'), 'Scrobble: ' + link('https://openscrobbler.com/scrobble-album/x'));
  assert.equal(renderLinks('[Open Scrobbler](https://openscrobbler.com/a)'), link('https://openscrobbler.com/a', 'Open Scrobbler'));
  assert.equal(renderLinks('See https://example.com/a.'), 'See ' + link('https://example.com/a') + '.', 'the full stop stays outside');
  assert.equal(renderLinks('(see https://example.com/a)'), '(see ' + link('https://example.com/a') + ')', 'a bracket it did not open stays outside');
  assert.equal(renderLinks('https://en.wikipedia.org/wiki/Foo_(bar)'), link('https://en.wikipedia.org/wiki/Foo_(bar)'), 'a bracket it opened stays in');
  assert.equal(renderLinks('*not bold* **nor this**'), '*not bold* **nor this**', 'no other Markdown');
  assert.equal(renderLinks('a\nhttps://x.org\nb'), 'a\n' + link('https://x.org') + '\nb', 'lines are kept');
  assert.equal(renderLinks(''), '');
  assert.equal(renderLinks(null), '');
  assert.equal(renderLinks(33), '33');
});

test('a field can never carry markup or a dangerous link (#233)', () => {
  assert.equal(renderLinks('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(renderLinks('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(renderLinks('[x](//evil.com)'), '[x](//evil.com)');
  assert.equal(renderLinks('[<b>x</b>](https://a.com)'), link('https://a.com', '&lt;b&gt;x&lt;/b&gt;'));
  assert.equal(renderLinks('https://a.com/"onmouseover="alert(1)'), link('https://a.com/') + '&quot;onmouseover=&quot;alert(1)');
  assert.equal(renderLinks("https://a.com/'x"), link('https://a.com/') + '&#39;x');
  assert.equal(renderLinks('https://a.com?x=1&y=2'), link('https://a.com?x=1&amp;y=2'));
  assert.equal(renderLinks('https://a.com?x=1&'), link('https://a.com?x=1&amp;'), 'an escaped ampersand keeps its semicolon');
});
