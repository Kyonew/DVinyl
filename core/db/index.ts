/**
 * The storage the core reads and writes through, one store per kind of record. Plain
 * objects, so a test can stand in for one of their functions.
 *
 * Everything is kept in one SQLite file (SQLITE_PATH). DB_DRIVER=mongodb runs on the
 * MongoDB server MONGODB_URL names instead, as versions before 4.0 did; it is what the
 * import from such an install reads with, and is kept as a way back during the move.
 */

import mongoose, { Types } from 'mongoose';
import * as mongoItems from './mongo/items';
import * as sqliteItems from './sqlite/items';
import { mongoRecordStore } from './mongo/recordStore';
import { sqliteRecordStore } from './sqlite/recordStore';
import { closeDatabase, openDatabase, Table } from './sqlite/database';
import type { RecordStore } from './records';

export const DRIVER: 'sqlite' | 'mongodb' = process.env.DB_DRIVER === 'mongodb' ? 'mongodb' : 'sqlite';

// Required at call time: the models load the plugin registry, which loads this module, so
// an import made here could still be the empty module of that cycle.
const model = (file: string): any => require(`../../models/${file}`);

/**
 * Where each kind of record lives: its model (models/<file>), and the SQLite table that
 * holds it. Read by the import from an older MongoDB install too (core/db/importFromMongo.ts).
 */
export const STORES: { file: string; table: Table }[] = [];

/** A record store kept in `table`, partitioned by `partition` when its records have one. */
function store(file: string, table: string, partition?: string): RecordStore {
  const kept = new Table(table, partition);
  STORES.push({ file, table: kept });
  return DRIVER === 'sqlite'
    ? sqliteRecordStore(kept, () => model(file))
    : mongoRecordStore(() => model(file));
}

STORES.push({ file: 'Item', table: sqliteItems.table });

export const db = {
  /** Opens the storage `target` names (a MongoDB URL, or a SQLite file path). */
  async connect(target: string): Promise<string> {
    if (DRIVER === 'sqlite') {
      // Nothing may reach a MongoDB server by mistake: refused at once, not queued.
      mongoose.set('bufferCommands', false);
      openDatabase(target);
      return target;
    }
    await mongoose.connect(target);
    return mongoose.connection.name;
  },
  /** Closes the storage on shutdown, once nothing more will be written. */
  async close(): Promise<void> {
    if (DRIVER === 'sqlite') closeDatabase();
    else await mongoose.disconnect();
  },
  /** A fresh id, in the form the store keeps ids in. */
  newId: (): any => new Types.ObjectId(),
  /**
   * An id read from a file (text, in a JSON backup) in the form the store keeps ids in.
   * Anything that is not an id is handed back unchanged.
   */
  storedId: (value: any): any =>
    typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value) ? new Types.ObjectId(value) : value,

  items: { ...(DRIVER === 'sqlite' ? sqliteItems : mongoItems) } as typeof mongoItems,
  users: store('User', 'users'),
  collections: store('Collection', 'collections'),
  settings: store('Settings', 'settings', 'collection'),
  instanceSettings: store('InstanceSettings', 'instance_settings'),
  loginLogs: store('LoginLog', 'login_logs'),
  blockedIps: store('blockedIP', 'blocked_ips'),
  lists: store('List', 'lists', 'collection'),
  requests: store('Request', 'requests', 'collection'),
  requestTypes: store('RequestType', 'request_types', 'collection'),
  notifications: store('Notification', 'notifications', 'user'),
  furniture: store('Furniture', 'furniture', 'collection'),
  priceHistory: store('PriceHistory', 'price_history', 'collection'),
  customPlugins: store('CustomPlugin', 'custom_plugins')
};
