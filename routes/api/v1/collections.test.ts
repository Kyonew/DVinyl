import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, makeSettings, makeItem, itemModel, allModulesOn } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce, registerTestPlugin, TEST_PLUGIN_ID, TEST_PLUGIN_KIND } from '../../../test/helpers/plugins';
import { removeItemImageUrls } from '../../../test/helpers/files';
import Collection from '../../../models/Collection';
import InstanceSettings from '../../../models/InstanceSettings';
import { invalidateInstanceSettingsCache } from '../../../utils/instanceSettings';

const app = buildApiApp();
const uploadedItemImages: string[] = [];

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  await startDb();
});
after(async () => {
  removeItemImageUrls(uploadedItemImages);
  await stopDb();
});
beforeEach(async () => { await clearDb(); });

const invalidId = 'not-an-object-id';
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

/** owner=admin, editor, viewer, plus an outsider non-member. */
async function seedCollectionWithRoles() {
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
  return {
    owner, editor, viewer, outsider, collection,
    ownerToken: signAccessToken(owner._id),
    editorToken: signAccessToken(editor._id),
    viewerToken: signAccessToken(viewer._id),
    outsiderToken: signAccessToken(outsider._id)
  };
}

describe('GET /api/v1/collections', () => {
  test('200 lists memberships with roles', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).get('/api/v1/collections').set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    const entry = res.body.collections.find((c: any) => c.id === String(ctx.collection._id));
    assert.ok(entry);
    assert.equal(entry.role, 'viewer');
  });

  test('401 without a bearer token', async () => {
    const res = await request(app).get('/api/v1/collections');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });
});

