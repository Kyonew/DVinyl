import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, exportInstance, itemByTitle, listedTitles, login, setupAdmin } from './fixtures';

const backend = backendFor('requests');

// The loan template of the admin page, as the builder sends it.
const BORROW = {
  name: 'Borrow', icon: 'hand-holding', minRole: 'viewer', visibility: 'members', holder: 'sender',
  fields: [{ label: 'Give it back by', type: 'date', deadline: true }],
  steps: [{ label: 'Handed over', out: true }, { label: 'Given back', out: false }]
};
const GIFT = {
  name: 'Gift', icon: 'gift', minRole: 'viewer', visibility: 'private', holder: 'none',
  fields: [], steps: []
};

describe('requests', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let bob: Client;
  let eve: Client;
  let adminId: string;
  let bobId: string;
  let eveId: string;

  const idOf = async (title: string) => String(itemByTitle(await exportInstance(admin), title)._id);
  const requestsOn = async (title: string) => {
    const dump = await exportInstance(admin);
    const id = String(itemByTitle(dump, title)._id);
    return dump.requests.filter((r: any) => String(r.item) === id);
  };
  const member = async (username: string) => {
    const reply = await admin.postForm('/admin/members/create', { username, email: `${username}@example.test`, role: 'viewer' });
    const password = reply.text.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)![1]!
      .replace(/&(amp|lt|gt|#34|#39);/g, (_, entity) =>
        ({ amp: '&', lt: '<', gt: '>', '#34': '"', '#39': "'" } as Record<string, string>)[entity]!);
    await new Promise(resolve => setTimeout(resolve, 1100));
    return login(app, `${username}@example.test`, password);
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, { title: 'Kind of Blue', artist: 'Miles Davis' });
    await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles' });
    await addMusic(admin, { title: 'Blue Train', artist: 'John Coltrane', in_wishlist: 'true' });
    bob = await member('bob');
    eve = await member('eve');
    const users = (await exportInstance(admin)).users;
    adminId = String(users.find((u: any) => u.username !== 'bob' && u.username !== 'eve')._id);
    bobId = String(users.find((u: any) => u.username === 'bob')._id);
    eveId = String(users.find((u: any) => u.username === 'eve')._id);
  });
  after(async () => { await app?.stop(); });

  it('offers nothing until requests are on and a type exists', async () => {
    const id = await idOf('Kind of Blue');
    assert.doesNotMatch((await bob.get(`/album/${id}`)).text, /id="requests"/);
    assert.equal((await bob.get('/requests')).status, 302);

    await admin.postForm('/admin/requests/settings', { enabled: 'on' });
    assert.doesNotMatch((await bob.get(`/album/${id}`)).text, /id="requestForm"/, 'no type yet');

    assert.equal((await admin.postJson('/admin/request-types', BORROW)).status, 200);
    assert.equal((await admin.postJson('/admin/request-types', GIFT)).status, 200);
    assert.equal((await admin.postJson('/admin/request-types', { name: '' })).status, 400);
    const page = (await bob.get(`/album/${id}`)).text;
    assert.match(page, /name="type" value="borrow"/);
    assert.match(page, /name="type" value="gift"/);
  });

  it('borrows an item: asked, accepted, handed over, given back', async () => {
    const id = await idOf('Kind of Blue');
    let reply = await bob.postForm('/requests', { type: 'borrow', itemId: id, recipient: adminId, f_give_it_back_by: '2026-11-30', message: 'For the weekend', back: `/album/${id}` });
    assert.equal(reply.location, `/album/${id}?request_msg=msg_sent`);
    reply = await bob.postForm('/requests', { type: 'borrow', itemId: id, recipient: bobId, back: '/requests' });
    assert.equal(reply.location, '/requests?request_msg=err_recipient', 'not to oneself');
    reply = await bob.postForm('/requests', { type: 'borrow', itemId: id, recipient: bobId, back: '/\\evil.example/x' });
    assert.equal(reply.location, '/requests?box=sent&request_msg=err_recipient', 'a back slash leaves the site like a second slash');

    let [request] = await requestsOn('Kind of Blue');
    assert.equal(request.status, 'pending');
    assert.deepEqual(request.data, { give_it_back_by: '2026-11-30' });
    assert.equal((await admin.get('/requests?box=inbox')).status, 200);
    assert.match((await admin.get('/requests?box=inbox')).text, new RegExp(`/requests/${request._id}/accept`));

    // Only the recipient answers.
    await eve.postForm(`/requests/${request._id}/accept`, {});
    await bob.postForm(`/requests/${request._id}/accept`, {});
    assert.equal((await requestsOn('Kind of Blue'))[0].status, 'pending');

    await admin.postForm(`/requests/${request._id}/accept`, {});
    [request] = await requestsOn('Kind of Blue');
    assert.equal(request.status, 'accepted');
    assert.equal(request.step, -1);

    await admin.postForm(`/requests/${request._id}/advance`, {});
    [request] = await requestsOn('Kind of Blue');
    assert.equal(request.step, 0);
    const grid = (await eve.get('/collection?limit=200')).text;
    assert.match(grid, /fa-hand-holding mr-1" aria-hidden="true"><\/i>bob/, 'everyone sees who has it');
    assert.deepEqual(listedTitles((await admin.get('/collection?limit=200&away=out')).text, await exportInstance(admin)), ['Kind of Blue']);

    await bob.postForm(`/requests/${request._id}/advance`, {});
    [request] = await requestsOn('Kind of Blue');
    assert.equal(request.status, 'done');
    assert.deepEqual(request.log.map((e: any) => e.action), ['sent', 'accepted', 'step', 'step']);
    assert.deepEqual(listedTitles((await admin.get('/collection?limit=200&away=out')).text, await exportInstance(admin)), []);
    assert.equal((await bob.get(`/requests/${request._id}`)).status, 200);
  });

  it('keeps an item with one member at a time', async () => {
    const id = await idOf('Abbey Road');
    for (const client of [bob, eve]) {
      await client.postForm('/requests', { type: 'borrow', itemId: id, recipient: adminId });
    }
    const [first, second] = await requestsOn('Abbey Road');
    for (const r of [first, second]) {
      await admin.postForm(`/requests/${r._id}/accept`, {});
    }
    await admin.postForm(`/requests/${first._id}/advance`, {});
    const reply = await admin.postForm(`/requests/${second._id}/advance`, { back: '/requests' });
    assert.equal(reply.location, '/requests?request_msg=err_item_out');
    await admin.postForm(`/requests/${second._id}/cancel`, {});
    assert.deepEqual((await requestsOn('Abbey Road')).map((r: any) => [r.status, r.step]).sort(), [['accepted', 0], ['cancelled', -1]]);
  });

  it('keeps a private request between its two members', async () => {
    const id = await idOf('Blue Train');
    await bob.postForm('/requests', { type: 'gift', itemId: id, recipient: adminId, message: 'Someday?' });
    const [gift] = await requestsOn('Blue Train');
    assert.equal(gift.visibility, 'private');
    assert.equal((await eve.get(`/requests/${gift._id}`)).status, 404);
    assert.doesNotMatch((await eve.get(`/album/${id}`)).text, /Someday\?/);
    assert.match((await admin.get(`/album/${id}`)).text, /Someday\?/);

    // No step: accepting closes it.
    await admin.postForm(`/requests/${gift._id}/accept`, { response: 'We will see' });
    const [answered] = await requestsOn('Blue Train');
    assert.equal(answered.status, 'done');
    assert.match((await bob.get('/notifications')).text, /fa-circle-check[^]*Blue Train/);
  });

  it('calls off what was open on an item that is deleted', async () => {
    await addMusic(admin, { title: 'Doomed', artist: 'Nobody' });
    const id = await idOf('Doomed');
    await bob.postForm('/requests', { type: 'borrow', itemId: id, recipient: adminId });
    await admin.delete(`/api/album/${id}`);
    const dump = await exportInstance(admin);
    assert.equal(dump.requests.find((r: any) => String(r.item) === id).status, 'cancelled');
  });

  it('carries the types and the requests through a collection backup', async () => {
    await bob.postForm('/requests', { type: 'gift', itemId: await idOf('Kind of Blue'), recipient: eveId, message: 'Between us' });
    const backup = (await admin.get('/backup/collection/export')).json();
    assert.deepEqual(backup.requestTypes.map((t: any) => t.slug), ['borrow', 'gift']);
    const gifts = backup.requests.filter((r: any) => r.visibility === 'private');
    assert.equal(gifts.find((r: any) => String(r.recipient) === eveId).message, '', 'a private request the admin is not part of keeps its words');
    assert.equal(gifts.find((r: any) => String(r.recipient) === adminId).message, 'Someday?', 'one the admin is part of goes whole');
    const reply = await admin.postJson('/backup/collection/import', backup);
    assert.equal(reply.status, 200, reply.text);
    const dump = await exportInstance(admin);
    assert.deepEqual(dump.requestTypes.map((t: any) => t.slug), ['borrow', 'gift']);
    const [away] = dump.requests.filter((r: any) => r.status === 'accepted');
    assert.equal(String(away.item), String(itemByTitle(dump, 'Abbey Road')._id), 'follows its item to its new id');
  });

  it('keeps one type per slug from a collection dump edited by hand', async () => {
    const backup = (await admin.get('/backup/collection/export')).json();
    backup.requestTypes.push({ ...backup.requestTypes[0], name: 'Copy' });
    const reply = await admin.postJson('/backup/collection/import', backup);
    assert.equal(reply.status, 200, reply.text);
    assert.deepEqual((await exportInstance(admin)).requestTypes.map((t: any) => t.slug), ['borrow', 'gift']);
  });

  it('leaves the types in place and no request behind when an instance dump goes into a collection', async () => {
    const instance = await exportInstance(admin);
    const reply = await admin.postJson('/backup/collection/import', instance);
    assert.equal(reply.status, 200, reply.text);
    const dump = await exportInstance(admin);
    assert.deepEqual(dump.requestTypes.map((t: any) => t.slug), ['borrow', 'gift']);
    const itemIds = new Set(dump.albums.map((a: any) => String(a._id)));
    assert.equal(dump.requests.filter((r: any) => !itemIds.has(String(r.item))).length, 0, 'no request about an item that is gone');
  });

  it('drops the requests of the replaced items when a dump carries none', async () => {
    await bob.postForm('/requests', { type: 'gift', itemId: await idOf('Kind of Blue'), recipient: eveId });
    const backup = (await admin.get('/backup/collection/export')).json();
    delete backup.requests;
    delete backup.requestTypes;
    const reply = await admin.postJson('/backup/collection/import', backup);
    assert.equal(reply.status, 200, reply.text);
    const dump = await exportInstance(admin);
    assert.deepEqual(dump.requestTypes.map((t: any) => t.slug), ['borrow', 'gift'], 'an older dump leaves the types in place');
    assert.equal(dump.requests.length, 0);
  });
});
