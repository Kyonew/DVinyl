/**
 * Opens the storage the app runs on: the SQLite file SQLITE_PATH names (data/dvinyl.sqlite
 * by default). On an install upgraded from a version before 4.0, MONGODB_URL still names
 * the MongoDB server the data was kept on, and the first boot imports it from there (see
 * core/db/importFromMongo.ts). DB_DRIVER=mongodb runs on that server instead. Kept apart
 * from the application entrypoint so the variables are checked in one place.
 */

import path from 'path';
import { db, DRIVER } from '../core/db';
import { importFromMongo, wantsImport } from '../core/db/importFromMongo';

const MONGODB_URL = process.env.MONGODB_URL;
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'dvinyl.sqlite');

export const connectDB = async () => {
  if (DRIVER === 'mongodb') {
    if (!MONGODB_URL) throw new Error('DB_DRIVER=mongodb needs MONGODB_URL.');
    console.log('[DB] Connecting to MongoDB...');
    console.log(`[DB] MongoDB connected (${await db.connect(MONGODB_URL)})`);
    return;
  }

  console.log('[DB] Opening SQLite...');
  console.log(`[DB] SQLite opened (${await db.connect(SQLITE_PATH)})`);

  if (wantsImport(MONGODB_URL)) {
    try {
      await importFromMongo(MONGODB_URL!);
    } catch (err: any) {
      throw new Error(
        `The data of the MongoDB server MONGODB_URL names could not be imported (${err.message}). `
        + 'Nothing was written. Make that server reachable and start again, or remove MONGODB_URL '
        + 'to start on an empty store.'
      );
    }
  }
};
