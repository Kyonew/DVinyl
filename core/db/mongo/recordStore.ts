/**
 * The MongoDB implementation of a record store (see core/db/records.ts).
 */

import type { Model } from 'mongoose';
import type { RecordStore, ReadOptions, WriteResult } from '../records';
import type { Filter } from '../filter';
import { toMongoFilter, toMongoSort, toMongoUpdate } from './compile';

/**
 * `model` is read on each call rather than once: the models load the plugin registry,
 * which loads this store, so at import time a model may not be defined yet.
 */
export function mongoRecordStore(model: () => Model<any>): RecordStore {
  const target = (): any => model();
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
    async create(record) {
      return (await target().create(record)).toObject();
    },
    async updateOne(filter, patch, options = {}) {
      return result(await target().updateOne(toMongoFilter(filter), toMongoUpdate(patch), { upsert: !!options.upsert }));
    },
    async updateMany(filter, patch) {
      return result(await target().updateMany(toMongoFilter(filter), toMongoUpdate(patch)));
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
