import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoPrompt } from '../core/ai/photo';

const IMAGE = 'data:image/jpeg;base64,AAAA';

test('the photo prompt sends the image and names the plugin creator field', () => {
  const [system, user] = buildPhotoPrompt(IMAGE, 'music', 'artist');
  assert.equal(system!.role, 'system');
  assert.match(String(system!.content), /"creator" is the item's artist/);
  assert.match(String(system!.content), /"confidence"/);
  assert.ok(Array.isArray(user!.content));
  const parts = user!.content as any[];
  assert.ok(parts.some(p => p.type === 'image_url' && p.image_url.url === IMAGE));
  assert.ok(parts.some(p => p.type === 'text' && /Media type: music/.test(p.text)));
});

test('a plugin without a creator field still gets a usable prompt', () => {
  const [system] = buildPhotoPrompt(IMAGE, 'bottles', '');
  assert.match(String(system!.content), /"creator" is the item's creator/);
});
