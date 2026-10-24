/**
 * The storage the core reads and writes through, one store per kind of record. Plain
 * objects, so a test can stand in for one of their functions.
 */

import * as items from './items';
import { mongoRecordStore } from './mongo/recordStore';
import User from '../../models/User';
import Collection from '../../models/Collection';
import Settings from '../../models/Settings';
import InstanceSettings from '../../models/InstanceSettings';
import LoginLog from '../../models/LoginLog';
import BlockedIP from '../../models/blockedIP';

export const db = {
  items: { ...items },
  users: mongoRecordStore(() => User as any),
  collections: mongoRecordStore(() => Collection as any),
  settings: mongoRecordStore(() => Settings as any),
  instanceSettings: mongoRecordStore(() => InstanceSettings as any),
  loginLogs: mongoRecordStore(() => LoginLog as any),
  blockedIps: mongoRecordStore(() => BlockedIP as any)
};
