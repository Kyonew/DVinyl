/**
 * Reading items. Every read of the item store goes through here, with core filters
 * (core/db/filter.ts), and comes back as plain records.
 */

import mongoose from 'mongoose';
import Item from '../../models/Item';
import { buildUniqueTitlesGroupKey, CreatorFieldSource } from '../helpers';
import { Filter, Scalar, Sort } from './filter';
import { toMongoFilter, toMongoSort } from './mongo/compile';
import { toMongooseDefinition } from './mongo/schema';
import type { StoredFields } from './storedFields';

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

export interface WriteOptions {
  /**
   * The item type the values belong to, so they are cast and checked against its stored
   * fields (a numeric id posted as text is stored as a number). Without it only the
   * fields every item has are written.
   */
  kind?: string;
  /** Also write fields the type does not declare (a collection's own fields, under extra). */
  allowUndeclared?: boolean;
}

// The model of one item type, which knows its stored fields, or the base one.
function modelFor(kind?: string): any {
  return kind && mongoose.modelNames().includes(kind) ? mongoose.model(kind) : Item;
}

/** Stores a new item, cast and checked against its type, and returns it as stored. */
export async function create(record: Record<string, any>): Promise<any> {
  const doc = await modelFor(record.kind).create(record);
  return doc.toObject();
}

/**
 * Stores many items in one go, as a backup or an import hands them over: through the
 * base model, so each is stored as given.
 */
export async function insertMany(records: Record<string, any>[]): Promise<void> {
  if (records.length > 0) await Item.insertMany(records);
}

type WriteResult = { matched: number; modified: number };

async function update(many: boolean, filter: Filter, patch: Patch, options: WriteOptions): Promise<WriteResult> {
  const change = toMongoUpdate(patch);
  if (Object.keys(change).length === 0) return { matched: 0, modified: 0 };
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

/** The fields every item has, whatever its type. */
export function baseFieldNames(): string[] {
  return [...new Set(Object.keys(Item.schema.paths).map(path => path.split('.')[0]!))];
}

/**
 * Declares an item type, so its items are read and written with its stored fields.
 * Throws for a type already declared: drop it first (a custom plugin edited at runtime).
 */
export function registerType(kind: string, fields: StoredFields): void {
  Item.discriminator(kind, new mongoose.Schema(toMongooseDefinition(fields)));
}

export function unregisterType(kind: string): void {
  if ((Item as any).discriminators?.[kind]) delete (Item as any).discriminators[kind];
  if (mongoose.modelNames().includes(kind)) mongoose.deleteModel(kind);
}
