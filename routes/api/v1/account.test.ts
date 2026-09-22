import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb, clearDb } from '../../../test/helpers/db';
import { makeUser } from '../../../test/helpers/factories';
import { signAccessToken, bearer, seedRefreshToken } from '../../../test/helpers/auth';
import { removeAvatarFiles } from '../../../test/helpers/files';
import User from '../../../models/User';
import RefreshToken from '../../../models/RefreshToken';
import { clearAttempts } from '../../../controllers/loginAttempts';

const app = buildApiApp();

const realFetch = globalThis.fetch;
const password = 'password123';
const createdIds: string[] = [];

before(async () => { await startDb(); });
after(async () => { await stopDb(); });
beforeEach(async () => { await clearDb(); });
afterEach(() => {
  for (const id of createdIds.splice(0)) removeAvatarFiles(id);
  globalThis.fetch = realFetch;
});

function stubFetch(impl: (url: string) => Promise<any>) {
  globalThis.fetch = impl as any;
}

function response(body: Buffer, init: { status?: number; contentType?: string; contentLength?: string | null } = {}) {
  const status = init.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key: string) => {
        if (key === 'content-length') return init.contentLength ?? null;
        if (key === 'content-type') return init.contentType ?? 'image/png';
        return null;
      }
    },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    }
  };
}

async function seedAuthed() {
  const { user } = await makeUser({ password });
  createdIds.push(String(user._id));
  return { user, token: signAccessToken(user._id) };
}

