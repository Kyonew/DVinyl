/**
 * The storage the characterization suite boots DVinyl against.
 *
 * This is the only file of the suite that knows which database DVinyl runs on: everything
 * else talks to the app over HTTP. Moving DVinyl to another storage means rewriting
 * `backendFor()` and nothing else, so the very same tests then judge the new build.
 *
 * Running it against a throwaway server:
 *
 *   docker run -d --name dvinyl_char_db --ulimit nofile=64000:64000 -p 127.0.0.1:27117:27017 mongo:latest
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27117/dvinyl_char_test npm run test:characterization
 *
 * The raised file limit matters: every test file creates databases of its own, and a
 * server left at a low default dies with "Too many open files" halfway through the run.
 */

import mongoose from 'mongoose';
import { integrationDbUrl } from '../integrationDb';

export interface Backend {
  /** Variables handed to the app process so it opens this storage. */
  env: Record<string, string>;
  /** Leaves the storage empty, as on a fresh install. */
  reset(): Promise<void>;
}

/**
 * A throwaway database for one test file, or null when the suite has nowhere to run
 * (TEST_MONGODB_URL unset), in which case the tests skip.
 */
export function backendFor(name: string): Backend | null {
  const url = integrationDbUrl(`dvinyl_char_${name}_test`);
  if (!url) return null;
  return {
    env: { MONGODB_URL: url },
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
