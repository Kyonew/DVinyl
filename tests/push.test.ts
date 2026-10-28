import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanSubscription, deviceLabel, isAllowedEndpoint, isPublicAddress, wantsPush } from '../core/push';

describe('push', () => {
  it('tells the public internet from this machine and local networks', () => {
    for (const address of ['8.8.8.8', '142.250.0.1', '2a00:1450::1']) assert.equal(isPublicAddress(address), true, address);
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.1']) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it('only sends to HTTPS endpoints on public hosts', async () => {
    const resolveTo = (addresses: string[]) => async () => addresses;
    assert.equal(await isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc', resolveTo([])), true, 'a known push service needs no lookup');
    assert.equal(await isAllowedEndpoint('https://web.push.apple.com/QG9', resolveTo([])), true);
    assert.equal(await isAllowedEndpoint('https://push.example.org/x', resolveTo(['93.184.216.34'])), true);
    assert.equal(await isAllowedEndpoint('https://push.example.org/x', resolveTo(['93.184.216.34', '10.0.0.5'])), false, 'one private address is enough to refuse');
    assert.equal(await isAllowedEndpoint('https://evil.example/x', async () => { throw new Error('nx'); }), false);
    assert.equal(await isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
    assert.equal(await isAllowedEndpoint('https://localhost/x'), false);
    assert.equal(await isAllowedEndpoint('https://192.168.1.2/x'), false);
    assert.equal(await isAllowedEndpoint('https://[::1]/x'), false);
    assert.equal(await isAllowedEndpoint('https://fcm.googleapis.com:8443/x'), false);
    assert.equal(await isAllowedEndpoint('https://user:pw@fcm.googleapis.com/x'), false);
    assert.equal(await isAllowedEndpoint('not a url'), false);
  });

  it('keeps only a well-formed subscription', () => {
    const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNcRdreALRFX_abc-1', auth: 'tBHItJI5svbpez7KI4CCXg' } };
    assert.deepEqual(cleanSubscription(good), good);
    assert.equal(cleanSubscription({ ...good, keys: { p256dh: 'not base64!', auth: 'x' } }), null);
    assert.equal(cleanSubscription({ endpoint: good.endpoint }), null);
    assert.equal(cleanSubscription(null), null);
  });

  it('names a device and reads what its member wants pushed', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'), 'Chrome · Android');
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari · iOS');
    assert.equal(wantsPush({}, 'request.received'), true);
    assert.equal(wantsPush({ notificationPrefs: { push: { request_received: false } } }, 'request.received'), false);
    assert.equal(wantsPush({ notificationPrefs: { push: { request_received: false } } }, 'request.accepted'), true);
  });
});

describe('push contact', () => {
  it('signs with a real address, never one Apple refuses', () => {
    const { vapidSubject } = require('../core/push');
    const saved = { contact: process.env.PUSH_CONTACT, url: process.env.PUBLIC_URL };
    delete process.env.PUSH_CONTACT; delete process.env.PUBLIC_URL;
    try {
      assert.equal(vapidSubject('https://vinyl.example.org'), 'https://vinyl.example.org');
      process.env.PUSH_CONTACT = 'mailto:me@example.org';
      assert.equal(vapidSubject('https://vinyl.example.org'), 'mailto:me@example.org');
      process.env.PUSH_CONTACT = 'nonsense';
      assert.equal(vapidSubject(''), 'mailto:admin@localhost.localdomain');
    } finally {
      if (saved.contact === undefined) delete process.env.PUSH_CONTACT; else process.env.PUSH_CONTACT = saved.contact;
      if (saved.url === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = saved.url;
    }
  });
});
