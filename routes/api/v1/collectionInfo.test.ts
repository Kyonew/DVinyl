import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce, registerTestPlugin } from '../../../test/helpers/plugins';
import Collection from '../../../models/Collection';

const app = buildApiApp();

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
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
