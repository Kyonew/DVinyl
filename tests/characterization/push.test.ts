import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { exportInstance, setupAdmin } from './fixtures';

const backend = backendFor('push');

describe('push', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const subscription = (endpoint: string) => ({
    subscription: { endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }
  });

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
  });
  after(async () => { await app?.stop(); });

  it('hands out the same public key every time', async () => {
    const first = (await admin.get('/push/key')).json();
    const second = (await admin.get('/push/key')).json();
    assert.match(first.publicKey, /^[A-Za-z0-9_-]{80,}$/);
    assert.equal(second.publicKey, first.publicKey);
  });

  it('keeps a device on a push service, and refuses anything aimed elsewhere', async () => {
    let reply = await admin.postJson('/push/subscriptions', subscription('https://fcm.googleapis.com/fcm/send/device-1'));
    assert.equal(reply.status, 200, reply.text);
    for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://localhost/x', 'https://10.0.0.2/x', 'https://169.254.169.254/latest']) {
      reply = await admin.postJson('/push/subscriptions', subscription(endpoint));
      assert.equal(reply.status, 400, endpoint);
    }
    // The same browser subscribing again stays one device.
    await admin.postJson('/push/subscriptions', subscription('https://fcm.googleapis.com/fcm/send/device-1'));
    const page = (await admin.get('/notifications/settings')).text;
    assert.equal((page.match(/<li [^>]*data-device-endpoint=/g) || []).length, 1);
  });

  it('tests and removes a device of my own', async () => {
    const page = (await admin.get('/notifications/settings')).text;
    const id = page.match(/\/push\/subscriptions\/([0-9a-f]{24})\/test/)![1];
    let reply = await admin.postForm(`/push/subscriptions/${id}/test`, {});
    assert.equal(reply.location, '/notifications/settings?push_msg=test_sent');
    reply = await admin.postForm(`/push/subscriptions/${id}/delete`, {});
    assert.equal(reply.location, '/notifications/settings?push_msg=removed');
    assert.doesNotMatch((await admin.get('/notifications/settings')).text, /<li [^>]*data-device-endpoint=/);
  });

  it('saves which events reach my devices', async () => {
    await admin.postForm('/notifications/prefs', { push_request_received: 'on' });
    const me = (await exportInstance(admin)).users[0];
    assert.equal(me.notificationPrefs.push.request_received, undefined);
    assert.equal(me.notificationPrefs.push.request_accepted, false);
    assert.doesNotMatch((await admin.get('/notifications/settings')).text, /name="push_request_accepted" class="[^"]*" checked/);
  });
});
