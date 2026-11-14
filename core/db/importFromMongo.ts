/**
 * Moving an install from MongoDB, as every version before 4.0 kept its data, to SQLite.
 *
 * Runs at boot, before anything else reads the store, when the SQLite file holds nothing
 * yet and MONGODB_URL still names the old server: every record is read from there and
 * written to SQLite as it was, ids included, so links, lists and share links keep
 * pointing where they did. The boot migrations then run on the result like on any
 * other boot.
 *
 * The old data is only ever read; the one write is a marker saying the server was moved
 * (MOVED_MARKER). The load into SQLite is one transaction: it lands whole or not at all,
 * and a boot that cannot finish it stops rather than start on an empty store, which
 * someone would then set up from scratch and never import into.
 */

import mongoose from 'mongoose';
import { STORES } from './index';
import { writeAtOnce } from './sqlite/database';

const model = (file: string): any => require(`../../models/${file}`);

// Values of BSON types the SQLite documents do not keep (ids and dates they do), read
// back as the plain values they stand for.
function plainValue(value: any): any {
  if (Array.isArray(value)) return value.map(plainValue);
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  switch (value._bsontype) {
    case 'ObjectId': return value;
    case 'Long': case 'Int32': case 'Double': case 'Decimal128': return Number(value.toString());
    case 'Binary': return value.toString('base64');
    default: break;
  }
  const out: any = {};
  for (const [key, inner] of Object.entries(value)) out[key] = plainValue(inner);
  return out;
}

/**
 * Left on the MongoDB server once its data is in SQLite, the one thing the move writes
 * there. It is what stops that server from being taken for the live store again: a
 * data folder that goes missing from the configuration later would otherwise start the
 * app on the old data (see config/db.ts), and a new empty data folder would import it
 * a second time, both without a word, while the real collection sits in the SQLite file.
 */
export const MOVED_MARKER = 'dvinyl_moved_to_sqlite';

/** When the data of the server behind `connection` was moved to SQLite, or null. */
export async function movedToSqliteAt(connection: mongoose.Connection): Promise<Date | null> {
  const marker: any = await connection.db!.collection(MOVED_MARKER).findOne({ _id: 'moved' as any });
  return marker?.at instanceof Date ? marker.at : marker ? new Date(0) : null;
}

/** The message a second import of an already moved server stops with. */
export function alreadyMovedMessage(at: Date): string {
  return [
    `[IMPORT] The data of the MongoDB server MONGODB_URL names was already moved to SQLite on ${at.toISOString().slice(0, 10)}.`,
    '',
    'Your collection is in the SQLite file of that move, not in this empty data folder. Mount the',
    'data folder that holds it (the one with dvinyl.sqlite), or set SQLITE_PATH to that file.',
    'To start on an empty store instead, remove MONGODB_URL. To import the old MongoDB data',
    'again anyway, losing what changed since the move, set MONGODB_REIMPORT=true for one start.'
  ].join('\n');
}

/** Whether there is anything to import: an empty SQLite store, and an old server named. */
export function wantsImport(mongoUrl: string | undefined): boolean {
  return !!mongoUrl && STORES.every(({ table }) => table.isEmpty());
}

/** Thrown when the server was already moved and no new import was asked for. */
export class AlreadyMovedError extends Error {
  constructor(public at: Date) {
    super(alreadyMovedMessage(at));
    this.name = 'AlreadyMovedError';
  }
}

/**
 * Copies everything the MongoDB server at `mongoUrl` holds into the empty SQLite store,
 * then marks that server as moved. Returns how many records each table received. Throws
 * when the server cannot be read, and AlreadyMovedError when it was moved before.
 */
export async function importFromMongo(mongoUrl: string): Promise<Record<string, number>> {
  console.log('[IMPORT] SQLite is empty and MONGODB_URL is set: importing the MongoDB data...');
  const connection = await mongoose.createConnection(mongoUrl, { serverSelectionTimeoutMS: 20_000 }).asPromise();
  const loaded: { table: (typeof STORES)[number]['table']; docs: any[]; from: string }[] = [];
  try {
    const movedAt = await movedToSqliteAt(connection);
    if (movedAt && process.env.MONGODB_REIMPORT !== 'true') throw new AlreadyMovedError(movedAt);

    for (const { file, table } of STORES) {
      const name = model(file).collection.collectionName;
      const docs = (await connection.db!.collection(name).find({}).toArray()).map(plainValue);
      loaded.push({ table, docs, from: name });
    }

    writeAtOnce(() => {
      for (const { table, docs } of loaded) table.load(docs);
    });

    try {
      await connection.db!.collection(MOVED_MARKER).updateOne(
        { _id: 'moved' as any },
        { $set: { at: new Date() } },
        { upsert: true }
      );
    } catch (err: any) {
      // The data is in SQLite either way; only the guard against a later mix-up is missing.
      console.warn(
        `[IMPORT] Could not mark the MongoDB server as moved (${err.message}). Your data is in SQLite, `
        + 'but nothing will stop DVinyl from running on the old MongoDB data again if the data folder '
        + 'goes missing later: retire MongoDB (remove MONGODB_URL) once this install looks right.'
      );
    }
  } finally {
    await connection.close();
  }

  const counts: Record<string, number> = {};
  for (const { table, docs, from } of loaded) {
    counts[table.name] = docs.length;
    if (docs.length > 0) console.log(`[IMPORT] ${docs.length} record(s) from "${from}" into "${table.name}".`);
  }
  console.log('[IMPORT] Done. The MongoDB server is no longer used and can be retired once this install looks right.');
  return counts;
}
