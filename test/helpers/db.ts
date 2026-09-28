import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { invalidateInstanceSettingsCache } from '../../utils/instanceSettings';

let mongod: MongoMemoryServer | undefined;

export async function startDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URL = uri;
  await mongoose.connect(uri, { dbName: 'dvinyl_test' });
}

export async function clearDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key]!.deleteMany({});
  }
  // utils/instanceSettings.ts memoizes the singleton in-process; clearing the
  // document is not enough, so drop the cache too.
  invalidateInstanceSettingsCache();
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}
