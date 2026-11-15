/**
 * The MongoDB implementation of a record store (see core/db/records.ts).
 */

import type { Model } from 'mongoose';
import type { RecordStore, ReadOptions, WriteResult } from '../records';
import type { Filter } from '../filter';
import { toMongoFilter, toMongoSort, toMongoUpdate } from './compile';
import { firstInvalid } from '../errors';

/**
 * `model` is read on each call rather than once: the models load the plugin registry,
 * which loads this store, so at import time a model may not be defined yet.
 */
export function mongoRecordStore(model: () => Model<any>): RecordStore {
  const target = (): any => model();
  const castFilter = (filter: Filter) => target().find(toMongoFilter(filter)).cast(target());
  const withDefaults = (record: any) => (record ? target().hydrate(record).toObject() : record);
  const result = (r: any): WriteResult => ({
    matched: r.matchedCount ?? 0,
    modified: r.modifiedCount ?? 0,
    upserted: (r.upsertedCount ?? 0) > 0
  });

  const read = (filter: Filter, options: ReadOptions = {}) => {
    let q = target().find(toMongoFilter(filter));
    if (options.fields) q = q.select(options.fields.join(' '));
    if (options.sort && options.sort.length > 0) q = q.sort(toMongoSort(options.sort));
    if (options.skip) q = q.skip(options.skip);
    if (options.limit) q = q.limit(options.limit);
    return q.lean().then((rows: any[]) => (options.defaults ? rows.map(withDefaults) : rows));
  };

  return {
    find: read,
    async findOne(filter, options = {}) {
      const [row] = await read(filter, { ...options, limit: 1 });
      return row ?? null;
    },
    async findById(id, options = {}) {
      let q = target().findById(id);
      if (options.fields) q = q.select(options.fields.join(' '));
      const row = await q.lean();
      return options.defaults ? withDefaults(row) : row;
    },
    count: filter => target().countDocuments(toMongoFilter(filter)),
    exists: async filter => !!(await target().exists(toMongoFilter(filter))),
    distinct: (field, filter) => target().distinct(field, toMongoFilter(filter)),
    async create(record) {
      return (await target().create(record)).toObject();
    },
    async insertMany(records, options = {}) {
      if (records.length === 0) return;
      if (options.asStored) await target().collection.insertMany(records);
      else await target().insertMany(records);
    },
    validate(record) {
      return firstInvalid(new (target())(record).validateSync());
    },
    async updateOne(filter, patch, options = {}) {
      if (options.asStored) {
        return result(await target().collection.updateOne(castFilter(filter), toMongoUpdate(patch), { upsert: !!options.upsert }));
      }
      return result(await target().updateOne(toMongoFilter(filter), toMongoUpdate(patch), {
        upsert: !!options.upsert,
        runValidators: !!options.validate
      }));
    },
    async updateMany(filter, patch, options = {}) {
      if (options.asStored) return result(await target().collection.updateMany(castFilter(filter), toMongoUpdate(patch)));
      return result(await target().updateMany(toMongoFilter(filter), toMongoUpdate(patch), { runValidators: !!options.validate }));
    },
    async updateAndGet(filter, patch, options = {}) {
      return target().findOneAndUpdate(toMongoFilter(filter), toMongoUpdate(patch), {
        new: true,
        upsert: !!options.upsert,
        setDefaultsOnInsert: true
      }).lean();
    },
    async updateListRecord(filter, entry, own = {}) {
      const where = Object.fromEntries(Object.entries(entry.where).map(([k, v]) => [`${entry.list}.${k}`, v]));
      const at = (field: string) => `${entry.list}.$.${field}`;
      const change = toMongoUpdate({
        set: { ...Object.fromEntries(Object.entries(entry.set || {}).map(([k, v]) => [at(k), v])), ...(own.set || {}) },
        unset: [...(entry.unset || []).map(at), ...(own.unset || [])]
      });
      // Side by side with the record filter rather than nested in it: the entry that is
      // changed is the one this very condition matched.
      return result(await target().updateOne({ ...toMongoFilter(filter), ...where }, change));
    },
    async deleteOne(filter) {
      return (await target().deleteOne(toMongoFilter(filter))).deletedCount || 0;
    },
    async deleteMany(filter) {
      return (await target().deleteMany(toMongoFilter(filter))).deletedCount || 0;
    }
  };
}
