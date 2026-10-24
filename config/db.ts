/**
 * Opens the storage the app runs on, named by the `MONGODB_URL` environment variable.
 * Kept apart from the application entrypoint so the variable is checked in one place.
 */

import { db } from '../core/db';

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  throw new Error("The environment variable MONGODB_URL is missing.");
}

export const connectDB = async () => {
  console.log('[DB] Connecting to MongoDB...');
  const name = await db.connect(MONGODB_URL);
  console.log(`[DB] MongoDB connected (${name})`);
};
