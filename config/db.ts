/**
 * Opens the storage the app runs on: the SQLite file SQLITE_PATH names (data/dvinyl.sqlite
 * by default). On an install upgraded from a version before 4.0, MONGODB_URL still names
 * the MongoDB server the data was kept on, and the first boot imports it from there (see
 * core/db/importFromMongo.ts). DB_DRIVER=mongodb runs on that server instead. Kept apart
 * from the application entrypoint so the variables are checked in one place.
 */

import path from 'path';
import mongoose from 'mongoose';
import { db, DRIVER, DRIVER_REASON } from '../core/db';
import { AlreadyMovedError, importFromMongo, movedToSqliteAt, wantsImport } from '../core/db/importFromMongo';
import { DatabaseInUseError } from '../core/db/sqlite/database';
import { assertDataPersisted, MOVE_GUIDE, movedAwayMessage } from './dataVolume';
import { StartupError } from './startupError';
import { SQLITE_PATH } from './constants';

const MONGODB_URL = process.env.MONGODB_URL;

/** The message a second DVinyl started on the same SQLite file stops with. */
export function inUseMessage(file: string): string {
  return [
    `[DATA] Another DVinyl is already running on ${path.resolve(file)}. Stop it, then start this one again.`,
    '',
    'Only one DVinyl at a time can use a data folder: two at once would each undo what the',
    'other writes. Look for an older container still running on the same folder, or a local',
    'run (npm start) next to the container. To run a second DVinyl on purpose, give it a',
    'data folder (or SQLITE_PATH) of its own.'
  ].join('\n');
}

export const connectDB = async () => {
  if (DRIVER === 'mongodb') {
    if (!MONGODB_URL) throw new Error('DB_DRIVER=mongodb needs MONGODB_URL.');
    console.log('[DB] Connecting to MongoDB...');
    console.log(`[DB] MongoDB connected (${await db.connect(MONGODB_URL)})`);
    if (DRIVER_REASON === 'fallback') {
      // Kept on MongoDB because no data folder is mounted. A server already moved holds
      // stale data: running on it would hide the real collection and split it in two.
      const movedAt = await movedToSqliteAt(mongoose.connection);
      if (movedAt) {
        await db.close();
        throw new StartupError(movedAwayMessage(movedAt, path.dirname(path.resolve(SQLITE_PATH))));
      }
      console.warn(
        '[DB] Running on MongoDB, as before 4.0, because no data folder is mounted for SQLite. '
        + `Everything works as it is. To move to SQLite, see ${MOVE_GUIDE}`
      );
    }
    return;
  }

  assertDataPersisted(SQLITE_PATH);
  console.log('[DB] Opening SQLite...');
  try {
    console.log(`[DB] SQLite opened (${await db.connect(SQLITE_PATH)})`);
  } catch (err) {
    if (err instanceof DatabaseInUseError) throw new StartupError(inUseMessage(SQLITE_PATH));
    throw err;
  }

  if (wantsImport(MONGODB_URL)) {
    try {
      await importFromMongo(MONGODB_URL!);
    } catch (err: any) {
      if (err instanceof AlreadyMovedError) throw new StartupError(err.message);
      throw new StartupError(
        `[IMPORT] The data of the MongoDB server MONGODB_URL names could not be imported (${err.message}). `
        + 'Nothing was written. Make that server reachable and start again, or remove MONGODB_URL '
        + 'to start on an empty store.'
      );
    }
  }
};
