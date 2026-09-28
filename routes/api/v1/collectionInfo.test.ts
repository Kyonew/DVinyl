import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeItem } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_KIND } from '../../../test/helpers/plugins';
import { removeItemImageUrls } from '../../../test/helpers/files';
import { storeItemImage, MAX_ITEM_IMAGE_UPLOAD_BYTES } from '../../../core/itemImageStorage';
import Collection from '../../../models/Collection';

const app = buildApiApp();

/** Managed upload paths this file produced, swept after the run. */
const uploadedImages: string[] = [];

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  await startDb();
});
after(async () => { removeItemImageUrls(uploadedImages); await stopDb(); });
// Each test seeds its own collection; clearing keeps the ids and roles unambiguous.
beforeEach(async () => { await clearDb(); });

/** owner=admin, editor, viewer, plus a non-member outsider. `info` is the stored sub-document. */
async function seedCollectionWithRoles(info?: Record<string, any>) {
  const owner = (await makeUser()).user;
  const editor = (await makeUser()).user;
  const viewer = (await makeUser()).user;
  const outsider = (await makeUser()).user;
  const collection = await makeCollection({
    members: [
      { user: owner, role: 'admin' },
      { user: editor, role: 'editor' },
      { user: viewer, role: 'viewer' }
    ]
  });
  if (info) await Collection.updateOne({ _id: collection._id }, { $set: { info } });
  return {
    owner, editor, viewer, outsider, collection,
    ownerToken: signAccessToken(owner._id),
    editorToken: signAccessToken(editor._id),
    viewerToken: signAccessToken(viewer._id),
    outsiderToken: signAccessToken(outsider._id)
  };
}

const visibleInfo = { enabled: true, shareVisible: true, title: 'My records', body: '# Hi\n\nHello', images: [] };

describe('GET /api/v1/collections/:id/info', () => {
  test('200 gives a member the page and its rendered HTML', async () => {
    const ctx = await seedCollectionWithRoles(visibleInfo);
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.visible, true);
    assert.equal(res.body.draft, false);
    assert.equal(res.body.info.title, 'My records');
    assert.equal(res.body.info.body, '# Hi\n\nHello');
    assert.match(res.body.bodyHtml, /<h1>Hi<\/h1>/);
  });

  test('an absent info sub-document is an empty page, never an error', async () => {
    const ctx = await seedCollectionWithRoles();
    const member = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.viewerToken));
    assert.equal(member.status, 200);
    assert.equal(member.body.info, null);
    assert.equal(member.body.visible, false);

    const admin = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken));
    assert.equal(admin.status, 200);
    assert.equal(admin.body.info.enabled, false);
    assert.equal(admin.body.draft, true);
  });

  test('withholds a disabled draft from a member but not from an admin', async () => {
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, enabled: false });
    const member = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.viewerToken));
    assert.equal(member.status, 200);
    assert.equal(member.body.info, null);
    assert.equal(member.body.bodyHtml, '');
    assert.equal(member.body.visible, false);
    assert.equal(member.body.draft, false);

    const admin = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken));
    assert.equal(admin.status, 200);
    assert.equal(admin.body.info.title, 'My records');
    assert.equal(admin.body.visible, false);
    assert.equal(admin.body.draft, true);
  });

  test('an enabled page with nothing on it is hidden from a member', async () => {
    const ctx = await seedCollectionWithRoles({ enabled: true, shareVisible: true, title: '', body: '', images: [] });
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.info, null);
  });

  test('escapes author-typed markup in bodyHtml', async () => {
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, body: '<script>alert(1)</script>' });
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body.bodyHtml, /<script>/);
    assert.match(res.body.bodyHtml, /&lt;script&gt;/);
  });

  test('401 without a token, 403 for a non-member, 404 for an unknown collection', async () => {
    const ctx = await seedCollectionWithRoles(visibleInfo);
    assert.equal((await request(app).get(`/api/v1/collections/${ctx.collection._id}/info`)).status, 401);
    assert.equal((await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.outsiderToken))).status, 403);
    assert.equal((await request(app)
      .get('/api/v1/collections/64b7f9c2f1a2b3c4d5e6f7a8/info')
      .set(bearer(ctx.viewerToken))).status, 404);
  });
});

describe('PATCH /api/v1/collections/:id/info', () => {
  test('applies only the provided keys and persists them', async () => {
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, body: 'Kept body', images: [] });
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ title: 'New title' });
    assert.equal(res.status, 200);
    assert.equal(res.body.info.title, 'New title');
    assert.equal(res.body.info.body, 'Kept body');
    assert.equal(res.body.info.enabled, true);

    const stored: any = await Collection.findById(ctx.collection._id).lean();
    assert.equal(stored.info.title, 'New title');
    assert.equal(stored.info.body, 'Kept body');
    assert.ok(stored.info.updated_at);
  });

  test('an empty body is a no-op that leaves updated_at alone', async () => {
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, updated_at: null });
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.info.updated_at, null);
  });

  test('400s on a wrong type and ignores unknown keys', async () => {
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, updated_at: null });
    const bad = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ enabled: 'yes' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'enabled must be a boolean');

    const images = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ images: 'x' });
    assert.equal(images.status, 400);

    const unknown = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ nonsense: 1 });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.info.updated_at, null);
  });

  test('normalises images: junk and duplicates dropped', async () => {
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, images: [] });
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ images: ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://a.example/one.png', 'https://a.example/one.png'] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.info.images, ['https://a.example/one.png']);
  });

  test('403 for a viewer and an editor', async () => {
    const ctx = await seedCollectionWithRoles(visibleInfo);
    for (const token of [ctx.viewerToken, ctx.editorToken]) {
      const res = await request(app)
        .patch(`/api/v1/collections/${ctx.collection._id}/info`)
        .set(bearer(token))
        .send({ title: 'X' });
      assert.equal(res.status, 403);
    }
  });

  test('removing an image deletes the unreferenced file', async () => {
    const url = await storeItemImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpeg')]));
    uploadedImages.push(url);
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, images: [url] });

    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ images: [] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.info.images, []);

    const fs = await import('fs');
    const path = await import('path');
    const file = path.join(__dirname, '../../../public', url.replace(/^\/+/, ''));
    assert.equal(fs.existsSync(file), false);
  });

  test('removing an image still used by an item keeps the file', async () => {
    const url = await storeItemImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpeg')]));
    uploadedImages.push(url);
    const ctx = await seedCollectionWithRoles({ ...visibleInfo, images: [url] });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Keeps the picture', owner: ctx.owner._id, collection: ctx.collection._id, images: [url] });

    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/info`)
      .set(bearer(ctx.ownerToken))
      .send({ images: [] });
    assert.equal(res.status, 200);

    const fs = await import('fs');
    const path = await import('path');
    const file = path.join(__dirname, '../../../public', url.replace(/^\/+/, ''));
    assert.equal(fs.existsSync(file), true);
  });
});
