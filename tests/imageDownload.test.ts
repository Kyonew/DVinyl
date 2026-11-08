import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { fetchPublic, isFetchableUrl, isPublicAddress, UnsafeAddressError } from '../core/safeFetch';
import { imageExtensionOf, managedItemImageFile } from '../core/itemImageStorage';
import { externalImagesOf, keepsCopies } from '../core/imageDownload';
import { alignImagesAfterRefresh } from '../core/itemImages';

test('only public addresses may be fetched from', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.10', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::10.0.0.1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  assert.equal(isPublicAddress('not an ip'), false);
});

test('only http and https on their usual ports, without credentials', () => {
  assert.equal(isFetchableUrl('https://images.example.com/a.jpg'), true);
  assert.equal(isFetchableUrl('http://example.com:80/a.jpg'), true);
  assert.equal(isFetchableUrl('http://example.com:8080/a.jpg'), false);
  assert.equal(isFetchableUrl('file:///etc/passwd'), false);
  assert.equal(isFetchableUrl('https://user:pw@example.com/a.jpg'), false);
  assert.equal(isFetchableUrl('data:image/png;base64,AAAA'), false);
});

test('a loopback server is refused before any request, redirect or not', async () => {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits++; res.writeHead(302, { Location: 'http://127.0.0.1/' }); res.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(fetchPublic('http://127.0.0.1/cover.jpg', { maxBytes: 1000 }), UnsafeAddressError);
    await assert.rejects(fetchPublic('http://localhost/cover.jpg', { maxBytes: 1000 }), UnsafeAddressError);
    await assert.rejects(fetchPublic('http://[::1]/cover.jpg', { maxBytes: 1000 }), UnsafeAddressError);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});

test('a stored file is named after what its bytes are', () => {
  assert.equal(imageExtensionOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageExtensionOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'png');
  assert.equal(imageExtensionOf(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
  assert.equal(imageExtensionOf(Buffer.from('GIF89a....')), 'gif');
  assert.equal(imageExtensionOf(Buffer.from('<html>')), null);
  assert.ok(managedItemImageFile('/uploads/items/item-123e4567-e89b-12d3-a456-426614174000.webp'));
  assert.equal(managedItemImageFile('/uploads/items/item-123e4567-e89b-12d3-a456-426614174000.svg'), null);
});

test('which images live elsewhere, and which collections keep copies', () => {
  assert.deepEqual(externalImagesOf({
    cover_image: 'https://i.discogs.com/a.jpg',
    images: ['https://i.discogs.com/a.jpg', '/uploads/items/item-123e4567-e89b-12d3-a456-426614174000.jpg', 'http://example.com:8080/x.png'],
    user_image: 'data:image/jpeg;base64,AAA'
  }), ['https://i.discogs.com/a.jpg']);
  assert.equal(keepsCopies({ enabled: true }, {}), true);
  assert.equal(keepsCopies({ enabled: true }, { imageDownload: 'keep' }), false);
  assert.equal(keepsCopies({ enabled: false }, { imageDownload: 'download' }), true);
  assert.equal(keepsCopies(null, { imageDownload: 'inherit' }), false);
});

test('a refresh bringing back the address of a kept copy leaves the copy', () => {
  const local = '/uploads/items/item-123e4567-e89b-12d3-a456-426614174000.jpg';
  const item = { cover_image: local, images: [local], image_origins: [{ file: local, url: 'https://i.discogs.com/a.jpg' }] };
  const same: any = { cover_image: 'https://i.discogs.com/a.jpg', year: '1990' };
  assert.equal(alignImagesAfterRefresh(item, same), null);
  assert.deepEqual(same, { year: '1990' });
  const other: any = { cover_image: 'https://i.discogs.com/b.jpg' };
  assert.equal(alignImagesAfterRefresh(item, other), local);
  assert.deepEqual(other.images, ['https://i.discogs.com/b.jpg']);
});
