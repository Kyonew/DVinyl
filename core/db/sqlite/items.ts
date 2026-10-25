/**
 * The SQLite implementation of the item store: the same functions, with the same
 * meaning, as core/db/mongo/items.ts.
 */

import Item from '../../../models/Item';
import { buildSortTitle, CreatorFieldSource } from '../../helpers';
import type { Filter, Scalar, Sort } from '../filter';
import * as F from '../filter';
import type { Patch } from '../patch';
import { applyRawPatch, getPath } from '../match';
import { modelFor } from '../itemTypes';
import { Table } from './database';
import * as engine from './engine';
import { plain } from './engine';

export interface FindOptions {
  sort?: Sort;
  skip?: number;
  limit?: number;
  fields?: string[];
  defaults?: boolean;
}

export interface WriteOptions {
  kind?: string;
  allowUndeclared?: boolean;
  asStored?: boolean;
}

type WriteResult = { matched: number; modified: number };

export const table = new Table('items', 'collection');
const base = () => Item as any;

// The title an item sorts on follows its title, whatever writes it.
function deriveSortTitle(record: any): void {
  if (typeof record.title === 'string') record.sort_title = buildSortTitle(record.title);
}
const deriveOnTitleChange = (record: any, patch: Patch) => {
  if (typeof patch.set?.title === 'string') deriveSortTitle(record);
};

// An item type's own model only ever writes items of that type.
const ofKind = (filter: Filter, kind?: string) => (kind ? F.and(filter, F.eq('kind', kind)) : filter);

export async function find(filter: Filter, options: FindOptions = {}): Promise<any[]> {
  return engine.read(table, filter, options, base);
}

/**
 * The matching items one at a time, in the order find() gives them, for a reader going
 * through a whole collection: each is copied only as it is reached. The items are those
 * that matched when the iteration started, as they stood then.
 */
export async function* each(filter: Filter): AsyncGenerator<any> {
  for (const item of engine.matching(table, filter)) yield plain(item);
}

export async function findOne(filter: Filter, options: Omit<FindOptions, 'skip' | 'limit'> = {}): Promise<any | null> {
  const [row] = engine.read(table, filter, { ...options, limit: 1 }, base);
  return row ?? null;
}

export async function findById(id: string, options: Pick<FindOptions, 'defaults'> = {}): Promise<any | null> {
  return findOne(F.eq('_id', String(id)), options);
}

export async function count(filter: Filter): Promise<number> {
  return engine.matching(table, filter).length;
}

export async function exists(filter: Filter): Promise<boolean> {
  return engine.matching(table, filter).length > 0;
}

export async function distinct(field: string, filter: Filter): Promise<any[]> {
  return engine.distinct(table, field, filter);
}

// Lowercased and trimmed like the MongoDB key it stands in for, whose lowercasing only
// touches ASCII letters. Anything that is not text counts as no creator.
function foldCreator(value: any): string {
  return typeof value === 'string' ? value.trim().replace(/[A-Z]/g, c => c.toLowerCase()) : '';
}

export async function countDistinctWorks(
  filter: Filter,
  creators: { selected?: CreatorFieldSource | undefined; plugins: CreatorFieldSource[] }
): Promise<number> {
  const creatorField = (item: any): string | undefined => {
    if (creators.selected) return creators.selected.creatorField;
    const plugin = creators.plugins.find(p => p.kind === item.kind || (p.matchesLegacyItems && item.kind === undefined));
    return plugin?.creatorField;
  };
  const keys = new Set<string>();
  for (const item of engine.matching(table, filter)) {
    const field = creatorField(item);
    keys.add(`${item.sort_title ?? ''}\u0000${field ? foldCreator(item[field]) : ''}`);
  }
  return keys.size;
}

export async function create(record: Record<string, any>): Promise<any> {
  const input = { ...record };
  deriveSortTitle(input);
  return engine.create(table, modelFor(input.kind), input);
}

