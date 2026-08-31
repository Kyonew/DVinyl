/**
 * config/db.js
 *
 * Simple module to connect to MongoDB using Mongoose. Exports an async
 * function that establishes the connection using the `MONGODB_URL`
 * environment variable. This keeps connection logic separated from the
 * application entrypoint and makes testing easier.
 */

import mongoose from 'mongoose';

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  throw new Error("The environment variable MONGODB_URL is missing.");
}

export const connectDB = async () => {
  console.log('[DB] Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URL);
  console.log(`[DB] MongoDB connected (${mongoose.connection.name})`);
};
