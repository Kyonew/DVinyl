import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser, makeLoginLog } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import BlockedIP from '../../../models/blockedIP';
import LoginLog from '../../../models/LoginLog';
import User from '../../../models/User';

const app = buildApiApp();

before(async () => { await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

const invalidId = 'not-an-object-id';
const unknownId = '64b7f9c2f1a2b3c4d5e6f7a8';

async function seedAdmin() {
  const { user } = await makeUser({ isAdmin: true });
  return { admin: user, token: signAccessToken(user._id) };
}

describe('admin access control', () => {
  test('403 for a non-admin; 401 unauthenticated', async () => {
    const { user } = await makeUser();
    const denied = await request(app).get('/api/v1/admin/users').set(bearer(signAccessToken(user._id)));
    assert.equal(denied.status, 403);

    const unauth = await request(app).get('/api/v1/admin/users');
    assert.equal(unauth.status, 401);
  });
});

describe('instance settings', () => {
  test('GET 200 returns settings', async () => {
    const { token } = await seedAdmin();
    const res = await request(app).get('/api/v1/admin/instance-settings').set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.settings.allowMemberCollectionCreation, 'boolean');
    assert.equal(typeof res.body.settings.maxCollectionsPerUser, 'number');
  });

  test('PATCH 200 updates and clamps values', async () => {
    const { token } = await seedAdmin();
    const res = await request(app)
      .patch('/api/v1/admin/instance-settings')
      .set(bearer(token))
      .send({ allowMemberCollectionCreation: true, maxCollectionsPerUser: '999' });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.allowMemberCollectionCreation, true);
    assert.equal(res.body.settings.maxCollectionsPerUser, 100);
  });
});

describe('users', () => {
  test('GET 200 lists users without passwords', async () => {
    const { token } = await seedAdmin();
    const target = (await makeUser()).user;
    const res = await request(app).get('/api/v1/admin/users').set(bearer(token));
    assert.equal(res.status, 200);
    const found = res.body.users.find((u: any) => u.id === String(target._id));
    assert.ok(found);
    assert.equal(found.password, undefined);
  });

  test('POST 201 creates a user with a generated password; 409 duplicate; 400 missing fields', async () => {
    const { token } = await seedAdmin();
    const created = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(token))
      .send({ username: 'created-user', email: 'created-user@example.com' });
    assert.equal(created.status, 201);
    assert.equal(typeof created.body.generatedPassword, 'string');

    const dup = await request(app)
      .post('/api/v1/admin/users')
      .set(bearer(token))
      .send({ username: 'created-user', email: 'created-user@example.com' });
    assert.equal(dup.status, 409);

    const bad = await request(app).post('/api/v1/admin/users').set(bearer(token)).send({ username: 'only-username' });
    assert.equal(bad.status, 400);
  });

  test('POST reset-password 200 for a normal user; 403 for another admin; 404 unknown', async () => {
    const { token } = await seedAdmin();
    const target = (await makeUser()).user;
    const otherAdmin = (await makeUser({ isAdmin: true })).user;

    const ok = await request(app).post(`/api/v1/admin/users/${target._id}/reset-password`).set(bearer(token)).send({});
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.body.generatedPassword, 'string');

    const denied = await request(app).post(`/api/v1/admin/users/${otherAdmin._id}/reset-password`).set(bearer(token)).send({});
    assert.equal(denied.status, 403);

    const missing = await request(app).post(`/api/v1/admin/users/${unknownId}/reset-password`).set(bearer(token)).send({});
    assert.equal(missing.status, 404);
  });

  test('DELETE 200 removes a user; 400 self; 403 other admin; 404 unknown', async () => {
    const { admin, token } = await seedAdmin();
    const target = (await makeUser()).user;
    const otherAdmin = (await makeUser({ isAdmin: true })).user;

    const ok = await request(app).delete(`/api/v1/admin/users/${target._id}`).set(bearer(token));
    assert.equal(ok.status, 200);
    assert.equal(await User.countDocuments({ _id: target._id }), 0);

    const self = await request(app).delete(`/api/v1/admin/users/${admin._id}`).set(bearer(token));
    assert.equal(self.status, 400);

    const denied = await request(app).delete(`/api/v1/admin/users/${otherAdmin._id}`).set(bearer(token));
    assert.equal(denied.status, 403);

    const missing = await request(app).delete(`/api/v1/admin/users/${unknownId}`).set(bearer(token));
    assert.equal(missing.status, 404);
  });
});

describe('blocked IPs', () => {
  test('GET 200 lists; POST 201 creates then 200 idempotently; 400 missing ip', async () => {
    const { token } = await seedAdmin();
    const created = await request(app).post('/api/v1/admin/blocked-ips').set(bearer(token)).send({ ip: '10.0.0.9' });
    assert.equal(created.status, 201);
    assert.equal(created.body.blockedIp.ip, '10.0.0.9');

    const again = await request(app).post('/api/v1/admin/blocked-ips').set(bearer(token)).send({ ip: '10.0.0.9' });
    assert.equal(again.status, 200);

    const list = await request(app).get('/api/v1/admin/blocked-ips').set(bearer(token));
    assert.equal(list.status, 200);
    assert.equal(list.body.blockedIps.length, 1);

    const bad = await request(app).post('/api/v1/admin/blocked-ips').set(bearer(token)).send({});
    assert.equal(bad.status, 400);
  });

  test('DELETE 200 removes; 404 unknown and malformed', async () => {
    const { token } = await seedAdmin();
    const created = await request(app).post('/api/v1/admin/blocked-ips').set(bearer(token)).send({ ip: '10.0.0.10' });
    const id = created.body.blockedIp.id;

    const removed = await request(app).delete(`/api/v1/admin/blocked-ips/${id}`).set(bearer(token));
    assert.equal(removed.status, 200);
    assert.equal(await BlockedIP.countDocuments({ ip: '10.0.0.10' }), 0);

    assert.equal((await request(app).delete(`/api/v1/admin/blocked-ips/${unknownId}`).set(bearer(token))).status, 404);
    assert.equal((await request(app).delete(`/api/v1/admin/blocked-ips/${invalidId}`).set(bearer(token))).status, 404);
  });
});

describe('login logs', () => {
  test('GET 200 lists newest first and clamps the limit', async () => {
    const { token } = await seedAdmin();
    await makeLoginLog({ timestamp: new Date(Date.now() - 2000), username: 'old' });
    await makeLoginLog({ timestamp: new Date(), username: 'new' });
    const res = await request(app).get('/api/v1/admin/login-logs?limit=1').set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.logs.length, 1);
    assert.equal(res.body.logs[0].username, 'new');
  });

  test('DELETE 200 removes the N newest; 400 for missing/oversized count', async () => {
    const { token } = await seedAdmin();
    for (let i = 0; i < 3; i++) await makeLoginLog({ timestamp: new Date(Date.now() - i * 1000) });

    const res = await request(app).delete('/api/v1/admin/login-logs?count=2').set(bearer(token));
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 2);
    assert.equal(await LoginLog.countDocuments(), 1);

    assert.equal((await request(app).delete('/api/v1/admin/login-logs').set(bearer(token))).status, 400);
    assert.equal((await request(app).delete('/api/v1/admin/login-logs?count=0').set(bearer(token))).status, 400);
    assert.equal((await request(app).delete('/api/v1/admin/login-logs?count=99999').set(bearer(token))).status, 400);
  });
});
