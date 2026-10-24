import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { addMusic, exportInstance, itemByTitle, setupAdmin } from './fixtures';

const backend = backendFor('shelves_lists');

const cellsOf = (piece: any) => piece.cells.map((c: any) => [c.name, c.key, c.row, c.column]);

describe('shelves', { skip: !backend }, () => {
  let app: App;
  let admin: Client;

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
  });
  after(async () => { await app?.stop(); });

  it('files a typed location on a shelf, creating it once and keeping its first spelling', async () => {
    // A new location goes into the first piece with room left, which grows a row for it.
    await addMusic(admin, { title: 'One', artist: 'A', location: 'Shelf A' });
    await addMusic(admin, { title: 'Two', artist: 'A', location: '  shelf   A ' });
    await addMusic(admin, { title: 'Three', artist: 'A', location: 'Shelf B' });
    await addMusic(admin, { title: 'Loose', artist: 'A' });

    const dump = await exportInstance(admin);
    assert.equal(itemByTitle(dump, 'One').location, 'Shelf A');
    assert.equal(itemByTitle(dump, 'Two').location, 'Shelf A');
    assert.equal(itemByTitle(dump, 'Three').location, 'Shelf B');
    assert.equal(itemByTitle(dump, 'Loose').location, '');
    assert.deepEqual(
      dump.furniture.map(piece => [piece.name, piece.layout, piece.columns, piece.rows, piece.order, cellsOf(piece)]),
      [['Shelf A', 'cubes', 1, 2, 100, [['Shelf A', 'shelf a', 0, 0], ['Shelf B', 'shelf b', 1, 0]]]]
    );
  });

  it('builds furniture and lays its compartments out in reading order', async () => {
    let reply = await admin.postJson('/shelf/furniture', { name: ' Billy ', layout: 'rows' });
    assert.equal(reply.status, 200);
    const id = reply.json().id;
    assert.equal((await admin.postJson('/shelf/furniture', { name: '' })).status, 400);

    reply = await admin.postJson(`/shelf/furniture/${id}`, {
      name: 'Billy', layout: 'rows', columns: 2, cells: [{ name: 'Top' }, { name: 'Middle' }, { name: 'Bottom', capacity: 30 }]
    });
    assert.deepEqual(reply.json(), { success: true, renamed: 0, moved: 0 });

    const billy = (await exportInstance(admin)).furniture.find(piece => piece.name === 'Billy');
    assert.equal(billy.layout, 'rows');
    assert.equal(billy.columns, 2);
    assert.equal(billy.rows, 2, 'enough rows for the compartments, the default height kept');
    assert.deepEqual(cellsOf(billy), [['Top', 'top', 0, 0], ['Middle', 'middle', 0, 1], ['Bottom', 'bottom', 1, 0]]);
    assert.equal(billy.cells[2].capacity, 30);
  });

  it('refuses a compartment named twice, here or in another piece', async () => {
    const billy = (await exportInstance(admin)).furniture.find(piece => piece.name === 'Billy');
    let reply = await admin.postJson(`/shelf/furniture/${billy._id}`, { name: 'Billy', cells: [{ name: 'Top' }, { name: 'TOP' }] });
    assert.equal(reply.status, 409);
    assert.equal(reply.json().error, 'duplicate_shelf');
    reply = await admin.postJson(`/shelf/furniture/${billy._id}`, { name: 'Billy', cells: [{ name: 'shelf a' }] });
    assert.equal(reply.status, 409);
    assert.deepEqual(reply.json(), { success: false, error: 'shelf_elsewhere', furniture: 'Shelf A' });
  });

  it('moves items onto a shelf and follows a renamed compartment', async () => {
    let dump = await exportInstance(admin);
    const ids = ['One', 'Loose'].map(title => String(itemByTitle(dump, title)._id));
    let reply = await admin.postJson('/shelf/move', { ids: [...ids, 'bogus'], location: 'top' });
    assert.deepEqual(reply.json(), { success: true, moved: 2, matched: 2, location: 'Top' });

    const billy = dump.furniture.find(piece => piece.name === 'Billy');
    reply = await admin.postJson(`/shelf/furniture/${billy._id}`, {
      name: 'Billy', columns: 2,
      cells: [{ name: 'Upper', from: 'top' }, { name: 'Middle', from: 'middle' }, { name: 'Bottom', from: 'bottom', capacity: 30 }]
    });
    assert.deepEqual(reply.json(), { success: true, renamed: 1, moved: 2 });

    dump = await exportInstance(admin);
    assert.equal(itemByTitle(dump, 'One').location, 'Upper');
    assert.equal(itemByTitle(dump, 'Loose').location, 'Upper');
    assert.equal(itemByTitle(dump, 'Two').location, 'Shelf A');
  });

  it('carries a compartment over to another piece and deletes furniture without touching items', async () => {
    let dump = await exportInstance(admin);
    const shelfA = dump.furniture.find(piece => piece.name === 'Shelf A');
    const billy = dump.furniture.find(piece => piece.name === 'Billy');

    let reply = await admin.postJson('/shelf/cell/move', { key: 'Upper', to: String(shelfA._id) });
    assert.deepEqual(reply.json(), { success: true, moved: true });
    dump = await exportInstance(admin);
    assert.deepEqual(cellsOf(dump.furniture.find(piece => piece.name === 'Shelf A')),
      [['Shelf A', 'shelf a', 0, 0], ['Shelf B', 'shelf b', 1, 0], ['Upper', 'upper', 2, 0]]);
    assert.deepEqual(cellsOf(dump.furniture.find(piece => piece.name === 'Billy')),
      [['Middle', 'middle', 0, 0], ['Bottom', 'bottom', 0, 1]]);

    reply = await admin.postJson(`/shelf/furniture/${shelfA._id}/delete`, {});
    assert.deepEqual(reply.json(), { success: true });
    dump = await exportInstance(admin);
    assert.ok(!dump.furniture.some(piece => piece.name === 'Shelf A'));
    assert.ok(dump.furniture.some(piece => String(piece._id) === String(billy._id)));
    assert.equal(itemByTitle(dump, 'One').location, 'Upper', 'items keep their location');
  });
});

