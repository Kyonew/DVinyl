/**
 * Reading and writing the records of one SQLite table with core filters and patches.
 * Shared by the item store and the record stores; the record type each write goes
 * through is the caller's to pick (an item's own type, or the store's single one).
 *
 * Every function runs to completion without yielding between its reads and its writes
 * (the SQLite driver is synchronous), so a check made before a write still holds when
 * the write lands, which is what keeps unique keys unique.
 */

import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { Filter, Scalar, Sort } from '../filter';
import * as F from '../filter';
import type { Patch } from '../patch';
import { applyRawPatch, distinctValues, getPath, matches, sortDocs } from '../match';
import { Table } from './database';
import { buildRecord, castPatch, checkUnique, hasUniqueKeys, updatedField } from './rules';
import { firstInvalid } from '../errors';

export interface ReadOptions {
  sort?: Sort;
  skip?: number;
  limit?: number;
  fields?: string[];
  defaults?: boolean;
}

export type WriteResult = { matched: number; modified: number; upserted: boolean };

/** A copy of a record held in memory, safe to change or hand out. */
export const plain = (doc: any) => structuredCloneSafe(doc);

// A deep copy that keeps ids and dates as they are.
function structuredCloneSafe(value: any): any {
  if (Array.isArray(value)) return value.map(structuredCloneSafe);
  if (value instanceof Date) return new Date(value.getTime());
  if (value && typeof value === 'object' && value._bsontype === 'ObjectId') return value;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = structuredCloneSafe(v);
    return out;
  }
  return value;
}

/** Keeps only `fields` (and the id), reaching into lists of records like a projection. */
export function project(doc: any, fields: string[]): any {
  const out: any = { _id: doc._id };
  for (const field of fields) {
    if (field === '_id') continue;
    copyPath(doc, out, field.split('.'));
  }
  return out;
}

function copyPath(source: any, target: any, parts: string[]): void {
  const [head, ...rest] = parts;
  if (head === undefined || source === null || typeof source !== 'object' || !(head in source)) return;
  const value = source[head];
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  if (Array.isArray(value)) {
    const existing = Array.isArray(target[head]) ? target[head] : value.map(() => ({}));
    value.forEach((element, i) => {
      if (element && typeof element === 'object' && !Array.isArray(element)) copyPath(element, existing[i], rest);
    });
    target[head] = existing.filter((e: any, i: number) => value[i] && typeof value[i] === 'object');
    return;
  }
  if (value && typeof value === 'object') {
    target[head] = target[head] && typeof target[head] === 'object' ? target[head] : {};
    copyPath(value, target[head], rest);
  }
}

export function matching(table: Table, filter: Filter): any[] {
  return table.candidates(filter).filter(doc => matches(doc, filter));
}

export function read(table: Table, filter: Filter, options: ReadOptions, hydrateWith: (doc: any) => Model<any>): any[] {
  let docs = sortDocs(matching(table, filter), options.sort);
  if (options.skip) docs = docs.slice(options.skip);
  if (options.limit) docs = docs.slice(0, options.limit);
  docs = docs.map(doc => plain(options.fields ? project(doc, options.fields) : doc));
  if (options.defaults) docs = docs.map(doc => (hydrateWith(doc) as any).hydrate(doc).toObject());
  return docs;
}

export function distinct(table: Table, field: string, filter: Filter): any[] {
  return distinctValues(matching(table, filter), field).map(plain);
}

/** A record built and checked by its type, then stored. */
export function create(table: Table, model: Model<any>, input: Record<string, any>): any {
  const record = buildRecord(model, input);
  return table.transaction(() => {
    if (hasUniqueKeys(model)) checkUnique(model, record, table.candidates(F.all()));
    else if (table.get(String(record._id))) throw duplicateId();
    table.insert(record);
    return plain(record);
  });
}

export function insertMany(
  table: Table,
  modelOf: (record: any) => Model<any>,
  inputs: Record<string, any>[],
  options: { asStored?: boolean } = {}
): void {
  if (inputs.length === 0) return;
  const records = options.asStored
    ? inputs.map(input => plain(input._id === undefined ? { _id: new Types.ObjectId(), ...input } : input))
    : inputs.map(input => buildRecord(modelOf(input), input));
  table.transaction(() => {
    const checked = records.some(record => !options.asStored && hasUniqueKeys(modelOf(record)));
    const existing = checked ? table.candidates(F.all()) : [];
    const ids = new Set<string>();
    for (const record of records) {
      const id = String(record._id);
      if (ids.has(id) || table.get(id)) throw duplicateId();
      ids.add(id);
      if (checked) checkUnique(modelOf(record), record, existing);
      table.insert(record);
      existing.push(record);
    }
  });
}

function duplicateId(): Error {
  return Object.assign(new Error('E11000 duplicate key: _id'), { code: 11000, keyPattern: { _id: 1 } });
}

