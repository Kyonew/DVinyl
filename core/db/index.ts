/**
 * The storage the core reads and writes through, one store per kind of record. Plain
 * objects, so a test can stand in for one of their functions.
 */

import mongoose, { Types } from 'mongoose';
import * as items from './items';
import { mongoRecordStore } from './mongo/recordStore';

// Required at call time: the models load the plugin registry, which loads this module, so
// an import made here could still be the empty module of that cycle.
const model = (file: string): any => require(`../../models/${file}`);

export const db = {
  /** Opens the storage named by `url`; resolves once it can be read and written. */
  async connect(url: string): Promise<string> {
    await mongoose.connect(url);
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

  items: { ...items },
  users: mongoRecordStore(() => model('User')),
  collections: mongoRecordStore(() => model('Collection')),
  settings: mongoRecordStore(() => model('Settings')),
  instanceSettings: mongoRecordStore(() => model('InstanceSettings')),
  loginLogs: mongoRecordStore(() => model('LoginLog')),
  blockedIps: mongoRecordStore(() => model('blockedIP')),
  lists: mongoRecordStore(() => model('List')),
  furniture: mongoRecordStore(() => model('Furniture')),
  priceHistory: mongoRecordStore(() => model('PriceHistory')),
  customPlugins: mongoRecordStore(() => model('CustomPlugin'))
};
