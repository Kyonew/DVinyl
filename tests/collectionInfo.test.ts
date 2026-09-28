import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionInfoPatch,
  isInfoVisibleForMembers,
  EMPTY_COLLECTION_INFO,
  MAX_COLLECTION_INFO_TITLE,
  MAX_COLLECTION_INFO_BODY,
  CollectionInfo
} from '../core/collectionInfo';

/** EMPTY_COLLECTION_INFO with overrides, as the stored shape. */
const info = (over: Partial<CollectionInfo> = {}): CollectionInfo => ({ ...EMPTY_COLLECTION_INFO, ...over });

/** Applies a patch and returns the result, failing loudly if it was refused. */
function patched(current: CollectionInfo, body: any) {
  const result = collectionInfoPatch(current, body);
  assert.equal(result.error, undefined);
  return result.info!;
}

test('only the keys present are applied', () => {
  const next = patched(info({ enabled: true, title: 'Old', body: 'Body', images: [] }), { title: 'New' });
  assert.equal(next.title, 'New');
  assert.equal(next.body, 'Body');
  assert.equal(next.enabled, true);
});

test('an empty body leaves every field alone', () => {
  const current = info({ enabled: true, shareVisible: false, title: 'T', body: 'B', images: ['https://a.example/x.png'] });
  const next = patched(current, {});
  assert.deepEqual(next, {
    enabled: true, shareVisible: false, title: 'T', body: 'B', images: ['https://a.example/x.png']
  });
});

test('a wrong type is refused, not coerced', () => {
  const cases: [any, string][] = [
    [{ enabled: 'yes' }, 'enabled must be a boolean'],
    [{ shareVisible: 1 }, 'shareVisible must be a boolean'],
    [{ title: 5 }, 'title must be a string'],
    [{ body: null }, 'body must be a string'],
    [{ images: 'x' }, 'images must be an array']
  ];
  for (const [body, error] of cases) {
    const result = collectionInfoPatch(info(), body);
    assert.equal(result.error, error);
    assert.equal(result.info, undefined);
  }
});

test('title is trimmed and truncated, body is truncated but not trimmed', () => {
  const longTitle = 'x'.repeat(MAX_COLLECTION_INFO_TITLE + 20);
  const longBody = 'y'.repeat(MAX_COLLECTION_INFO_BODY + 20);
  const next = patched(info(), { title: `  ${longTitle}  `, body: `\n${longBody}` });
  assert.equal((next.title as string).length, MAX_COLLECTION_INFO_TITLE);
  assert.equal(next.title, longTitle.slice(0, MAX_COLLECTION_INFO_TITLE));
  assert.equal((next.body as string).length, MAX_COLLECTION_INFO_BODY);
  assert.equal((next.body as string).startsWith('\n'), true);

  const exact = patched(info(), { title: 'z'.repeat(MAX_COLLECTION_INFO_TITLE) });
  assert.equal((exact.title as string).length, MAX_COLLECTION_INFO_TITLE);
});

test('images are sanitised: junk dropped, duplicates collapsed, capped at six', () => {
  const next = patched(info(), {
    images: [
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '/uploads/../secret.jpg',
      'https://a.example/one.png',
      'https://a.example/one.png',
      'https://a.example/2.png',
      'https://a.example/3.png',
      'https://a.example/4.png',
      'https://a.example/5.png',
      'https://a.example/6.png',
      'https://a.example/7.png',
      42
    ]
  });
  assert.deepEqual(next.images, [
    'https://a.example/one.png',
    'https://a.example/2.png',
    'https://a.example/3.png',
    'https://a.example/4.png',
    'https://a.example/5.png',
    'https://a.example/6.png'
  ]);
});

test('member visibility is on and non-empty', () => {
  assert.equal(isInfoVisibleForMembers(info({ enabled: true, title: 'Hi' })), true);
  assert.equal(isInfoVisibleForMembers(info({ enabled: true, images: ['https://a.example/x.png'] })), true);
  assert.equal(isInfoVisibleForMembers(info({ enabled: false, title: 'Hi' })), false);
  assert.equal(isInfoVisibleForMembers(info({ enabled: true })), false);
});
