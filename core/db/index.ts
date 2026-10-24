/**
 * The storage the core reads and writes through, one store per kind of record. Plain
 * objects, so a test can stand in for one of their functions.
 *
 * Which database is behind them is chosen once, from DB_DRIVER: `sqlite` keeps everything
 * in one file (SQLITE_PATH), anything else uses the MongoDB server MONGODB_URL names.
 */

import mongoose, { Types } from 'mongoose';
import * as mongoItems from './mongo/items';
import * as sqliteItems from './sqlite/items';
import { mongoRecordStore } from './mongo/recordStore';
import { sqliteRecordStore } from './sqlite/recordStore';
import { openDatabase, Table } from './sqlite/database';
import type { RecordStore } from './records';

export const DRIVER: 'sqlite' | 'mongodb' = process.env.DB_DRIVER === 'sqlite' ? 'sqlite' : 'mongodb';

// Required at call time: the models load the plugin registry, which loads this module, so
// an import made here could still be the empty module of that cycle.
const model = (file: string): any => require(`../../models/${file}`);

/** A record store kept in `table`, partitioned by `partition` when its records have one. */
function store(file: string, table: string, partition?: string): RecordStore {
  return DRIVER === 'sqlite'
    ? sqliteRecordStore(new Table(table, partition), () => model(file))
    : mongoRecordStore(() => model(file));
}

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
  furniture: store('Furniture', 'furniture', 'collection'),
  priceHistory: store('PriceHistory', 'price_history', 'collection'),
  customPlugins: store('CustomPlugin', 'custom_plugins')
};