describe('lists', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  const ids: Record<string, string> = {};

  before(async () => {
    app = await startApp(backend!);
    admin = await setupAdmin(app);
    for (const title of ['Alpha', 'Beta', 'Gamma']) await addMusic(admin, { title, artist: 'X' });
    await addMusic(admin, {
      title: 'With Tracks', artist: 'Y',
      tracklist_json: JSON.stringify([{ position: 'A1', title: 'Opening', duration: '3:00' }, { position: 'A2', title: 'Closing', duration: '4:00' }])
    });
    for (const item of (await exportInstance(admin)).albums) ids[item.title] = String(item._id);
  });
  after(async () => { await app?.stop(); });

  const listNamed = async (name: string) => (await exportInstance(admin)).lists.find(list => list.name === name);

  it('creates a list and adds each item once, ignoring unknown ids', async () => {
    let reply = await admin.postJson('/lists', { name: '  Favourites ', description: 'Best ones' });
    const { list } = reply.json();
    assert.deepEqual({ ...list, id: undefined }, { id: undefined, name: 'Favourites', kind: 'items', count: 0 });
    assert.equal((await admin.postJson('/lists', { name: '' })).status, 400);

    reply = await admin.postJson(`/api/lists/${list.id}/add`, {
      items: [ids.Alpha, ids.Beta, ids.Alpha, '0123456789abcdef01234567', 'nope']
    });
    assert.deepEqual(reply.json(), { success: true, added: 2, count: 2 });
    reply = await admin.postJson(`/api/lists/${list.id}/add`, { items: [ids.Beta, ids.Gamma] });
    assert.deepEqual(reply.json(), { success: true, added: 1, count: 3 });

    const stored = await listNamed('Favourites');
    assert.equal(stored.kind, 'items');
    assert.equal(stored.description, 'Best ones');
    assert.deepEqual(stored.entries.map((e: any) => String(e.item)), [ids.Alpha, ids.Beta, ids.Gamma]);

    reply = await admin.get(`/api/lists?item=${ids.Beta}`);
    assert.deepEqual(reply.json(), { success: true, lists: [{ id: list.id, name: 'Favourites', count: 3, contains: true }] });
  });

  it('reorders by entry id and refuses a stale order', async () => {
    const stored = await listNamed('Favourites');
    const entryIds = stored.entries.map((e: any) => String(e._id));
    let reply = await admin.postJson(`/api/lists/${stored._id}/reorder`, { order: [...entryIds].reverse() });
    assert.deepEqual(reply.json(), { success: true });
    assert.deepEqual((await listNamed('Favourites')).entries.map((e: any) => String(e.item)), [ids.Gamma, ids.Beta, ids.Alpha]);
    assert.deepEqual((await listNamed('Favourites')).entries.map((e: any) => String(e._id)), [...entryIds].reverse(),
      'entries keep their own ids through a reorder');

    reply = await admin.postJson(`/api/lists/${stored._id}/reorder`, { order: entryIds.slice(1) });
    assert.equal(reply.status, 409);
  });

  it('removes an entry, and drops a deleted item from every list', async () => {
    const stored = await listNamed('Favourites');
    let reply = await admin.postJson(`/api/lists/${stored._id}/remove`, { item: ids.Beta });
    assert.deepEqual(reply.json(), { success: true });
    await admin.delete(`/api/album/${ids.Gamma}`);
    assert.deepEqual((await listNamed('Favourites')).entries.map((e: any) => String(e.item)), [ids.Alpha]);
  });

  it('keeps track lists apart and points at tracks by their own id', async () => {
    const reply = await admin.postJson('/lists', { name: 'Mixtape', kind: 'tracks' });
    const { list } = reply.json();
    assert.equal(list.kind, 'tracks');

    const tracks = (await exportInstance(admin)).albums.find(item => item.title === 'With Tracks').tracklist;
    assert.deepEqual(tracks.map((t: any) => [t.position, t.title, t.duration]), [['A1', 'Opening', '3:00'], ['A2', 'Closing', '4:00']]);
    assert.ok(tracks.every((t: any) => /^[0-9a-f]{24}$/.test(String(t._id))), 'tracks get their own id');

    let added = await admin.postJson(`/api/lists/${list.id}/add`, { item: ids['With Tracks'], track: String(tracks[1]._id) });
    assert.deepEqual(added.json(), { success: true, added: 1, count: 1 });
    added = await admin.postJson(`/api/lists/${list.id}/add`, { item: ids['With Tracks'], track: String(tracks[1]._id) });
    assert.deepEqual(added.json(), { success: true, added: 0, count: 1 });

    const listing = await admin.get(`/api/lists?kind=tracks&item=${ids['With Tracks']}&track=${tracks[1]._id}`);
    assert.deepEqual(listing.json().lists.map((l: any) => [l.name, l.count, l.contains]), [['Mixtape', 1, true]]);
    const items = await admin.get('/api/lists');
    assert.deepEqual(items.json().lists.map((l: any) => l.name), ['Favourites']);
  });

  it('deletes a list', async () => {
    const stored = await listNamed('Mixtape');
    const reply = await admin.postForm(`/lists/${stored._id}/delete`, {});
    assert.equal(reply.location, '/lists');
    assert.equal(await listNamed('Mixtape'), undefined);
  });
});
