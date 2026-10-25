import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { mongoBackend, sqliteBackend } from './backend';
import { App, startApp } from './sandbox';
import { ADMIN, addMusic, exportInstance, InstanceDump, login, normalizeDump, seedEverything, titles } from './fixtures';

// An install upgraded from a version before 4.0: its data sits on a MongoDB server, and
// its first boot on SQLite moves it over. Needs that server (TEST_MONGODB_URL).
const source = mongoBackend('import_source');
const target = sqliteBackend('import_target');

/** What each MongoDB collection of the source holds, to tell it was left untouched. */
async function snapshot(url: string): Promise<Record<string, string>> {
  const connection = await mongoose.createConnection(url).asPromise();
  try {
    const out: Record<string, string> = {};
    for (const { name } of await connection.db!.listCollections().toArray()) {
      const docs = await connection.db!.collection(name).find({}).sort({ _id: 1 }).toArray();
      out[name] = JSON.stringify(docs);
    }
    return out;
  } finally {
    await connection.close();
  }
}

describe('first boot of 4.0 on an install kept on MongoDB', { skip: !source }, () => {
  let app: App;
  let before3x: InstanceDump;
  let sourceState: Record<string, string>;

  before(async () => {
    const old = await startApp(source!);
    try {
      before3x = await exportInstance(await seedEverything(old));
    } finally {
      await old.stop();
    }
    sourceState = await snapshot(source!.url);
  });
  after(async () => { await app?.stop(); });

  it('imports every record, ids included, into an empty SQLite store', async () => {
    app = await startApp(target, { MONGODB_URL: source!.url });
    assert.match(app.logs(), /\[IMPORT\] Done/);

    const admin = await login(app, ADMIN.email, ADMIN.password);
    const after4 = await exportInstance(admin);
    // The boot migrations run on the imported data as on any boot: an item carrying a
    // Discogs id but no source gets the source pair, as a restore gives it too.
    const expected = normalizeDump(before3x);
    const wall = expected.albums.find((a: any) => a.title === 'The Wall');
    wall.source = 'discogs';
    wall.source_id = '1';
    assert.deepEqual(normalizeDump(after4), expected);
    for (const table of ['albums', 'users', 'collections', 'lists', 'furniture'] as const) {
      assert.deepEqual(after4[table].map((r: any) => String(r._id)).sort(), before3x[table].map((r: any) => String(r._id)).sort(), table);
    }
  });

  it('serves the imported collection and its share link', async () => {
    const admin = await login(app, ADMIN.email, ADMIN.password);
    const ids = [...(await admin.get('/collection?limit=200&sort=title_asc')).text.matchAll(/data-item-id="([0-9a-f]{24})"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, 3);
    const token = before3x.collections.find(c => c.name === 'Vinyl').shareLinks[0].token;
    const visitor = app.client();
    assert.equal((await visitor.get(`/share/${token}`)).location, '/collection');
  });

  it('leaves the MongoDB server exactly as it was', async () => {
    assert.deepEqual(await snapshot(source!.url), sourceState);
  });

  it('imports once: later boots keep what was changed on SQLite', async () => {
    const admin = await login(app, ADMIN.email, ADMIN.password);
    await addMusic(admin, { title: 'Added on SQLite', artist: 'New' });
    await app.stop();
    app = await startApp({ ...target, reset: async () => {} }, { MONGODB_URL: source!.url });
    assert.doesNotMatch(app.logs(), /\[IMPORT\]/);
    const dump = await exportInstance(await login(app, ADMIN.email, ADMIN.password));
    assert.ok(titles(dump).includes('Added on SQLite'));
    assert.deepEqual(await snapshot(source!.url), sourceState);
  });

  it('refuses to start empty when the server to import from cannot be reached', async () => {
    await app.stop();
    await assert.rejects(
      startApp(target, { MONGODB_URL: 'mongodb://127.0.0.1:9/dvinyl_unreachable_test' }),
      (err: Error) => /could not be imported/.test(err.message) && /Nothing was written/.test(err.message)
    );
    // The store stayed empty, so a later boot with the server back still imports.
    app = await startApp({ ...target, reset: async () => {} }, { MONGODB_URL: source!.url });
    assert.match(app.logs(), /\[IMPORT\] Done/);
  });
});
