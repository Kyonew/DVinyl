/**
 * Reading items. Every read of the item store goes through here, with core filters
 * (core/db/filter.ts), and comes back as plain records.
 */

import mongoose from 'mongoose';
import Item from '../../../models/Item';
import type { CreatorFieldSource } from '../../helpers';
import { buildUniqueTitlesGroupKey } from './distinctWorks';
import { Filter, Scalar, Sort } from '../filter';
import { toMongoFilter, toMongoSort, toMongoUpdate } from './compile';
import type { Patch } from '../patch';
import { modelFor } from '../itemTypes';

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


export interface WriteOptions {
  /**
   * The item type the values belong to, so they are cast and checked against its stored
   * fields (a numeric id posted as text is stored as a number). Without it only the
   * fields every item has are written.
   */
  kind?: string;
  /** Also write fields the type does not declare (a collection's own fields, under extra). */
  allowUndeclared?: boolean;
  /**
   * Write exactly what the patch says, past every rule of the type, including fields no
   * type declares any more. For the migrations repairing what older versions stored.
   */
  asStored?: boolean;
}

/** Stores a new item, cast and checked against its type, and returns it as stored. */
export async function create(record: Record<string, any>): Promise<any> {
  const doc = await modelFor(record.kind).create(record);
  return doc.toObject();
}

/**
 * Stores many items in one go, each checked against its own type, or exactly as given
 * with `asStored` (a backup being restored: authoritative, never re-validated against
 * rules that may have grown stricter since).
 */
export async function insertMany(records: Record<string, any>[], options: { asStored?: boolean } = {}): Promise<void> {
  if (records.length === 0) return;
  if (options.asStored) await Item.collection.insertMany(records);
  else await Item.insertMany(records);
}


type WriteResult = { matched: number; modified: number };

async function update(many: boolean, filter: Filter, patch: Patch, options: WriteOptions): Promise<WriteResult> {
  const change = toMongoUpdate(patch);
  if (Object.keys(change).length === 0) return { matched: 0, modified: 0 };
  if (options.asStored) {
    const query = Item.find(toMongoFilter(filter)).cast(Item);
    const raw = many ? await Item.collection.updateMany(query, change) : await Item.collection.updateOne(query, change);
    return { matched: raw.matchedCount, modified: raw.modifiedCount };
  }
  const Model = modelFor(options.kind);
  const settings = options.allowUndeclared ? { strict: false } : {};
  const result = many
    ? await Model.updateMany(toMongoFilter(filter), change, settings)
    : await Model.updateOne(toMongoFilter(filter), change, settings);
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/** Changes the first matching item. */
export function updateOne(filter: Filter, patch: Patch, options: WriteOptions = {}): Promise<WriteResult> {
  return update(false, filter, patch, options);
}

export function updateMany(filter: Filter, patch: Patch, options: WriteOptions = {}): Promise<WriteResult> {
  return update(true, filter, patch, options);
}

/** Removes the matching items and says how many went. */
export async function deleteMany(filter: Filter): Promise<number> {
  const result = await Item.deleteMany(toMongoFilter(filter));
  return result.deletedCount || 0;
}

/**
 * Changes one record of a `records` field (an episode of a season, a track of an album)
 * on the first matching item: the first record whose `where` fields hold the given
 * values. `item` changes the item itself in the same write. Matches nothing when no
 * record fits.
 */
export async function updateListRecord(
  filter: Filter,
  record: { list: string; where: Record<string, Scalar>; set?: Record<string, any>; unset?: string[] },
  item: Patch = {},
  options: WriteOptions = {}
): Promise<WriteResult> {
  const where = Object.fromEntries(Object.entries(record.where).map(([k, v]) => [`${record.list}.${k}`, v]));
  const at = (field: string) => `${record.list}.$.${field}`;
  const patch: Patch = {
    set: {
      ...Object.fromEntries(Object.entries(record.set || {}).map(([k, v]) => [at(k), v])),
      ...(item.set || {})
    },
    unset: [...(record.unset || []).map(at), ...(item.unset || [])]
  };
  const change = toMongoUpdate(patch);
  if (Object.keys(change).length === 0) return { matched: 0, modified: 0 };
  // Side by side with the item filter rather than nested in it: the record that is changed
  // is the one this very condition matched.
  const result = await modelFor(options.kind).updateOne({ ...toMongoFilter(filter), ...where }, change);
  return { matched: result.matchedCount, modified: result.modifiedCount };
}


/** How many matching items hold each value of a field, most frequent first. */
export async function countBy(field: string, filter: Filter): Promise<{ value: any; count: number }[]> {
  const match = Item.find(toMongoFilter(filter)).cast(Item);
  const rows = await Item.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  return rows.map((row: any) => ({ value: row._id, count: row.count }));
}

/**
 * The distinct values the given fields hold across the matching items, grouped by item
 * type. Single values and lists are pooled: genre, genres and styles give one set per
 * type. Empty values are left out.
 */
export async function valuesByKind(filter: Filter, fields: string[]): Promise<Record<string, any[]>> {
  const match = Item.find(toMongoFilter(filter)).cast(Item);
  const rows = await Item.aggregate([
    { $match: match },
    {
      $project: {
        kind: 1,
        values: {
          $concatArrays: fields.map(field => ({
            $cond: [
              { $isArray: `$${field}` },
              `$${field}`,
              { $cond: [{ $in: [`$${field}`, ['', null]] }, [], [`$${field}`]] }
            ]
          }))
        }
      }
    },
    { $unwind: '$values' },
    { $group: { _id: '$kind', values: { $addToSet: '$values' } } }
  ]);
  const out: Record<string, any[]> = {};
  for (const row of rows) if (row._id) out[row._id] = row.values;
  return out;
}

/**
 * Replaces, on the matching items, each value of a field by the one it maps to, all in
 * one pass: two values swapping places ("A" to "B" and "B" to "A") end up swapped rather
 * than both on the same one. Returns how many items changed.
 */
export async function remapValues(filter: Filter, field: string, mapping: [from: Scalar, to: Scalar][]): Promise<number> {
  if (mapping.length === 0) return 0;
  const result = await Item.updateMany(
    { $and: [toMongoFilter(filter), { [field]: { $in: mapping.map(([from]) => from) } }] },
    [{
      $set: {
        [field]: {
          $switch: {
            branches: mapping.map(([from, to]) => ({ case: { $eq: [`$${field}`, from] }, then: to })),
            default: `$${field}`
          }
        }
      }
    }]
  );
  return result.modifiedCount;
}

/**
 * A change of its own for each item, sent in batches: what a migration needs when the
 * new value depends on each item's old one. Written as stored, like `asStored`.
 */
export async function updateEach(changes: { id: any; patch: Patch }[]): Promise<number> {
  let modified = 0;
  for (let i = 0; i < changes.length; i += 500) {
    const ops = changes.slice(i, i + 500).map(({ id, patch }) => ({
      updateOne: { filter: { _id: typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id }, update: toMongoUpdate(patch) }
    }));
    if (ops.length > 0) modified += (await Item.collection.bulkWrite(ops)).modifiedCount;
  }
  return modified;
}

/**
 * Copies, on the matching items, the value of one field into another. Returns how many
 * items changed.
 */
export async function copyField(filter: Filter, from: string, to: string): Promise<number> {
  const query = Item.find(toMongoFilter(filter)).cast(Item);
  const result = await Item.collection.updateMany(query, [{ $set: { [to]: `$${from}` } }]);
  return result.modifiedCount;
}

export { baseFieldNames, registerType, unregisterType, validate } from '../itemTypes';
