import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApiApp } from '../../../test/helpers/app';
import { startDb, stopDb } from '../../../test/helpers/db';
import { makeUser } from '../../../test/helpers/factories';
import { signAccessToken, bearer } from '../../../test/helpers/auth';
import { loadPluginsOnce } from '../../../test/helpers/plugins';

const app = buildApiApp();

before(async () => {
  loadPluginsOnce();
  await startDb();
});
after(async () => { await stopDb(); });

describe('GET /api/v1/plugins', () => {
  test('401 without a bearer token', async () => {
    const res = await request(app).get('/api/v1/plugins');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test('200 lists the registered plugins', async () => {
    const { user } = await makeUser();
    const res = await request(app)
      .get('/api/v1/plugins')
      .set(bearer(signAccessToken(user._id)));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.plugins));
    assert.ok(res.body.plugins.some((p: any) => p.id === 'music'));
    const music = res.body.plugins.find((p: any) => p.id === 'music');
    assert.equal(music.kind, 'Music');
    assert.ok(Array.isArray(music.formFields));
  });
});
