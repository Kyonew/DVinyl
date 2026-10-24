/**
 * Opens the storage the app runs on. With DB_DRIVER=sqlite, the file SQLITE_PATH names
 * (data/dvinyl.sqlite by default); otherwise the MongoDB server of MONGODB_URL. Kept apart
 * from the application entrypoint so the variables are checked in one place.
 */

import path from 'path';
import { db, DRIVER } from '../core/db';

const target = DRIVER === 'sqlite'
  ? (process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'dvinyl.sqlite'))
  : process.env.MONGODB_URL;

if (!target) {
  throw new Error("The environment variable MONGODB_URL is missing.");
}

export const connectDB = async () => {
  console.log(DRIVER === 'sqlite' ? '[DB] Opening SQLite...' : '[DB] Connecting to MongoDB...');
  const name = await db.connect(target);
  console.log(DRIVER === 'sqlite' ? `[DB] SQLite opened (${name})` : `[DB] MongoDB connected (${name})`);
};
