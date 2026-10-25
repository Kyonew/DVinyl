/**
 * Moving an install from MongoDB, as every version before 4.0 kept its data, to SQLite.
 *
 * Runs at boot, before anything else reads the store, when the SQLite file holds nothing
 * yet and MONGODB_URL still names the old server: every record is read from there and
 * written to SQLite as it was, ids included, so links, lists and share links keep
 * pointing where they did. The boot migrations then run on the result like on any
 * other boot.
 *
 * The old server is only ever read. The load into SQLite is one transaction: it lands
 * whole or not at all, and a boot that cannot finish it stops rather than start on an
 * empty store, which someone would then set up from scratch and never import into.
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

/** Whether there is anything to import: an empty SQLite store, and an old server named. */
export function wantsImport(mongoUrl: string | undefined): boolean {
  return !!mongoUrl && STORES.every(({ table }) => table.isEmpty());
}

/**
 * Copies everything the MongoDB server at `mongoUrl` holds into the empty SQLite store.
 * Returns how many records each table received. Throws when the server cannot be read.
 */
export async function importFromMongo(mongoUrl: string): Promise<Record<string, number>> {
  console.log('[IMPORT] SQLite is empty and MONGODB_URL is set: importing the MongoDB data...');
  const connection = await mongoose.createConnection(mongoUrl, { serverSelectionTimeoutMS: 20_000 }).asPromise();
  const loaded: { table: (typeof STORES)[number]['table']; docs: any[]; from: string }[] = [];
  try {
    for (const { file, table } of STORES) {
      const name = model(file).collection.collectionName;
      const docs = (await connection.db!.collection(name).find({}).toArray()).map(plainValue);
      loaded.push({ table, docs, from: name });
    }
  } finally {
    await connection.close();
  }

  writeAtOnce(() => {
    for (const { table, docs } of loaded) table.load(docs);
  });

  const counts: Record<string, number> = {};
  for (const { table, docs, from } of loaded) {
    counts[table.name] = docs.length;
    if (docs.length > 0) console.log(`[IMPORT] ${docs.length} record(s) from "${from}" into "${table.name}".`);
  }
  console.log('[IMPORT] Done. The MongoDB server was only read and can be retired once this install looks right.');
  return counts;
}
