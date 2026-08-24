/**
 * Boots a real local MongoDB instance for manual testing, no Docker/system install
 * needed: mongodb-memory-server downloads a real mongod binary into the npm cache
 * on first run and launches it as a child process.
 *
 * Data persists in ./mongo_data_test (already gitignored) across restarts of this
 * script, so your test collection survives between `npm run test:mongo` runs.
 *
 * Usage: npm run test:mongo
 * Then set MONGODB_URL in your .env to the URI printed below and `npm start`.
 */
import fs from 'fs';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = 27018;
const DB_PATH = path.join(__dirname, '..', 'mongo_data_test');

async function main() {
  fs.mkdirSync(DB_PATH, { recursive: true });

  const mongod = await MongoMemoryServer.create({
    instance: {
      port: PORT,
      dbPath: DB_PATH,
      storageEngine: 'wiredTiger'
    }
  });

  const uri = mongod.getUri('dvinyl');
  console.log('[test-mongo] MongoDB running at:', uri);
  console.log('[test-mongo] Set MONGODB_URL to that value in .env, then run the app.');
  console.log('[test-mongo] Press Ctrl+C to stop.');

  const shutdown = async () => {
    console.log('\n[test-mongo] Stopping...');
    await mongod.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive.
  await new Promise(() => {});
}

main().catch(err => {
  console.error('[test-mongo] Failed to start:', err);
  process.exit(1);
});
