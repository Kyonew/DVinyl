import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { exportInstance, InstanceDump, login, setupAdmin } from './fixtures';

const backend = backendFor('invite_links');

const decode = (text: string) => text.replace(/&(amp|lt|gt|#34|#39);/g, (_, e) =>
  ({ amp: '&', lt: '<', gt: '>', '#34': '"', '#39': "'" } as Record<string, string>)[e]!);

// A token is dated to the second and refused when older than the account's last change.
const tick = () => new Promise(resolve => setTimeout(resolve, 1100));

/** The tokens of the invite links the members tab lists, in page order. */
function listedInvites(html: string): string[] {
  return [...html.matchAll(/data-copy-invite="[^"]*\/join\/([0-9a-f]{48})"/g)].map(m => m[1]!);
}

describe('invite links', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  const vinyl = (d: InstanceDump) => d.collections.find(c => c.name === 'Vinyl');
  const memberRole = (d: InstanceDump, username: string) => {
    const account = d.users.find(u => u.username === username);
    return vinyl(d).members.find((m: any) => String(m.user) === String(account?._id))?.role;
  };

  async function createInvite(role: string, days = 7): Promise<string> {
    const before = listedInvites((await admin.get('/admin')).text);
    const reply = await admin.postForm('/admin/members/invite-links/create', { role, days });
    assert.equal(reply.status, 302);
    assert.equal(reply.location, '/admin?msg=invite_link_created#members');
    const added = listedInvites((await admin.get('/admin')).text).filter(t => !before.includes(t));
    assert.equal(added.length, 1);
    return added[0]!;
  }

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
  });
  after(async () => { await app?.stop(); });

  it('lets a visitor create an account that joins the collection with the link role, once', async () => {
    const token = await createInvite('editor');
    const visitor = app.client();

    const page = await visitor.get(`/join/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Join Vinyl/);
    assert.match(page.text, /invited as Editor/);

    // A refused form leaves the link working.
    let reply = await visitor.postForm(`/join/${token}`, { username: 'newbie', email: 'newbie@example.test', password: 'secret1', password_confirm: 'other12' });
    assert.equal(reply.status, 400);
    assert.match(decode(reply.text), /The two passwords do not match/);
    reply = await visitor.postForm(`/join/${token}`, { username: 'ADMIN', email: 'newbie@example.test', password: 'secret1', password_confirm: 'secret1' });
    assert.equal(reply.status, 400);
    assert.match(decode(reply.text), /already uses this username/);
    reply = await visitor.postForm(`/join/${token}`, { username: 'newbie', email: 'newbie@example.test', password: 'abc', password_confirm: 'abc' });
    assert.equal(reply.status, 400);

    reply = await visitor.postForm(`/join/${token}`, { username: 'newbie', email: 'newbie@example.test', password: 'secret1', password_confirm: 'secret1' });
    assert.equal(reply.status, 302);
    assert.equal(reply.location, '/');
    assert.equal((await visitor.get('/collection')).status, 200);

    const dump = await exportInstance(admin);
    assert.equal(memberRole(dump, 'newbie'), 'editor');
    assert.deepEqual(vinyl(dump).inviteLinks, []);

    // The password chosen is the one that signs in.
    await login(app, 'newbie@example.test', 'secret1');

    // Used up: a second visitor gets the unavailable page.
    assert.equal((await app.client().get(`/join/${token}`)).status, 404);
    reply = await app.client().postForm(`/join/${token}`, { username: 'late', email: 'late@example.test', password: 'secret1', password_confirm: 'secret1' });
    assert.equal(reply.status, 404);
    assert.equal((await exportInstance(admin)).users.some(u => u.username === 'late'), false);
  });

  it('lets an account that already exists join with the link', async () => {
    const created = await admin.postForm('/admin/add-user', { username: 'outsider', email: 'outsider@example.test' });
    const password = decode(created.text.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)![1]!);
    await tick();
    const outsider = await login(app, 'outsider', password);
    assert.equal(memberRole(await exportInstance(admin), 'outsider'), undefined);

    const token = await createInvite('viewer', 1);
    const page = await outsider.get(`/join/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Signed in as outsider/);
    assert.doesNotMatch(page.text, /name="password_confirm"/);

    const reply = await outsider.postForm(`/join/${token}`, {});
    assert.equal(reply.status, 302);
    const dump = await exportInstance(admin);
    assert.equal(memberRole(dump, 'outsider'), 'viewer');
    assert.deepEqual(vinyl(dump).inviteLinks, []);
  });

  it('refuses unknown tokens, and a deleted link stops working', async () => {
    assert.equal((await app.client().get('/join/nope')).status, 404);
    assert.equal((await app.client().get(`/join/${'a'.repeat(48)}`)).status, 404);

    const token = await createInvite('admin', 30);
    const reply = await admin.postForm(`/admin/members/invite-links/${token}/delete`, {});
    assert.equal(reply.location, '/admin?msg=invite_link_deleted#members');
    assert.equal((await app.client().get(`/join/${token}`)).status, 404);
    assert.deepEqual(listedInvites((await admin.get('/admin')).text), []);
  });

  it('keeps invite links to collection admins', async () => {
    const created = await admin.postForm('/admin/members/create', { username: 'plain', email: 'plain@example.test', role: 'editor' });
    const password = decode(created.text.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)![1]!);
    await tick();
    const editor = await login(app, 'plain', password);
    const reply = await editor.postForm('/admin/members/invite-links/create', { role: 'admin', days: 30 });
    assert.notEqual(reply.location, '/admin?msg=invite_link_created#members');
    assert.deepEqual(vinyl(await exportInstance(admin)).inviteLinks, []);
  });
});