describe('POST /api/v1/collections', () => {
  test('401 without a bearer token', async () => {
    const res = await request(app).post('/api/v1/collections').send({ name: 'X' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('201 creates the collection with the creator as admin', async () => {
    const { user } = await makeUser({ isAdmin: true });
    const res = await request(app).post('/api/v1/collections').set(bearer(signAccessToken(user._id))).send({ name: 'My Shelf' });
    assert.equal(res.status, 201);
    assert.equal(res.body.collection.name, 'My Shelf');
    assert.equal(res.body.collection.role, 'admin');
  });

  test('400 without a name', async () => {
    const { user } = await makeUser();
    const res = await request(app).post('/api/v1/collections').set(bearer(signAccessToken(user._id))).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('403 for a non-admin when member creation is disabled', async () => {
    const { user } = await makeUser();
    const res = await request(app).post('/api/v1/collections').set(bearer(signAccessToken(user._id))).send({ name: 'Nope' });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  test('403 at quota when member creation is allowed', async () => {
    const { user } = await makeUser();
    await makeCollection({ members: [{ user, role: 'admin' }] });
    await InstanceSettings.updateOne(
      { key: 'instance' },
      { $set: { allowMemberCollectionCreation: true, maxCollectionsPerUser: 1 } },
      { upsert: true }
    );
    invalidateInstanceSettingsCache();
    const res = await request(app).post('/api/v1/collections').set(bearer(signAccessToken(user._id))).send({ name: 'Second' });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('PATCH /api/v1/collections/:id', () => {
  test('200 renames for a collection admin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).patch(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.ownerToken)).send({ name: 'Renamed' });
    assert.equal(res.status, 200);
    assert.equal(res.body.collection.name, 'Renamed');
  });

  test('400 without a name', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).patch(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.ownerToken)).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('403 for a non-admin member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).patch(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.editorToken)).send({ name: 'X' });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  test('403 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).patch(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.outsiderToken)).send({ name: 'X' });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('DELETE /api/v1/collections/:id', () => {
  test('200 deletes a non-default collection', async () => {
    const ctx = await seedCollectionWithRoles();
    const admin = (await makeUser({ isAdmin: true })).user;
    const res = await request(app).delete(`/api/v1/collections/${ctx.collection._id}`).set(bearer(signAccessToken(admin._id)));
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(await Collection.countDocuments({ _id: ctx.collection._id }), 0);
  });

  test('400 for the default collection', async () => {
    const admin = (await makeUser({ isAdmin: true })).user;
    const collection = await makeCollection({ members: [{ user: admin, role: 'admin' }], isDefault: true });
    const res = await request(app).delete(`/api/v1/collections/${collection._id}`).set(bearer(signAccessToken(admin._id)));
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('403 for a collection admin who is not an instance admin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).delete(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.ownerToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  test('404 for an unknown id', async () => {
    const admin = (await makeUser({ isAdmin: true })).user;
    const res = await request(app).delete(`/api/v1/collections/${unknownId}`).set(bearer(signAccessToken(admin._id)));
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});

describe('collection members', () => {
  test('GET 200 lists populated members for an admin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).get(`/api/v1/collections/${ctx.collection._id}/members`).set(bearer(ctx.ownerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.members.length, 3);
    assert.ok(res.body.members.some((m: any) => m.role === 'editor'));
  });

  test('GET 403 for an editor', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).get(`/api/v1/collections/${ctx.collection._id}/members`).set(bearer(ctx.editorToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  test('POST 201 adds an existing user by identifier', async () => {
    const ctx = await seedCollectionWithRoles();
    const candidate = (await makeUser()).user;
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({ identifier: candidate.email, role: 'editor' });
    assert.equal(res.status, 201);
    assert.equal(res.body.member.userId, String(candidate._id));
    assert.equal(res.body.member.role, 'editor');
  });

  test('POST 201 creates a new user from username + email', async () => {
    const ctx = await seedCollectionWithRoles();
    const unique = `${Date.now()}`;
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({ username: `invited-${unique}`, email: `invited-${unique}@example.com`, role: 'viewer' });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.generatedPassword, 'string');
  });

  test('POST 404 for an unknown identifier', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({ identifier: 'missing@example.com' });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('POST 409 for an existing member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({ identifier: ctx.viewer.email });
    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
  });

  test('POST 400 without identifier or username+email', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('PATCH 200 changes a member role', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/members/${ctx.viewer._id}`)
      .set(bearer(ctx.ownerToken))
      .send({ role: 'editor' });
    assert.equal(res.status, 200);
    const coll: any = await Collection.findById(ctx.collection._id).lean();
    const member = coll.members.find((m: any) => String(m.user) === String(ctx.viewer._id));
    assert.equal(member.role, 'editor');
  });

  test('PATCH 400 for changing your own role', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/members/${ctx.owner._id}`)
      .set(bearer(ctx.ownerToken))
      .send({ role: 'viewer' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('PATCH 400 when demoting the last admin', async () => {
    const admin = (await makeUser({ isAdmin: true })).user;
    const soleAdmin = (await makeUser()).user;
    const collection = await makeCollection({ members: [{ user: soleAdmin, role: 'admin' }] });
    const res = await request(app)
      .patch(`/api/v1/collections/${collection._id}/members/${soleAdmin._id}`)
      .set(bearer(signAccessToken(admin._id)))
      .send({ role: 'viewer' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('PATCH 404 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/members/${ctx.outsider._id}`)
      .set(bearer(ctx.ownerToken))
      .send({ role: 'viewer' });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('DELETE 200 removes a member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .delete(`/api/v1/collections/${ctx.collection._id}/members/${ctx.viewer._id}`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 200);
  });

  test('DELETE 400 for a malformed userId', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .delete(`/api/v1/collections/${ctx.collection._id}/members/${invalidId}`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('DELETE 400 when removing the last admin', async () => {
    const admin = (await makeUser({ isAdmin: true })).user;
    const soleAdmin = (await makeUser()).user;
    const collection = await makeCollection({ members: [{ user: soleAdmin, role: 'admin' }] });
    const res = await request(app)
      .delete(`/api/v1/collections/${collection._id}/members/${soleAdmin._id}`)
      .set(bearer(signAccessToken(admin._id)));
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('POST reset-password 200 for a member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members/${ctx.viewer._id}/reset-password`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.generatedPassword, 'string');
  });

  test('POST reset-password 404 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members/${ctx.outsider._id}/reset-password`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('POST reset-password 403 when the member is in another collection', async () => {
    const ctx = await seedCollectionWithRoles();
    const member = (await makeUser()).user;
    await Collection.updateOne({ _id: ctx.collection._id }, { $addToSet: { members: { user: member._id, role: 'viewer' } } });
    await makeCollection({ members: [{ user: member, role: 'admin' }] });
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members/${member._id}/reset-password`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('collection share links', () => {
  test('POST 201 creates a link with validated scope', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'Vinyls', scope: [{ pluginId: 'music', formats: ['vinyl', 'not-a-format'] }, { pluginId: 'ghost' }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.shareLink.label, 'Vinyls');
    assert.deepEqual(res.body.shareLink.scope, [{ pluginId: 'music', formats: ['vinyl'] }]);
  });

  test('GET 200 lists links; 403 for a non-admin', async () => {
    const ctx = await seedCollectionWithRoles();
    await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'A' });
    const list = await request(app).get(`/api/v1/collections/${ctx.collection._id}/share-links`).set(bearer(ctx.ownerToken));
    assert.equal(list.status, 200);
    assert.equal(list.body.shareLinks.length, 1);

    const denied = await request(app).get(`/api/v1/collections/${ctx.collection._id}/share-links`).set(bearer(ctx.viewerToken));
    assert.equal(denied.status, 403);
    assert.equal(denied.body.success, false);
  });

  test('PATCH 200 updates enabled/label/scope', async () => {
    const ctx = await seedCollectionWithRoles();
    const created = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'A' });
    const token = created.body.shareLink.token;
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/share-links/${token}`)
      .set(bearer(ctx.ownerToken))
      .send({ enabled: false, label: 'B' });
    assert.equal(res.status, 200);
    assert.equal(res.body.shareLink.enabled, false);
    assert.equal(res.body.shareLink.label, 'B');
  });

  test('PATCH 400 with nothing to update; 404 for unknown token', async () => {
    const ctx = await seedCollectionWithRoles();
    const created = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'A' });
    const token = created.body.shareLink.token;

    const empty = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/share-links/${token}`)
      .set(bearer(ctx.ownerToken))
      .send({});
    assert.equal(empty.status, 400);
    assert.equal(empty.body.success, false);

    const unknown = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/share-links/deadbeef`)
      .set(bearer(ctx.ownerToken))
      .send({ enabled: true });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.success, false);
  });

  test('regenerate 200 issues a new token; 404 for unknown', async () => {
    const ctx = await seedCollectionWithRoles();
    const created = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'A' });
    const token = created.body.shareLink.token;
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links/${token}/regenerate`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.shareLink.token, 'string');
    assert.notEqual(res.body.shareLink.token, token);

    const unknown = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links/deadbeef/regenerate`)
      .set(bearer(ctx.ownerToken));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.success, false);
  });

  test('DELETE 200 removes a link; 404 for unknown', async () => {
    const ctx = await seedCollectionWithRoles();
    const created = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'A' });
    const token = created.body.shareLink.token;
    const res = await request(app)
      .delete(`/api/v1/collections/${ctx.collection._id}/share-links/${token}`)
      .set(bearer(ctx.ownerToken));
    assert.equal(res.status, 200);

    const unknown = await request(app)
      .delete(`/api/v1/collections/${ctx.collection._id}/share-links/${token}`)
      .set(bearer(ctx.ownerToken));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.success, false);
  });

  test('qr.png 200 returns a PNG; 404 for a disabled link', async () => {
    const ctx = await seedCollectionWithRoles();
    const created = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links`)
      .set(bearer(ctx.ownerToken))
      .send({ label: 'A' });
    const token = created.body.shareLink.token;
    const png = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/share-links/${token}/qr.png`)
      .set(bearer(ctx.ownerToken));
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');

    const coll: any = await Collection.findById(ctx.collection._id);
    for (const link of coll.shareLinks) if (link.token === token) link.enabled = false;
    await coll.save();
    const disabled = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/share-links/${token}/qr.png`)
      .set(bearer(ctx.ownerToken));
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.success, false);
  });
});

describe('GET /api/v1/collections/:id/items', () => {
  async function seedItems() {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    const items = [];
    for (let i = 1; i <= 30; i++) {
      items.push(await makeItem(TEST_PLUGIN_KIND, {
        title: `Item ${String(i).padStart(2, '0')}`,
        creator: i % 2 === 0 ? 'Even Creator' : 'Odd Creator',
        owner: ctx.owner._id,
        collection: ctx.collection._id,
        added_at: new Date(Date.now() - i * 1000)
      }));
    }
    return { ...ctx, items };
  }

  test('200 paginates and reports totals', async () => {
    const ctx = await seedItems();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.totalItems, 30);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 25);
    assert.equal(res.body.items.length, 25);
    assert.equal(res.body.totalPages, 2);
  });

  test('page 2 returns the remaining items', async () => {
    const ctx = await seedItems();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?page=2`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.body.page, 2);
    assert.equal(res.body.items.length, 5);
  });

  test('search narrows by title/creator', async () => {
    const ctx = await seedItems();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?search=Even%20Creator`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.totalItems, 15);
  });

  test('type filter narrows to the plugin kind', async () => {
    const ctx = await seedItems();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?type=testkind`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.body.totalItems, 30);
    const none = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items?type=music`)
      .set(bearer(ctx.viewerToken));
    assert.equal(none.body.totalItems, 0);
  });

  test('hides visibility-hidden items', async () => {
    const ctx = await seedItems();
    await makeSettings(ctx.collection, { visibility: { hiddenItems: [ctx.items[0]!._id] } });
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.body.totalItems, 29);
  });

  test('403 for a non-member; 404 for an unknown collection', async () => {
    const ctx = await seedItems();
    const outsider = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.outsiderToken));
    assert.equal(outsider.status, 403);
    assert.equal(outsider.body.success, false);

    const unknown = await request(app)
      .get(`/api/v1/collections/${unknownId}/items`)
      .set(bearer(ctx.viewerToken));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.success, false);
  });
});

describe('POST /api/v1/collections/:id/items/search', () => {
  test('200 maps fake provider results', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items/search`)
      .set(bearer(ctx.editorToken))
      .send({ pluginId: 'testkind', query: 'dune' });
    assert.equal(res.status, 200);
    assert.equal(res.body.results[0].title, 'Result for dune');
    assert.equal(res.body.query, 'dune');
  });

  test('404 for an unknown plugin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items/search`)
      .set(bearer(ctx.editorToken))
      .send({ pluginId: 'ghost', query: 'x' });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('403 for a viewer', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items/search`)
      .set(bearer(ctx.viewerToken))
      .send({ pluginId: 'testkind', query: 'x' });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('GET /api/v1/collections/:id/items/confirm', () => {
  test('200 returns details, suggestions and duplicates', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items/confirm?pluginId=testkind&externalId=42`)
      .set(bearer(ctx.editorToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.item.test_external_id, '42');
    assert.ok(Array.isArray(res.body.duplicates));
    assert.ok(res.body.suggestions && typeof res.body.suggestions === 'object');
  });

  test('400 without externalId', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items/confirm?pluginId=testkind`)
      .set(bearer(ctx.editorToken));
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('404 for an unknown plugin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items/confirm?pluginId=ghost&externalId=1`)
      .set(bearer(ctx.editorToken));
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});

describe('POST /api/v1/collections/:id/items', () => {
  test('201 creates an item', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.editorToken))
      .send({ pluginId: 'testkind', title: 'Brand New', creator: 'New Creator' });
    assert.equal(res.status, 201);
    assert.equal(res.body.item.title, 'Brand New');
  });

  test('200 merges a duplicate and bumps quantity', async () => {
    const ctx = await seedCollectionWithRoles();
    const item = await makeItem(TEST_PLUGIN_KIND, {
      title: 'Duplicate Me', creator: 'Creator', owner: ctx.owner._id, collection: ctx.collection._id, quantity: 1
    });
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.editorToken))
      .send({ pluginId: 'testkind', title: 'Duplicate Me', creator: 'Creator', quantity: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.merged, true);
    const merged: any = await itemModel(TEST_PLUGIN_KIND).findById(item._id).lean();
    assert.equal(merged.quantity, 3);
  });

  test('404 for an unknown plugin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.editorToken))
      .send({ pluginId: 'ghost', title: 'X' });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('403 for a viewer', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.viewerToken))
      .send({ pluginId: 'testkind', title: 'X' });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('POST /api/v1/collections/:id/item-images', () => {
  // A tiny valid JPEG (SOI ... EOI) so isJpegBuffer() accepts it.
  const jpeg = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
  ]);

  test('201 stores a JPEG', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/item-images`)
      .set(bearer(ctx.editorToken))
      .attach('image', jpeg, { filename: 'cover.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.url, 'string');
    uploadedItemImages.push(res.body.url);
  });

  test('400 for a non-JPEG upload', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/item-images`)
      .set(bearer(ctx.editorToken))
      .attach('image', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('413 for an oversized upload', async () => {
    const ctx = await seedCollectionWithRoles();
    const { MAX_ITEM_IMAGE_UPLOAD_BYTES } = await import('../../../core/itemImageStorage');
    const big = Buffer.alloc(MAX_ITEM_IMAGE_UPLOAD_BYTES + 1, 0xFF);
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/item-images`)
      .set(bearer(ctx.editorToken))
      .attach('image', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
    assert.equal(res.status, 413);
    assert.equal(res.body.success, false);
  });
});

describe('item listing filters', () => {
  async function seedMixed() {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    const visible = await makeItem(TEST_PLUGIN_KIND, { title: 'Visible', owner: ctx.owner._id, collection: ctx.collection._id });
    const holder = await makeItem(TEST_PLUGIN_KIND, { title: 'Holder', owner: ctx.owner._id, collection: ctx.collection._id });
    const seasonOne = await makeItem(TEST_PLUGIN_KIND, { title: 'Season 1', owner: ctx.owner._id, collection: ctx.collection._id, parent: holder._id });
    const seasonTwo = await makeItem(TEST_PLUGIN_KIND, { title: 'Season 2', owner: ctx.owner._id, collection: ctx.collection._id, parent: holder._id });
    const wishlisted = await makeItem(TEST_PLUGIN_KIND, { title: 'Wished', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true });
    return { ...ctx, visible, holder, seasonOne, seasonTwo, wishlisted };
  }

  test('excludes wishlist items and contained items', async () => {
    const ctx = await seedMixed();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.viewerToken));
    const titles = res.body.items.map((i: any) => i.title).sort();
    assert.deepEqual(titles, ['Holder', 'Visible']);

    const stats = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/stats`)
      .set(bearer(ctx.viewerToken));
    assert.equal(stats.body.stats.total, 2);
  });

  test('a disabled module hides its items from listing and stats', async () => {
    const ctx = await seedMixed();
    await makeSettings(ctx.collection, { modules: { ...allModulesOn(), testkind: false } });
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/items`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.body.totalItems, 0);

    const stats = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/stats`)
      .set(bearer(ctx.viewerToken));
    assert.equal(stats.body.stats.total, 0);
  });
});

describe('GET /api/v1/collections/:id/stats', () => {
  test('200 totals quantities and per-plugin counts', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    await makeItem(TEST_PLUGIN_KIND, { title: 'One', owner: ctx.owner._id, collection: ctx.collection._id, quantity: 2 });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Two', owner: ctx.owner._id, collection: ctx.collection._id, quantity: 3 });
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/stats`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.stats.total, 5);
    assert.equal(res.body.stats.testkind, 2);
  });

  test('403 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/stats`)
      .set(bearer(ctx.outsiderToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('wishlist listing', () => {
  /**
   * One owned item, a wishlist holder with two contained seasons, and a wanted item
   * with quantity 2. Two seasons (not one) so the holder keeps its place on the shelf
   * rather than being replaced by its single child (see resolveShelfItems).
   */
  async function seedWishlist() {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    const owned = await makeItem(TEST_PLUGIN_KIND, { title: 'Owned', owner: ctx.owner._id, collection: ctx.collection._id });
    const holder = await makeItem(TEST_PLUGIN_KIND, { title: 'Wish Holder', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true });
    const seasonOne = await makeItem(TEST_PLUGIN_KIND, { title: 'Wish Season 1', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true, parent: holder._id });
    const seasonTwo = await makeItem(TEST_PLUGIN_KIND, { title: 'Wish Season 2', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true, parent: holder._id });
    const wanted = await makeItem(TEST_PLUGIN_KIND, { title: 'Wanted', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true, quantity: 2 });
    return { ...ctx, owned, holder, seasonOne, seasonTwo, wanted };
  }

  test('200 returns only wishlist items, excluding owned and contained items', async () => {
    const ctx = await seedWishlist();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/wishlist`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    const titles = res.body.items.map((i: any) => i.title).sort();
    assert.deepEqual(titles, ['Wanted', 'Wish Holder']);
    assert.equal(res.body.totalItems, 2);
  });

  test('200 filters by type and search like the collection listing', async () => {
    const ctx = await seedWishlist();
    const bySearch = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/wishlist?search=Wanted`)
      .set(bearer(ctx.viewerToken));
    assert.deepEqual(bySearch.body.items.map((i: any) => i.title), ['Wanted']);

    const byType = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/wishlist?type=${TEST_PLUGIN_ID}`)
      .set(bearer(ctx.viewerToken));
    assert.equal(byType.body.totalItems, 2);
  });

  test('401 without a bearer token', async () => {
    const ctx = await seedWishlist();
    const res = await request(app).get(`/api/v1/collections/${ctx.collection._id}/wishlist`);
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('403 for a non-member', async () => {
    const ctx = await seedWishlist();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/wishlist`)
      .set(bearer(ctx.outsiderToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});

describe('GET /api/v1/collections/:id/wishlist/stats', () => {
  test('200 totals wishlist quantities, excluding owned and contained items', async () => {
    const ctx = await seedCollectionWithRoles();
    await makeSettings(ctx.collection);
    await makeItem(TEST_PLUGIN_KIND, { title: 'Owned', owner: ctx.owner._id, collection: ctx.collection._id, quantity: 5 });
    const holder = await makeItem(TEST_PLUGIN_KIND, { title: 'Wish Holder', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Wish Season', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true, parent: holder._id });
    await makeItem(TEST_PLUGIN_KIND, { title: 'Wanted', owner: ctx.owner._id, collection: ctx.collection._id, in_wishlist: true, quantity: 2 });

    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/wishlist/stats`)
      .set(bearer(ctx.viewerToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.stats.total, 3);
    assert.equal(res.body.stats.testkind, 2);
  });

  test('403 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .get(`/api/v1/collections/${ctx.collection._id}/wishlist/stats`)
      .set(bearer(ctx.outsiderToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });
});