export async function insertMany(records: Record<string, any>[], options: { asStored?: boolean } = {}): Promise<void> {
  const inputs = options.asStored ? records : records.map(record => {
    const input = { ...record };
    deriveSortTitle(input);
    return input;
  });
  engine.insertMany(table, input => modelFor(input.kind), inputs, options);
}

function write(many: boolean, filter: Filter, patch: Patch, options: WriteOptions): WriteResult {
  const { result } = engine.update(table, ofKind(filter, options.kind), patch, {
    model: modelFor(options.kind),
    allowUndeclared: !!options.allowUndeclared,
    asStored: !!options.asStored,
    derive: options.asStored ? undefined : deriveOnTitleChange
  } as engine.WriteSettings, many);
  return { matched: result.matched, modified: result.modified };
}

export async function updateOne(filter: Filter, patch: Patch, options: WriteOptions = {}): Promise<WriteResult> {
  return write(false, filter, patch, options);
}

export async function updateMany(filter: Filter, patch: Patch, options: WriteOptions = {}): Promise<WriteResult> {
  return write(true, filter, patch, options);
}

export async function deleteMany(filter: Filter): Promise<number> {
  return engine.remove(table, filter, true);
}

export async function updateListRecord(
  filter: Filter,
  record: { list: string; where: Record<string, Scalar>; set?: Record<string, any>; unset?: string[] },
  item: Patch = {},
  options: WriteOptions = {}
): Promise<WriteResult> {
  const result = engine.updateListRecord(table, ofKind(filter, options.kind), record, item, { model: modelFor(options.kind) });
  return { matched: result.matched, modified: result.modified };
}

const groupKey = (value: any) => (value === undefined || value === null ? '\u0001null' : JSON.stringify(value instanceof Date ? value.toISOString() : String(value?._bsontype === 'ObjectId' ? String(value) : value)));

export async function countBy(field: string, filter: Filter): Promise<{ value: any; count: number }[]> {
  const groups = new Map<string, { value: any; count: number }>();
  for (const item of engine.matching(table, filter)) {
    const value = getPath(item, field);
    const key = Array.isArray(value) ? JSON.stringify(value) : groupKey(value);
    const group = groups.get(key) || { value: value === undefined ? null : plain(value), count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export async function valuesByKind(filter: Filter, fields: string[]): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {};
  for (const item of engine.matching(table, filter)) {
    if (!item.kind) continue;
    const pool = out[item.kind] || (out[item.kind] = []);
    for (const field of fields) {
      const value = getPath(item, field);
      const values = Array.isArray(value) ? value : (value === '' || value === null || value === undefined ? [] : [value]);
      for (const v of values) if (!pool.some(seen => seen === v)) pool.push(plain(v));
    }
  }
  return out;
}

export async function remapValues(filter: Filter, field: string, mapping: [from: Scalar, to: Scalar][]): Promise<number> {
  if (mapping.length === 0) return 0;
  const lookup = new Map(mapping.map(([from, to]) => [from, to]));
  let changed = 0;
  table.transaction(() => {
    for (const held of engine.matching(table, filter)) {
      const value = getPath(held, field);
      if (!lookup.has(value)) continue;
      const item = plain(held);
      applyRawPatch(item, { set: { [field]: lookup.get(value) } });
      table.replace(item);
      changed += 1;
    }
  });
  return changed;
}

export async function updateEach(changes: { id: any; patch: Patch }[]): Promise<number> {
  let modified = 0;
  table.transaction(() => {
    for (const { id, patch } of changes) {
      const held = table.get(String(id));
      const item = held ? plain(held) : null;
      if (item && applyRawPatch(item, patch)) {
        table.replace(item);
        modified += 1;
      }
    }
  });
  return modified;
}

export async function copyField(filter: Filter, from: string, to: string): Promise<number> {
  let modified = 0;
  table.transaction(() => {
    for (const held of engine.matching(table, filter)) {
      const item = plain(held);
      if (applyRawPatch(item, { set: { [to]: getPath(item, from) } })) {
        table.replace(item);
        modified += 1;
      }
    }
  });
  return modified;
}

export { baseFieldNames, registerType, unregisterType, validate } from '../itemTypes';
