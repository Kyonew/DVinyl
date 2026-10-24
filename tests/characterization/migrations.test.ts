import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { backendFor } from './backend';
import { App, startApp } from './sandbox';
import { Client } from './client';
import { exportInstance, InstanceDump, itemByTitle, login } from './fixtures';

const backend = backendFor('migrations');

// Hash of the fixtures' admin password.
const HASH = '$2b$10$G78cq0e0qnWb1BebNpnT5up.32b.R1tTKv29Et2QfIs22qNRJziyC';
const ADMIN_ID = '64e000000000000000000001';
const MEMBER_ID = '64e000000000000000000002';

/** A 2.x dump: one global settings object, no collections, everything a later version repairs. */
const LEGACY_DUMP = {
  users: [
    { _id: ADMIN_ID, username: 'old', email: 'old@example.test', password: HASH, isAdmin: true, discogsUsername: 'olddiscogs', lastChange: '2020-01-01T00:00:00.000Z' },
    { _id: MEMBER_ID, username: 'member', email: 'member@example.test', password: HASH, isAdmin: false, discogsUsername: '', lastChange: '2020-01-01T00:00:00.000Z' }
  ],
  settings: {
    siteName: 'Old DVinyl',
    modules: { music: true, dvd: true, books: true, games: false, lego: false, boardgames: false, advancedCD: true },
    theme: { music: { preset: { default: 'default' } } }
  },
  albums: [
    { _id: '64e000000000000000000010', title: 'The Wall', artist: 'Pink Floyd', media_type: 'vinyl', discogs_id: '1234', owner: ADMIN_ID, location: 'Shelf A', in_wishlist: false },
    { _id: '64e000000000000000000011', title: 'Animals', artist: 'Pink Floyd', media_type: 'vinyl', owner: ADMIN_ID, location: 'Shelf A', in_wishlist: false },
    { _id: '64e000000000000000000012', title: 'Meddle', artist: 'Pink Floyd', media_type: 'vinyl', owner: ADMIN_ID, location: 'shelf a', in_wishlist: false },
    { _id: '64e000000000000000000013', title: 'Nowhere', artist: 'Nobody', media_type: 'cd', owner: ADMIN_ID, location: '   ', in_wishlist: false },
    { _id: '64e000000000000000000014', kind: 'Dvd', title: 'Alien', director: 'Ridley Scott', format: 'dvd', owner: ADMIN_ID, in_wishlist: false },
    { _id: '64e000000000000000000015', kind: 'Book', title: 'Dune', author: 'Frank Herbert', format: 'paperback', source: 'goodreads', owner: ADMIN_ID, location: 'Bookcase', in_wishlist: false }
  ],
  metadata: { version: '2.6.0' }
};

describe('boot migrations on a restored 2.x instance', { skip: !backend }, () => {
  let app: App;
  let admin: Client;
  let dump: InstanceDump;

  before(async () => {
    app = await startApp(backend!);
    const reply = await app.client().postJson('/backup/import', LEGACY_DUMP);
    assert.equal(reply.status, 200, reply.text);
    admin = await login(app, 'old@example.test', 'Test1234*');
    dump = await exportInstance(admin);
  });
  after(async () => { await app?.stop(); });

  it('merges everything into one default collection everybody belongs to', async () => {
    assert.equal(dump.collections.length, 1);
    const [collection] = dump.collections;
    assert.equal(collection.isDefault, true);
    assert.deepEqual(collection.members.map((m: any) => [String(m.user), m.role]).sort(),
      [[ADMIN_ID, 'admin'], [MEMBER_ID, 'viewer']]);
    for (const user of dump.users) assert.equal(String(user.lastActiveCollectionId), String(collection._id));
    for (const item of dump.albums) assert.equal(String(item.collection), String(collection._id));
    assert.equal(itemByTitle(dump, 'The Wall').kind, 'Music');

    const member = await login(app, 'member', 'Test1234*');
    assert.equal((await member.get('/collection?limit=200')).status, 200);
  });

  it('attaches the global settings to that collection and moves retired options', async () => {
    assert.equal(dump.settings.length, 1);
    const [settings] = dump.settings;
    assert.equal(String(settings.collection), String(dump.collections[0]._id));
    assert.equal(settings.siteName, 'Old DVinyl');
    assert.equal(settings.modules.advancedCD, undefined);
    assert.equal(settings.pluginSettings.music.advancedCD, true);
    assert.equal(settings.theme.music.preset, 'default');
  });

  it('drops the retired Discogs username field of a restored account', async () => {
    // Current behaviour: the accounts are restored through their record rules, which no
    // longer declare `discogsUsername`, so the field is gone before the migration that
    // would move it under the music plugin gets to run. The boot migration itself only
    // moves the value on an instance upgraded in place.
    const old = dump.users.find(u => u.username === 'old');
    const member = dump.users.find(u => u.username === 'member');
    assert.equal(old.pluginData?.music?.discogsUsername, undefined);
    assert.ok(!('discogsUsername' in old));
    assert.ok(!('discogsUsername' in member));
  });

  it('repairs ids stored as text, missing media types and stray sources', async () => {
    const wall = itemByTitle(dump, 'The Wall');
    assert.equal(wall.discogs_id, 1234);
    assert.deepEqual([wall.source, wall.source_id], ['discogs', '1234']);
    assert.equal(itemByTitle(dump, 'Alien').media_type, 'movie');
    assert.equal(itemByTitle(dump, 'Dune').source, '');
    assert.equal(itemByTitle(dump, 'Animals').source ?? '', '');
  });

  it('turns free-text locations into shelves, keeping the most used spelling', async () => {
    assert.equal(itemByTitle(dump, 'Meddle').location, 'Shelf A');
    assert.equal(itemByTitle(dump, 'Nowhere').location, '');
    assert.deepEqual(
      dump.furniture.map(piece => piece.cells.map((c: any) => [c.name, c.key])),
      [[['Bookcase', 'bookcase'], ['Shelf A', 'shelf a']]]
    );
    assert.equal(dump.collections[0].shelvesSeeded, true);
  });

  it('changes nothing more on a second boot', async () => {
    app = await startAppOnSameStore(app);
    const again = await exportInstance(await login(app, 'old@example.test', 'Test1234*'));
    assert.deepEqual(strip(again), strip(dump));
  });
});

// A second app process on the same database, without resetting it.
async function startAppOnSameStore(_previous: App): Promise<App> {
  await _previous.stop();
  return startApp({ ...backend!, reset: async () => {} });
}

// Leaves out what a boot or a request writes on its own (login journal, stamps) to compare data.
function strip(dump: InstanceDump): any {
  // The instance settings singleton is created on the first request that reads it.
  const { logs, metadata, instanceSettings, ...rest } = dump as any;
  return JSON.parse(JSON.stringify(rest, (key, value) => (key === 'updated_at' || key === '__v' ? undefined : value)));
}
