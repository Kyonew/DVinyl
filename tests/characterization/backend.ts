/**
 * The storage the characterization suite boots DVinyl against.
 *
 * This is the only file of the suite that knows which database DVinyl runs on: everything
 * else talks to the app over HTTP. The same tests run on SQLite (the default, no server
 * needed) and on MongoDB, which is how the two are held to the same behaviour:
 *
 *   npm run test:characterization
 *
 *   docker run -d --name dvinyl_char_db --ulimit nofile=64000:64000 -p 127.0.0.1:27117:27017 mongo:latest
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27117/dvinyl_char_test npm run test:characterization:mongodb
 *
 * The raised file limit matters: every test file creates databases of its own, and a
 * server left at a low default dies with "Too many open files" halfway through the run.
 * With TEST_MONGODB_URL set, the default run also covers the import of a MongoDB install
 * (import.test.ts).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { integrationDbUrl } from '../integrationDb';

export interface Backend {
  /** Variables handed to the app process so it opens this storage. */
  env: Record<string, string>;
  /** Leaves the storage empty, as on a fresh install. */
  reset(): Promise<void>;
}

/**
 * A throwaway store for one test file: a SQLite file of its own, which needs no server.
 * With TEST_DB_DRIVER=mongodb, a database of its own on the TEST_MONGODB_URL server
 * instead, or null without one, in which case the tests skip.
 */
export function backendFor(name: string): Backend | null {
  if (process.env.TEST_DB_DRIVER === 'mongodb') return mongoBackend(name);
  return sqliteBackend(name);
}

/** A SQLite file of its own, whatever the suite runs on. */
export function sqliteBackend(name: string): Backend {
  const file = path.join(os.tmpdir(), `dvinyl-char-${name}.sqlite`);
  return {
    env: { DB_DRIVER: 'sqlite', SQLITE_PATH: file },
    async reset() {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
    }
  };
}

/** A database of its own on the TEST_MONGODB_URL server, or null without one. */
export function mongoBackend(name: string): (Backend & { url: string }) | null {
  const url = integrationDbUrl(`dvinyl_char_${name}_test`);
  if (!url) return null;
  return {
    url,
    env: { DB_DRIVER: 'mongodb', MONGODB_URL: url },
    async reset() {
      const connection = await mongoose.createConnection(url).asPromise();
      try {
        await connection.dropDatabase();
      } finally {
        await connection.close();
      }
    }
  };
}