export function validate(model: Model<any>, record: Record<string, any>): { field: string; message: string } | null {
  return firstInvalid(new (model as any)(record).validateSync());
}

// The equality conditions a filter requires at its top level: what an upsert creates
// the record from.
function equalities(filter: Filter): Record<string, any> {
  const required = filter.op === 'and' ? filter.filters : [filter];
  const out: Record<string, any> = {};
  for (const condition of required) {
    if (condition.op === 'eq' && condition.value !== null) out[condition.field] = condition.value;
  }
  return out;
}

export interface WriteSettings {
  /** The type the record is written as. */
  model: Model<any>;
  allowUndeclared?: boolean;
  asStored?: boolean;
  validate?: boolean;
  upsert?: boolean;
  /** Runs on each record the patch is applied to, after it (an item's derived fields). */
  derive?: (record: any, patch: Patch) => void;
}

export function update(table: Table, filter: Filter, patch: Patch, settings: WriteSettings, many: boolean): { result: WriteResult; records: any[] } {
  return table.transaction(() => {
    const found = matching(table, filter);
    const targets = (many ? found : found.slice(0, 1)).map(plain);

    if (targets.length === 0) {
      if (!settings.upsert) return { result: { matched: 0, modified: 0, upserted: false }, records: [] };
      const seed: any = {};
      applyRawPatch(seed, { set: equalities(filter) });
      applyRawPatch(seed, { set: patch.set || {}, setOnInsert: patch.setOnInsert || {} }, true);
      const record = settings.asStored ? { _id: new Types.ObjectId(), ...seed } : buildRecord(settings.model, seed, { validate: false });
      if (!settings.asStored) settings.derive?.(record, patch);
      if (hasUniqueKeys(settings.model)) checkUnique(settings.model, record, table.candidates(F.all()));
      table.insert(record);
      return { result: { matched: 0, modified: 0, upserted: true }, records: [plain(record)] };
    }

    const written = settings.asStored
      ? patch
      : castPatch(settings.model, patch, { allowUndeclared: !!settings.allowUndeclared, validate: !!settings.validate });
    const stamp = settings.asStored ? undefined : updatedField(settings.model);
    const others = !settings.asStored && hasUniqueKeys(settings.model) ? table.candidates(F.all()) : null;
    let modified = 0;
    for (const record of targets) {
      let changed = applyRawPatch(record, { ...written, setOnInsert: {} });
      if (!settings.asStored) {
        settings.derive?.(record, patch);
        if (stamp) {
          record[stamp] = new Date();
          changed = true;
        }
        if (others) checkUnique(settings.model, record, others.map(o => (String(o._id) === String(record._id) ? record : o)));
      }
      if (changed) {
        table.replace(record);
        modified += 1;
      }
    }
    return { result: { matched: targets.length, modified, upserted: false }, records: targets.map(plain) };
  });
}

/**
 * Changes one entry of a list of records on the first matching record: the first entry
 * whose `where` fields hold the given values. `own` changes the record itself.
 */
export function updateListRecord(
  table: Table,
  filter: Filter,
  entry: { list: string; where: Record<string, Scalar>; set?: Record<string, any>; unset?: string[] },
  own: Patch,
  settings: WriteSettings
): WriteResult {
  return table.transaction(() => {
    const whereFilter = F.and(...Object.entries(entry.where).map(([k, v]) => F.eq(k, v)));
    const held = matching(table, filter).find(doc => {
      const list = getPath(doc, entry.list);
      return Array.isArray(list) && list.some(element => element && typeof element === 'object' && matches(element, whereFilter));
    });
    if (!held) return { matched: 0, modified: 0, upserted: false };

    const record = plain(held);
    const list = getPath(record, entry.list) as any[];
    const index = list.findIndex(element => element && typeof element === 'object' && matches(element, whereFilter));
    const element = list[index];

    // Cast on a scratch record holding that one entry, so its fields read their own rules.
    const castEntry = castPatch(settings.model, {
      set: Object.fromEntries(Object.entries(entry.set || {}).map(([k, v]) => [`${entry.list}.0.${k}`, v]))
    }, { seed: { [entry.list]: [element] } } as any);
    for (const [path, value] of Object.entries(castEntry.set || {})) element[path.slice(`${entry.list}.0.`.length)] = value;
    for (const field of entry.unset || []) delete element[field];

    const castOwn = castPatch(settings.model, own, {});
    applyRawPatch(record, castOwn);
    const stamp = updatedField(settings.model);
    if (stamp) record[stamp] = new Date();
    table.replace(record);
    return { matched: 1, modified: 1, upserted: false };
  });
}

export function remove(table: Table, filter: Filter, many: boolean): number {
  return table.transaction(() => {
    const found = matching(table, filter);
    return table.remove((many ? found : found.slice(0, 1)).map(doc => String(doc._id)));
  });
}
