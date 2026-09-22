import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeCollection, allModulesOn } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce, registerTestPlugin } from '../../../test/helpers/plugins';
import Collection from '../../../models/Collection';
import InstanceSettings from '../../../models/InstanceSettings';
import { invalidateInstanceSettingsCache } from '../../../utils/instanceSettings';

const app = buildApiApp();

before(async () => {
  loadPluginsOnce();
  registerTestPlugin();
  await startDb();
});
after(async () => { await stopDb(); });
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
  });
});

describe('POST /api/v1/collections', () => {
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
  });

  test('403 for a non-admin when member creation is disabled', async () => {
    const { user } = await makeUser();
    const res = await request(app).post('/api/v1/collections').set(bearer(signAccessToken(user._id))).send({ name: 'Nope' });
    assert.equal(res.status, 403);
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
  });

  test('403 for a non-admin member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).patch(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.editorToken)).send({ name: 'X' });
    assert.equal(res.status, 403);
  });

  test('403 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).patch(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.outsiderToken)).send({ name: 'X' });
    assert.equal(res.status, 403);
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
  });

  test('403 for a collection admin who is not an instance admin', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app).delete(`/api/v1/collections/${ctx.collection._id}`).set(bearer(ctx.ownerToken));
    assert.equal(res.status, 403);
  });

  test('404 for an unknown id', async () => {
    const admin = (await makeUser({ isAdmin: true })).user;
    const res = await request(app).delete(`/api/v1/collections/${unknownId}`).set(bearer(signAccessToken(admin._id)));
    assert.equal(res.status, 404);
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
  });

  test('POST 409 for an existing member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({ identifier: ctx.viewer.email });
    assert.equal(res.status, 409);
  });

  test('POST 400 without identifier or username+email', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/members`)
      .set(bearer(ctx.ownerToken))
      .send({});
    assert.equal(res.status, 400);
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
  });

  test('PATCH 404 for a non-member', async () => {
    const ctx = await seedCollectionWithRoles();
    const res = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/members/${ctx.outsider._id}`)
      .set(bearer(ctx.ownerToken))
      .send({ role: 'viewer' });
    assert.equal(res.status, 404);
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
  });

  test('DELETE 400 when removing the last admin', async () => {
    const admin = (await makeUser({ isAdmin: true })).user;
    const soleAdmin = (await makeUser()).user;
    const collection = await makeCollection({ members: [{ user: soleAdmin, role: 'admin' }] });
    const res = await request(app)
      .delete(`/api/v1/collections/${collection._id}/members/${soleAdmin._id}`)
      .set(bearer(signAccessToken(admin._id)));
    assert.equal(res.status, 400);
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

    const unknown = await request(app)
      .patch(`/api/v1/collections/${ctx.collection._id}/share-links/deadbeef`)
      .set(bearer(ctx.ownerToken))
      .send({ enabled: true });
    assert.equal(unknown.status, 404);
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
    assert.notEqual(res.body.shareLink.token, token);

    const unknown = await request(app)
      .post(`/api/v1/collections/${ctx.collection._id}/share-links/deadbeef/regenerate`)
      .set(bearer(ctx.ownerToken));
    assert.equal(unknown.status, 404);
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
  });
});

export { seedCollectionWithRoles, app, allModulesOn };
