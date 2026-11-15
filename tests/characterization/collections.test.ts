import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import {
  addMusic, enableModules, exportInstance, InstanceDump, itemByTitle, listedTitles, login, saveItem, setupAdmin, titles
} from './fixtures';

const backend = backendFor('collections');

describe('collections, members and sharing', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  const collectionNamed = (dump: InstanceDump, name: string) => {
    const found = dump.collections.find(collection => collection.name === name);
    assert.ok(found, `no collection named ${name}`);
    return found;
  };
  const shownBy = async (client: Client, path = '/collection?limit=200&sort=title_asc') =>
    listedTitles((await client.get(path)).text, await exportInstance(admin));
  const switchTo = (client: Client, collectionId: string) =>
    client.postForm('/collection/switch', { collectionId, redirectTo: '/collection' });

  /** Creates a member of the active collection and signs them in with the password shown once. */
  const createMember = async (username: string, role: string) => {
    const reply = await admin.postForm('/admin/members/create', { username, email: `${username}@example.test`, role });
    assert.equal(reply.status, 200);
    const shown = reply.text.match(/<code class="text-xl[^"]*">([^<]+)<\/code>/)?.[1];
    assert.ok(shown, 'the new password is shown once on the admin page');
    const password = shown.replace(/&(amp|lt|gt|#34|#39);/g, (_, entity) =>
      ({ amp: '&', lt: '<', gt: '>', '#34': '"', '#39': "'" } as Record<string, string>)[entity]!);
    // A token is dated to the second, and one dated before the account's last change is
    // refused: give the clock a second to move past the creation.
    await new Promise(resolve => setTimeout(resolve, 1100));
    return login(app, `${username}@example.test`, password);
  };

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    await addMusic(admin, { title: 'Kind of Blue', artist: 'Miles Davis', genres: 'Jazz', location: 'Shelf A' });
    await addMusic(admin, { title: 'Abbey Road', artist: 'The Beatles', genres: 'Rock', media_type: 'cd' });
    await addMusic(admin, { title: 'The Wall', artist: 'Pink Floyd', genres: 'Rock' });
    await addMusic(admin, { title: 'Blue Train', artist: 'John Coltrane', genres: 'Jazz', in_wishlist: 'true' });
  });
  after(async () => { await app?.stop(); });

  it('creates a collection with its own items and settings', async () => {
    const reply = await admin.postForm('/admin/collections/create', { name: 'Second Shelf' });
    assert.equal(reply.location, '/admin/instance?msg=collection_created');

    let dump = await exportInstance(admin);
    const second = collectionNamed(dump, 'Second Shelf');
    assert.equal(second.slug, 'second-shelf');
    assert.equal(second.isDefault, false);
    assert.deepEqual(second.members.map((m: any) => [String(m.user), m.role]), [[String(dump.users[0]._id), 'admin']]);

    const switched = await switchTo(admin, String(second._id));
    assert.equal(switched.location, '/collection');
    await enableModules(admin, ['music', 'books']);
    await addMusic(admin, { title: 'Nevermind', artist: 'Nirvana' });

    assert.deepEqual(await shownBy(admin), ['Nevermind']);
    dump = await exportInstance(admin);
    assert.equal(String(itemByTitle(dump, 'Nevermind').collection), String(second._id));

    const modulesOf = (name: string) =>
      dump.settings.find(s => String(s.collection) === String(collectionNamed(dump, name)._id))?.modules;
    assert.equal(modulesOf('Second Shelf').books, true);
    assert.equal(modulesOf('Vinyl').books, false);
  });

  it('never reaches an item of another collection', async () => {
    const dump = await exportInstance(admin);
    const vinylItem = itemByTitle(dump, 'Kind of Blue');

    let reply = await saveItem(admin, 'music', {
      mongo_id: String(vinylItem._id), title: 'Hijacked', artist: 'x', media_type: 'vinyl', tracklist_json: '[]'
    });
    assert.equal(reply.status, 404);
    reply = await admin.delete(`/api/album/${vinylItem._id}`);
    assert.equal(reply.status, 404);
    reply = await admin.get(`/album/${vinylItem._id}`);
    assert.notEqual(reply.status, 200);
    assert.ok(titles(await exportInstance(admin)).includes('Kind of Blue'));

    await switchTo(admin, String(collectionNamed(dump, 'Vinyl')._id));
    assert.deepEqual(await shownBy(admin), ['Abbey Road', 'Kind of Blue', 'The Wall']);
  });

  it('lets a viewer browse but not change anything', async () => {
    const viewer = await createMember('viewer1', 'viewer');
    assert.deepEqual(await shownBy(viewer), ['Abbey Road', 'Kind of Blue', 'The Wall']);

    const reply = await addMusic(viewer, { title: 'Sneaked In', artist: 'Viewer' });
    assert.equal(reply.location, '/');
    const removal = await viewer.delete(`/api/album/${itemByTitle(await exportInstance(admin), 'The Wall')._id}`);
    assert.equal(removal.status, 302);
    const dump = await exportInstance(admin);
    assert.ok(!titles(dump).includes('Sneaked In'));
    assert.ok(titles(dump).includes('The Wall'));

    // Not a member of the second collection: switching there is ignored.
    await switchTo(viewer, String(collectionNamed(dump, 'Second Shelf')._id));
    assert.deepEqual(await shownBy(viewer), ['Abbey Road', 'Kind of Blue', 'The Wall']);
  });

  it('lets an editor add items but not manage the collection', async () => {
    const editor = await createMember('editor1', 'editor');
    await addMusic(editor, { title: 'Ten', artist: 'Pearl Jam' });
    const dump = await exportInstance(admin);
    assert.equal(String(itemByTitle(dump, 'Ten').owner), String(dump.users.find(u => u.username === 'editor1')._id));

    const reply = await editor.postForm('/admin/modules/save', { musicActive: 'on', booksActive: 'on' });
    assert.equal(reply.location, '/');
    const vinyl = collectionNamed(await exportInstance(admin), 'Vinyl');
    const settings = (await exportInstance(admin)).settings.find(s => String(s.collection) === String(vinyl._id));
    assert.equal(settings.modules.books, false);
  });

  it('changes and removes roles, keeping the last admin in place', async () => {
    let dump = await exportInstance(admin);
    const editorId = String(dump.users.find(u => u.username === 'editor1')._id);
    const adminId = String(dump.users.find(u => u.username === 'admin')._id);

    let reply = await admin.postForm('/admin/members/role', { userId: editorId, role: 'viewer' });
    assert.equal(reply.location, '/admin?msg=member_role_updated');
    reply = await admin.postForm('/admin/members/role', { userId: adminId, role: 'viewer' });
    assert.equal(reply.location, '/admin?msg=error_self_role');
    reply = await admin.postForm('/admin/members/remove', { userId: adminId });
    assert.equal(reply.location, '/admin?msg=error_last_admin');

    dump = await exportInstance(admin);
    const roles = Object.fromEntries(collectionNamed(dump, 'Vinyl').members.map((m: any) => [
      dump.users.find(u => String(u._id) === String(m.user)).username, m.role
    ]));
    assert.deepEqual(roles, { admin: 'admin', viewer1: 'viewer', editor1: 'viewer' });

    reply = await admin.postForm('/admin/members/remove', { userId: editorId });
    assert.equal(reply.location, '/admin?msg=member_removed');
    dump = await exportInstance(admin);
    assert.ok(!collectionNamed(dump, 'Vinyl').members.some((m: any) => String(m.user) === editorId));
    assert.ok(dump.users.some(u => u.username === 'editor1'), 'removing a member keeps the account');
  });

  it('deletes an account and its memberships', async () => {
    let dump = await exportInstance(admin);
    const viewerId = String(dump.users.find(u => u.username === 'viewer1')._id);
    const reply = await admin.postForm('/admin/delete-user', { userId: viewerId });
    assert.equal(reply.location, '/admin/instance?msg=user_deleted');
    dump = await exportInstance(admin);
    assert.ok(!dump.users.some(u => u.username === 'viewer1'));
    for (const collection of dump.collections) {
      assert.ok(!collection.members.some((m: any) => String(m.user) === viewerId));
    }
  });

  it('hides genres from members but not from the admin', async () => {
    const viewer = await createMember('viewer2', 'viewer');
    await admin.postForm('/admin/visibility/save', { hiddenGenres: 'Jazz' });
    assert.deepEqual(await shownBy(viewer), ['Abbey Road', 'Ten', 'The Wall']);
    assert.deepEqual(await shownBy(admin), ['Abbey Road', 'Kind of Blue', 'Ten', 'The Wall']);

    await admin.postForm('/admin/visibility/save', { hiddenGenres: 'Jazz', applyToAdmin: 'on' });
    assert.deepEqual(await shownBy(admin), ['Abbey Road', 'Ten', 'The Wall']);
    await admin.postForm('/admin/visibility/save', {});
    assert.deepEqual(await shownBy(viewer), ['Abbey Road', 'Kind of Blue', 'Ten', 'The Wall']);
  });

  it('shows the collection through a share link, scoped to what the link allows', async () => {
    let reply = await admin.postForm('/admin/share/create', { label: 'Everything' });
    assert.equal(reply.location, '/admin/sharing?msg=share_link_created');
    reply = await admin.postForm('/admin/share/create', { label: 'CDs', scopeTypes: 'music', scopeFormats_music: 'cd' });

    const links = collectionNamed(await exportInstance(admin), 'Vinyl').shareLinks;
    const scopeOf = (link: any) => link.scope.map(({ pluginId, formats }: any) => ({ pluginId, formats }));
    assert.deepEqual(links.map((l: any) => [l.label, l.enabled, scopeOf(l)]), [
      ['Everything', true, []],
      ['CDs', true, [{ pluginId: 'music', formats: ['cd'] }]]
    ]);
    assert.equal(new Set(links.map((l: any) => l.token)).size, 2);

    const visitor = app.client();
    reply = await visitor.get(`/share/${links[0].token}`);
    assert.equal(reply.location, '/collection');
    assert.deepEqual(await shownBy(visitor), ['Abbey Road', 'Kind of Blue', 'Ten', 'The Wall']);

    const cdVisitor = app.client();
    await cdVisitor.get(`/share/${links[1].token}`);
    assert.deepEqual(await shownBy(cdVisitor), ['Abbey Road']);

    reply = await app.client().get('/share/not-a-token');
    assert.equal(reply.status, 404);
  });
});
