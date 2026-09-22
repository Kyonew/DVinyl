import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser } from '../../../test/helpers/factories';
import { signAccessToken, bearer, seedRefreshToken } from '../../../test/helpers/auth';
import { clearAttempts } from '../../../controllers/loginAttempts';
import User from '../../../models/User';
import RefreshToken from '../../../models/RefreshToken';

const app = buildApiApp();

before(async () => { await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });

function withOidcDisabledLocalLogin<T>(fn: () => Promise<T>): Promise<T> {
  process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
  process.env.OIDC_CLIENT_ID = 'client';
  process.env.OIDC_CLIENT_SECRET = 'secret';
  process.env.OIDC_REDIRECT_URI = 'https://app.example.com/cb';
  process.env.OIDC_DISABLE_LOCAL_LOGIN = 'true';
  return fn().finally(() => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI;
    delete process.env.OIDC_DISABLE_LOCAL_LOGIN;
  });
}

describe('POST /api/v1/auth/login', () => {
  test('200 returns a token pair', async () => {
    const { user, password } = await makeUser();
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.accessToken, 'string');
    assert.equal(typeof res.body.refreshToken, 'string');
    assert.equal(res.body.expiresIn, 900);
  });

  test('400 when email or password is missing', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.com' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('400 on a wrong password', async () => {
    const { user } = await makeUser();
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'nope-nope' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('429 on the 4th consecutive failure for the same email', async () => {
    const { user } = await makeUser();
    clearAttempts(user.email);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'nope-nope' });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 429]);
    clearAttempts(user.email);
  });

  test('403 when local login is disabled', async () => {
    const { user, password } = await makeUser();
    await withOidcDisabledLocalLogin(async () => {
      const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
    });
  });
});

describe('GET /api/v1/auth/me', () => {
  test('200 returns the user and their collections', async () => {
    const { user } = await makeUser();
    const res = await request(app).get('/api/v1/auth/me').set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, user.email);
    assert.ok(Array.isArray(res.body.collections));
  });

  test('401 without an Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('401 with a garbage token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(bearer('not-a-jwt'));
    assert.equal(res.status, 401);
  });

  test('401 with a token older than user.lastChange', async () => {
    const { user } = await makeUser();
    const token = signAccessToken(user._id);
    await User.updateOne({ _id: user._id }, { $set: { lastChange: new Date(Date.now() + 60_000) } });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(token));
    assert.equal(res.status, 401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  test('200 rotates the refresh token', async () => {
    const { user } = await makeUser();
    const token = await seedRefreshToken(user);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.accessToken, 'string');
    assert.notEqual(res.body.refreshToken, token);
  });

  test('401 when the rotated-out token is reused', async () => {
    const { user } = await makeUser();
    const token = await seedRefreshToken(user);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
    assert.equal(res.status, 401);
  });

  test('401 for an unknown token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'deadbeef' });
    assert.equal(res.status, 401);
  });

  test('401 for an expired token', async () => {
    const { user } = await makeUser();
    const token = 'expired-token';
    await RefreshToken.create({
      user: user._id,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() - 1000)
    });
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
    assert.equal(res.status, 401);
  });

  test('400 without a refreshToken', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('200 revokes the calling device only', async () => {
    const { user } = await makeUser();
    const token = await seedRefreshToken(user);
    const other = await seedRefreshToken(user, 'other-device');

    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: token });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
    assert.equal(reuse.status, 401);

    const stillValid = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: other });
    assert.equal(stillValid.status, 200);
  });

  test('400 without a refreshToken', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    assert.equal(res.status, 400);
  });
});
