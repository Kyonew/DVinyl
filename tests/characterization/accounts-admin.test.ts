import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { ADMIN, addMusic, exportInstance, InstanceDump, itemByTitle, login, saveItem, setupAdmin, titles } from './fixtures';

const backend = backendFor('accounts_admin');

const decode = (text: string) => text.replace(/&(amp|lt|gt|#34|#39);/g, (_, e) =>
  ({ amp: '&', lt: '<', gt: '>', '#34': '"', '#39': "'" } as Record<string, string>)[e]!);

/** The one-time password an admin page shows after creating or resetting an account. */
function shownPassword(html: string): string {
  const shown = html.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)?.[1];
  assert.ok(shown, 'a one-time password is shown');
  return decode(shown);
}

// A token is dated to the second and refused when older than the account's last change.
const tick = () => new Promise(resolve => setTimeout(resolve, 1100));

describe('accounts and administration', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let dump: InstanceDump;

  const userNamed = (d: InstanceDump, username: string) => d.users.find(u => u.username === username);
  const collectionNamed = (d: InstanceDump, name: string) => d.collections.find(c => c.name === name);
  const refresh = async () => { dump = await exportInstance(admin); return dump; };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, { title: 'Alpha', artist: 'One', barcode: '111' });
    await addMusic(admin, { title: 'Beta', artist: 'Two', tracklist_json: JSON.stringify([{ position: '1', title: 'Hidden Track' }]) });
    await refresh();
  });
  after(async () => { await app?.stop(); });

  it('signs in with the email or the username and logs each sign-in', async () => {
    const byName = await login(app, ADMIN.username, ADMIN.password);
    assert.equal((await byName.get('/collection')).status, 200);
    let reply = await app.client().postJson('/login', { email: ADMIN.email, password: 'wrong' });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.json(), { errors: { login: 'Invalid credentials' } });
    reply = await app.client().postJson('/login', { email: 'nobody@example.test', password: 'x' });
    assert.equal(reply.status, 400);

    const logs = (await refresh()).logs;
    assert.equal(logs.length, 1);
    assert.deepEqual([logs[0].username, logs[0].email, logs[0].status], [ADMIN.username, ADMIN.email, 'success']);
  });

  it('lets an account change its own name, theme, language and currency', async () => {
    const viewerPage = await admin.postForm('/admin/members/create', { username: 'taken', email: 'taken@example.test', role: 'viewer' });
    assert.equal(viewerPage.status, 200);

    assert.equal((await admin.postJson('/settings/check-username', { username: 'admin' })).json().success, true);
    assert.equal((await admin.postJson('/settings/check-username', { username: 'taken' })).status, 400);
    assert.equal((await admin.postJson('/settings/check-username', { username: 'free' })).json().success, true);
    assert.equal((await admin.postForm('/settings/update-username', { username: 'taken' })).status, 400);

    assert.deepEqual((await admin.postJson('/settings/update-theme', { theme: 'light' })).json().success, true);
    assert.equal((await admin.postJson('/settings/update-theme', { theme: 'purple' })).status, 400);
    await admin.postForm('/settings/update-language', { language: 'fr' });
    await admin.postForm('/settings/update-currency', { currency: 'EUR' });
    assert.equal((await admin.postForm('/settings/update-currency', { currency: 'XYZ' })).status, 400);

    const me = userNamed(await refresh(), 'admin');
    assert.deepEqual([me.theme, me.language, me.currency], ['light', 'fr', 'EUR']);
    await admin.postForm('/settings/update-language', { language: 'en' });
  });

  it('sets the home collection only to one the account belongs to', async () => {
    const vinyl = collectionNamed(dump, 'Vinyl');
    let reply = await admin.postForm('/settings/update-home', { homeCollectionId: String(vinyl._id), homePage: 'collection', homeView: '' });
    assert.equal(reply.status, 302);
    let me = userNamed(await refresh(), 'admin');
    assert.equal(String(me.homeCollectionId), String(vinyl._id));
    assert.equal(me.homePage, 'collection');

    reply = await admin.postForm('/settings/update-home', { homeCollectionId: '0123456789abcdef01234567', homePage: 'dashboard' });
    assert.equal(reply.location, '/settings');
    me = userNamed(await refresh(), 'admin');
    assert.equal(me.homePage, 'collection', 'a collection the account is not in changes nothing');
  });

  it('manages the members of any collection from the instance page', async () => {
    await admin.postForm('/admin/collections/create', { name: 'Second' });
    const second = collectionNamed(await refresh(), 'Second');
    const taken = userNamed(dump, 'taken');

    let reply = await admin.postForm(`/admin/collections/${second._id}/rename`, { name: 'Second Shelf' });
    assert.equal(reply.location, '/admin/instance?msg=collection_renamed');

    reply = await admin.postForm(`/admin/instance/collections/${second._id}/members/add`, { userId: String(taken._id), role: 'editor' });
    assert.equal(reply.location, '/admin/instance?msg=member_added');
    reply = await admin.postForm(`/admin/instance/collections/${second._id}/members/add`, { userId: String(taken._id), role: 'editor' });
    assert.equal(reply.location, '/admin/instance?msg=error_member_exists');
    await admin.postForm(`/admin/instance/collections/${second._id}/members/role`, { userId: String(taken._id), role: 'admin' });

    let shelf = collectionNamed(await refresh(), 'Second Shelf');
    assert.deepEqual(shelf.members.map((m: any) => [String(m.user), m.role]).sort(),
      [[String(userNamed(dump, 'admin')._id), 'admin'], [String(taken._id), 'admin']].sort());

    await admin.postForm('/admin/users/home-collection', { userId: String(taken._id), collectionId: String(second._id) });
    assert.equal(String(userNamed(await refresh(), 'taken').homeCollectionId), String(second._id));

    reply = await admin.postForm(`/admin/instance/collections/${second._id}/members/remove`, { userId: String(taken._id) });
    assert.equal(reply.location, '/admin/instance?msg=member_removed');
    shelf = collectionNamed(await refresh(), 'Second Shelf');
    assert.ok(!shelf.members.some((m: any) => String(m.user) === String(taken._id)));
    assert.equal(userNamed(dump, 'taken').homeCollectionId ?? null, null, 'a removed member loses that home');
  });

  it('invites an existing account into the active collection', async () => {
    const taken = userNamed(dump, 'taken');
    let reply = await admin.postForm('/admin/members/invite', { identifier: 'TAKEN@example.test', role: 'editor' });
    assert.equal(reply.location, '/admin?msg=error_member_exists', 'already a viewer here');
    await admin.postForm('/admin/members/remove', { userId: String(taken._id) });
    reply = await admin.postForm('/admin/members/invite', { identifier: 'taken', role: 'editor' });
    assert.equal(reply.location, '/admin?msg=member_added');
    reply = await admin.postForm('/admin/members/invite', { identifier: 'ghost' });
    assert.equal(reply.location, '/admin?msg=error_member_not_found');
    const vinyl = collectionNamed(await refresh(), 'Vinyl');
    assert.equal(vinyl.members.find((m: any) => String(m.user) === String(taken._id)).role, 'editor');
  });

  it('resets a member password, which then signs in', async () => {
    const taken = userNamed(dump, 'taken');
    const page = await admin.postForm('/admin/members/reset-password', { userId: String(taken._id) });
    assert.equal(page.status, 200);
    const password = shownPassword(page.text);
    await tick();
    await login(app, 'taken@example.test', password);

    const instancePage = await admin.postForm('/admin/reset-password', { userId: String(taken._id) });
    const second = shownPassword(instancePage.text);
    await tick();
    await login(app, 'taken', second);
  });

  it('refuses a second account with a name or an email already taken', async () => {
    let reply = await admin.postForm('/admin/add-user', { username: 'taken', email: 'other@example.test' });
    assert.equal(reply.location, '/admin/instance?msg=error_username_taken');
    reply = await admin.postForm('/admin/add-user', { username: 'someone', email: 'TAKEN@example.test' });
    assert.equal(reply.location, '/admin/instance?msg=error_email_taken');
    reply = await admin.postForm('/admin/add-user', { username: 'someone', email: 'not-an-email' });
    assert.equal(reply.location, '/admin/instance?msg=error_user_invalid');
    const names = (await refresh()).users.map(u => u.username);
    assert.equal(names.filter(n => n === 'taken').length, 1);
    assert.ok(!names.includes('someone'));
  });

  it('lets an account change its own password', async () => {
    const page = await admin.postForm('/admin/add-user', { username: 'mover', email: 'mover@example.test' });
    const first = shownPassword(page.text);
    await tick();
    const mover = await login(app, 'mover', first);
    let reply = await mover.postJson('/settings/update-password', { currentPassword: 'nope', newPassword: 'Another1!' });
    assert.equal(reply.status, 400);
    reply = await mover.postJson('/settings/update-password', { currentPassword: first, newPassword: 'Another1!' });
    assert.equal(reply.json().success, true);
    await tick();
    await login(app, 'mover', 'Another1!');
  });

  it('blocks and unblocks addresses, and trims the sign-in log', async () => {
    await admin.postForm('/admin/block-ip', { ipAddress: '10.1.2.3' });
    await admin.postForm('/admin/block-ip', { ipAddress: '10.1.2.3' });
    const blocked = (await refresh()) && (await admin.get('/admin/instance')).text;
    assert.match(blocked, /10\.1\.2\.3/);
    const ipId = blocked.match(/name="ipId" value="([0-9a-f]{24})"/)?.[1];
    assert.ok(ipId, 'the blocked address can be lifted');
    assert.equal((blocked.match(/name="ipId" value="/g) || []).length, 1, 'blocking twice keeps one entry');
    await admin.postForm('/admin/unblock-ip', { ipId: ipId! });
    assert.doesNotMatch((await admin.get('/admin/instance')).text, /name="ipId" value="/);

    const before = (await refresh()).logs.length;
    const reply = await admin.postJson('/admin/delete-last-logs', { count: 2 });
    assert.deepEqual(reply.json(), { deleted: 2 });
    assert.equal((await refresh()).logs.length, before - 2);
  });

  it('finds items for the hide list by title, creator, barcode, track or id', async () => {
    const find = async (q: string) =>
      (await admin.get(`/admin/api/search-collection?q=${encodeURIComponent(q)}`)).json().map((i: any) => i.title).sort();
    assert.deepEqual(await find('alp'), ['Alpha']);
    assert.deepEqual(await find('two'), ['Beta']);
    assert.deepEqual(await find('111'), ['Alpha']);
    assert.deepEqual(await find('hidden track'), ['Beta']);
    assert.deepEqual(await find(String(itemByTitle(dump, 'Beta')._id)), ['Beta']);
  });

  it('edits share links: toggle, scope, new token, removal, QR code', async () => {
    await admin.postForm('/admin/share/create', { label: 'First' });
    let link = collectionNamed(await refresh(), 'Vinyl').shareLinks[0];
    let reply = await admin.postForm(`/admin/share/${link.token}/toggle`, {});
    assert.equal(reply.location, '/admin/sharing?msg=share_disabled');
    assert.equal(collectionNamed(await refresh(), 'Vinyl').shareLinks[0].enabled, false);
    assert.equal((await admin.get(`/admin/share/${link.token}/qr.png`)).status, 404, 'no code for a disabled link');

    reply = await admin.postForm(`/admin/share/${link.token}/scope`, { label: 'CDs only', scopeTypes: 'music', scopeFormats_music: 'cd' });
    assert.equal(reply.location, '/admin/sharing?msg=share_scope_updated');
    reply = await admin.postForm(`/admin/share/${link.token}/regenerate`, {});
    assert.equal(reply.location, '/admin/sharing?msg=share_regenerated');
    const renewed = collectionNamed(await refresh(), 'Vinyl').shareLinks[0];
    assert.notEqual(renewed.token, link.token);
    assert.deepEqual([renewed.label, renewed.enabled, renewed.scope.map((s: any) => [s.pluginId, s.formats])],
      ['CDs only', true, [['music', ['cd']]]]);
    assert.equal((await admin.get(`/admin/share/${renewed.token}/qr.png`)).status, 200);

    assert.equal((await admin.postForm(`/admin/share/${link.token}/toggle`, {})).location, '/admin/sharing?msg=error_share');
    reply = await admin.postForm(`/admin/share/${renewed.token}/delete`, {});
    assert.equal(reply.location, '/admin/sharing?msg=share_link_deleted');
    assert.deepEqual(collectionNamed(await refresh(), 'Vinyl').shareLinks, []);
    link = renewed;
    assert.equal((await admin.postForm(`/admin/share/${link.token}/delete`, {})).location, '/admin/sharing?msg=error_share');
  });

  it('saves the info page and the look of the collection', async () => {
    let reply = await admin.postForm('/admin/collection-info', { enabled: 'on', title: '  Welcome  ', body: 'Our records' });
    assert.equal(reply.status, 302);
    const info = collectionNamed(await refresh(), 'Vinyl').info;
    assert.deepEqual([info.enabled, info.shareVisible, info.title, info.body], [true, false, 'Welcome', 'Our records']);
    assert.ok(info.updated_at);

    reply = await admin.postForm('/admin/personnalisation/save', {
      navbarShortcuts: ['global_home', 'global_wishlist'], statsWidgets: 'total', aspectRatioClass: 'aspect-square', fastAdd: ''
    });
    assert.equal(reply.location, '/admin/personnalisation?msg=saved');
    const settings = dump.settings.find(s => String(s.collection) === String(collectionNamed(dump, 'Vinyl')._id));
    const saved = (await refresh()).settings.find(s => String(s.collection) === String(settings.collection));
    assert.deepEqual([saved.navbarShortcuts, saved.statsWidgets], [['global_home', 'global_wishlist'], ['total']]);
  });

  it('lets members create collections within the instance quota', async () => {
    const page = await admin.postForm('/admin/add-user', { username: 'maker', email: 'maker@example.test' });
    const password = shownPassword(page.text);
    await tick();
    const maker = await login(app, 'maker', password);

    let reply = await maker.postForm('/collection/create', { name: 'Mine' });
    assert.equal(reply.location, '/?msg=error_collection_forbidden');
    await admin.postForm('/admin/instance/settings', { allowMemberCollectionCreation: 'on', maxCollectionsPerUser: '1' });
    reply = await maker.postForm('/collection/create', { name: 'Mine' });
    assert.equal(reply.location, '/?msg=collection_created');
    reply = await maker.postForm('/collection/create', { name: 'Another' });
    assert.equal(reply.location, '/?msg=error_collection_quota');

    const mine = collectionNamed(await refresh(), 'Mine');
    assert.equal(String(mine.createdBy), String(userNamed(dump, 'maker')._id));
    assert.equal(String(userNamed(dump, 'maker').lastActiveCollectionId), String(mine._id));
  });

  it('deletes a collection with its items and settings, never the default one', async () => {
    const vinyl = collectionNamed(dump, 'Vinyl');
    let reply = await admin.postForm(`/admin/collections/${vinyl._id}/delete`, {});
    assert.equal(reply.location, '/admin/instance?msg=error_delete_default_collection');

    const mine = collectionNamed(dump, 'Mine');
    const maker = userNamed(dump, 'maker');
    await admin.postForm('/collection/switch', { collectionId: String(collectionNamed(dump, 'Second Shelf')._id) });
    await addMusic(admin, { title: 'On Second', artist: 'X' });
    const second = collectionNamed(await refresh(), 'Second Shelf');
    await admin.postForm('/collection/switch', { collectionId: String(vinyl._id) });
    reply = await admin.postForm(`/admin/collections/${second._id}/delete`, {});
    assert.equal(reply.location, '/admin/instance?msg=collection_deleted');

    await refresh();
    assert.ok(!collectionNamed(dump, 'Second Shelf'));
    assert.ok(!titles(dump).includes('On Second'));
    assert.ok(!dump.settings.some(s => String(s.collection) === String(second._id)));
    assert.ok(collectionNamed(dump, 'Mine'), 'other collections stay');
    assert.equal(String(userNamed(dump, 'maker').lastActiveCollectionId), String(mine._id));
    assert.ok(maker);
  });

  it('removes the most recent items of a type in bulk', async () => {
    await saveItem(admin, 'music', { title: 'Newest', artist: 'Z', media_type: 'vinyl', tracklist_json: '[]', added_at: '2099-01-01T00:00:00.000Z' });
    const reply = await admin.postJson('/admin/delete-last-items', { count: 1, kind: 'Music' });
    assert.deepEqual(reply.json(), { deleted: 1 });
    assert.ok(!titles(await refresh()).includes('Newest'));
    assert.equal((await admin.postJson('/admin/delete-last-items', { count: 1, kind: 'Nope' })).status, 400);
  });
});