describe('GET /api/v1/account/username-available', () => {
  test('200 false for a taken username, true for a free one', async () => {
    const { user, token } = await seedAuthed();
    const other = (await makeUser()).user;
    const taken = await request(app).get(`/api/v1/account/username-available?username=${other.username}`).set(bearer(token));
    assert.equal(taken.body.available, false);
    const free = await request(app).get('/api/v1/account/username-available?username=never-used-xyz').set(bearer(token));
    assert.equal(free.body.available, true);
    const own = await request(app).get(`/api/v1/account/username-available?username=${user.username}`).set(bearer(token));
    assert.equal(own.body.available, true);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/v1/account/username-available?username=x');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });
});

describe('PATCH /api/v1/account', () => {
  test('401 without a bearer token', async () => {
    const res = await request(app).patch('/api/v1/account').send({ theme: 'light' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('200 updates theme, language and currency', async () => {
    const { token } = await seedAuthed();
    const res = await request(app).patch('/api/v1/account').set(bearer(token)).send({ theme: 'light', language: 'en', currency: 'GBP' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.theme, 'light');
    assert.equal(res.body.user.language, 'en');
    assert.equal(res.body.user.currency, 'GBP');
  });

  test('200 renames; 409 on a duplicate username', async () => {
    const { token } = await seedAuthed();
    const renamed = await request(app).patch('/api/v1/account').set(bearer(token)).send({ username: 'renamed-user' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.username, 'renamed-user');

    const other = (await makeUser()).user;
    const dup = await request(app).patch('/api/v1/account').set(bearer(token)).send({ username: other.username });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.success, false);
  });

  test('400 for invalid values and empty bodies', async () => {
    const { token } = await seedAuthed();
    assert.equal((await request(app).patch('/api/v1/account').set(bearer(token)).send({ theme: 'neon' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/account').set(bearer(token)).send({ language: 'xx' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/account').set(bearer(token)).send({ currency: 'BTC' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/account').set(bearer(token)).send({ username: '   ' })).status, 400);
    assert.equal((await request(app).patch('/api/v1/account').set(bearer(token)).send({})).status, 400);
  });
});

describe('POST /api/v1/account/password', () => {
  test('200 changes the password and purges refresh tokens', async () => {
    const { user, token } = await seedAuthed();
    await seedRefreshToken(user);

    const res = await request(app)
      .post('/api/v1/account/password')
      .set(bearer(token))
      .send({ currentPassword: password, newPassword: 'newpassword123' });
    assert.equal(res.status, 200);
    assert.equal(await RefreshToken.countDocuments({ user: user._id }), 0);

    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'newpassword123' });
    assert.equal(login.status, 200);
    clearAttempts(user.email);
  });

  test('400 for a short new password', async () => {
    const { token } = await seedAuthed();
    const res = await request(app).post('/api/v1/account/password').set(bearer(token)).send({ currentPassword: password, newPassword: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('400 for a wrong current password', async () => {
    const { token } = await seedAuthed();
    const res = await request(app).post('/api/v1/account/password').set(bearer(token)).send({ currentPassword: 'wrongwrong', newPassword: 'newpassword123' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  test('429 after repeated wrong current passwords', async () => {
    const { user, token } = await seedAuthed();
    clearAttempts(`pwchange:${user._id}`);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/v1/account/password')
        .set(bearer(token))
        .send({ currentPassword: 'wrongwrong', newPassword: 'newpassword123' });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 429]);
    clearAttempts(`pwchange:${user._id}`);
  });

  test('400 for an SSO-only account', async () => {
    const { user } = await makeUser({ password: null, oidc: { sub: `sso-${Date.now()}` } });
    createdIds.push(String(user._id));
    const res = await request(app)
      .post('/api/v1/account/password')
      .set(bearer(signAccessToken(user._id)))
      .send({ currentPassword: 'x', newPassword: 'newpassword123' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });
});

describe('account avatars', () => {
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  test('POST avatar 200 stores the file; DELETE resets it', async () => {
    const { user, token } = await seedAuthed();
    const upload = await request(app)
      .post('/api/v1/account/avatar')
      .set(bearer(token))
      .attach('avatar', png, { filename: 'me.png', contentType: 'image/png' });
    assert.equal(upload.status, 200);
    assert.match(upload.body.avatarPath, /^\/uploads\/avatars\/avatar-/);
    const stored = await User.findById(user._id).lean();
    assert.equal((stored as any).img, upload.body.avatarPath);

    const remove = await request(app).delete('/api/v1/account/avatar').set(bearer(token));
    assert.equal(remove.status, 200);
    assert.equal(remove.body.avatarPath, '/ressources/no-pp.jpg');
  });

  test('POST avatar 400 without a file, and for a bad mimetype', async () => {
    const { token } = await seedAuthed();
    const none = await request(app).post('/api/v1/account/avatar').set(bearer(token));
    assert.equal(none.status, 400);
    assert.equal(none.body.success, false);

    const bad = await request(app)
      .post('/api/v1/account/avatar')
      .set(bearer(token))
      .attach('avatar', Buffer.from('plain'), { filename: 'x.txt', contentType: 'text/plain' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.success, false);
  });

  test('POST avatar 413 over 5 MB', async () => {
    const { token } = await seedAuthed();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    const res = await request(app)
      .post('/api/v1/account/avatar')
      .set(bearer(token))
      .attach('avatar', big, { filename: 'big.png', contentType: 'image/png' });
    assert.equal(res.status, 413);
    assert.equal(res.body.success, false);
  });

  test('import-gravatar 200 writes the fetched image', async () => {
    const { user, token } = await seedAuthed();
    stubFetch(async () => response(png, { contentType: 'image/png' }));
    const res = await request(app).post('/api/v1/account/avatar/import-gravatar').set(bearer(token));
    assert.equal(res.status, 200);
    assert.match(res.body.avatarPath, /^\/uploads\/avatars\/avatar-/);
    assert.ok(String(res.body.avatarPath).includes(String(user._id)));
  });

  test('import-gravatar 404 when the Gravatar is missing', async () => {
    const { token } = await seedAuthed();
    stubFetch(async () => response(Buffer.alloc(0), { status: 404 }));
    const res = await request(app).post('/api/v1/account/avatar/import-gravatar').set(bearer(token));
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  test('import-gravatar 502 when the fetch rejects', async () => {
    const { token } = await seedAuthed();
    stubFetch(async () => { throw new Error('offline'); });
    const res = await request(app).post('/api/v1/account/avatar/import-gravatar').set(bearer(token));
    assert.equal(res.status, 502);
  });

  test('import-gravatar 502 for an oversized image', async () => {
    const { token } = await seedAuthed();
    stubFetch(async () => response(png, { contentLength: String(6 * 1024 * 1024) }));
    const res = await request(app).post('/api/v1/account/avatar/import-gravatar').set(bearer(token));
    assert.equal(res.status, 502);
  });
});

describe('POST /api/v1/account/oidc/unlink', () => {
  test('200 unlinks SSO when a local password exists', async () => {
    const { user } = await makeUser({ password, oidc: { sub: `sso-${Date.now()}` } });
    createdIds.push(String(user._id));
    const res = await request(app).post('/api/v1/account/oidc/unlink').set(bearer(signAccessToken(user._id))).send({});
    assert.equal(res.status, 200);
    const after = await User.findById(user._id).lean();
    assert.equal((after as any).oidc, undefined);
  });

  test('400 for an SSO-only account', async () => {
    const { user } = await makeUser({ password: null, oidc: { sub: `sso-${Date.now()}` } });
    createdIds.push(String(user._id));
    const res = await request(app).post('/api/v1/account/oidc/unlink').set(bearer(signAccessToken(user._id))).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });
});
