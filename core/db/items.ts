/**
 * Reading items. Every read of the item store goes through here, with core filters
 * (core/db/filter.ts), and comes back as plain records.
 */

import Item from '../../models/Item';
import { buildUniqueTitlesGroupKey, CreatorFieldSource } from '../helpers';
import { Filter, Sort } from './filter';
import { toMongoFilter, toMongoSort } from './mongo/compile';

export interface FindOptions {
  sort?: Sort;
  skip?: number;
  limit?: number;
  /** Only these fields (plus the id) on each record. */
  fields?: string[];
  /**
   * Fill in what the item's type declares a default for and the record does not hold
   * (an item stored before the field existed, or restored from an older backup).
   */
  defaults?: boolean;
}

// Through the model of the item's own type, the way a hydrated document would read it.
function withDefaults(record: any): any {
  return record ? (Item.hydrate(record) as any).toObject() : record;
}

function query(filter: Filter, options: FindOptions = {}) {
  let q: any = Item.find(toMongoFilter(filter));
  if (options.fields) q = q.select(options.fields.join(' '));
  if (options.sort && options.sort.length > 0) q = q.sort(toMongoSort(options.sort));
  if (options.skip) q = q.skip(options.skip);
  if (options.limit) q = q.limit(options.limit);
  return q;
}

export async function find(filter: Filter, options: FindOptions = {}): Promise<any[]> {
  const rows: any[] = await query(filter, options).lean();
  return options.defaults ? rows.map(withDefaults) : rows;
}

export async function findOne(filter: Filter, options: Omit<FindOptions, 'skip' | 'limit'> = {}): Promise<any | null> {
  const [row] = await find(filter, { ...options, limit: 1 });
  return row ?? null;
}

export async function findById(id: string, options: Pick<FindOptions, 'defaults'> = {}): Promise<any | null> {
  const row = await Item.findById(id).lean();
  return options.defaults ? withDefaults(row) : row;
}

export async function count(filter: Filter): Promise<number> {
  return Item.countDocuments(toMongoFilter(filter));
}

export async function exists(filter: Filter): Promise<boolean> {
  return !!(await Item.exists(toMongoFilter(filter)));
}

/** The values a field holds across the matching items, list fields contributing each element. */
export async function distinct(field: string, filter: Filter): Promise<any[]> {
  return Item.distinct(field, toMongoFilter(filter));
}

/**
 * How many distinct works the matching items amount to: editions of one work (several
 * formats, a reissue) count once, matched on the normalized title and creator. The
 * creator is the selected type's own field, or each item's own type's field when every
 * type is shown at once.
 */
export async function countDistinctWorks(
  filter: Filter,
  creators: { selected?: CreatorFieldSource | undefined; plugins: CreatorFieldSource[] }
): Promise<number> {
  // An aggregate does not cast its $match, so the filter is cast through the model first.
  const match = Item.find(toMongoFilter(filter)).cast(Item);
  const result = await Item.aggregate([
    { $match: match },
    { $group: { _id: buildUniqueTitlesGroupKey(creators.selected, creators.plugins) } },
    { $count: 'total' }
  ]);
  return result[0]?.total ?? 0;
}

/** A change to apply to records: values to write, fields to remove. */
export interface Patch {
  set?: Record<string, any>;
  unset?: string[];
}

function toMongoUpdate(patch: Patch): Record<string, any> {
  const update: Record<string, any> = {};
  if (patch.set && Object.keys(patch.set).length > 0) update.$set = patch.set;
  if (patch.unset && patch.unset.length > 0) {
    update.$unset = Object.fromEntries(patch.unset.map(field => [field, '']));
  }
  return update;
}

/** Changes the first matching item and hands back what it held before, or null on a miss. */
export async function updateOne(filter: Filter, patch: Patch): Promise<any | null> {
  const update = toMongoUpdate(patch);
  return Item.findOneAndUpdate(toMongoFilter(filter), update).lean();
}

export async function updateMany(filter: Filter, patch: Patch): Promise<{ matched: number; modified: number }> {
  const update = toMongoUpdate(patch);
  if (Object.keys(update).length === 0) return { matched: 0, modified: 0 };
  const result = await Item.updateMany(toMongoFilter(filter), update);
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/** Removes the matching items and says how many went. */
export async function deleteMany(filter: Filter): Promise<number> {
  const result = await Item.deleteMany(toMongoFilter(filter));
  return result.deletedCount || 0;
}
