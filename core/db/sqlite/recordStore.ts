/**
 * The SQLite implementation of a record store (see core/db/records.ts).
 */

import type { Model } from 'mongoose';
import type { RecordStore } from '../records';
import { Table } from './database';
import * as engine from './engine';

/**
 * `model` is read on each call rather than once: the models load the plugin registry,
 * which loads the stores, so at import time a model may not be defined yet.
 */
export function sqliteRecordStore(table: Table, model: () => Model<any>): RecordStore {
  const settings = (options: { upsert?: boolean; validate?: boolean; asStored?: boolean } = {}) => ({
    model: model(),
    upsert: !!options.upsert,
    validate: !!options.validate,
    asStored: !!options.asStored
  });

  return {
    async find(filter, options = {}) {
      return engine.read(table, filter, options, () => model());
    },
    async findOne(filter, options = {}) {
      const [row] = engine.read(table, filter, { ...options, limit: 1 }, () => model());
      return row ?? null;
    },
    async findById(id, options = {}) {
      const doc = table.get(String(id));
      if (!doc) return null;
      const [row] = engine.read(table, { op: 'eq', field: '_id', value: String(id) }, options, () => model());
      return row ?? null;
    },
    async count(filter) {
      return engine.matching(table, filter).length;
    },
    async exists(filter) {
      return engine.matching(table, filter).length > 0;
    },
    async distinct(field, filter) {
      return engine.distinct(table, field, filter);
    },
    async create(record) {
      return engine.create(table, model(), record);
    },
    async insertMany(records, options = {}) {
      engine.insertMany(table, () => model(), records, options);
    },
    validate(record) {
      return engine.validate(model(), record);
    },
    async updateOne(filter, patch, options = {}) {
      return engine.update(table, filter, patch, settings(options), false).result;
    },
    async updateMany(filter, patch, options = {}) {
      return engine.update(table, filter, patch, settings(options), true).result;
    },
    async updateAndGet(filter, patch, options = {}) {
      const { records } = engine.update(table, filter, patch, settings(options), false);
      return records[0] ?? null;
    },
    async updateListRecord(filter, entry, own = {}) {
      return engine.updateListRecord(table, filter, entry, own, settings());
    },
    async deleteOne(filter) {
      return engine.remove(table, filter, false);
    },
    async deleteMany(filter) {
      return engine.remove(table, filter, true);
    }
  };
}
