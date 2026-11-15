/**
 * The rules of a record type (casting, defaults, validation, unique keys), applied to the
 * records a SQLite table holds.
 *
 * They are read off the record types the app declares as Mongoose schemas, used here as
 * a description only: nothing connects to a MongoDB server. A new record is built through
 * its model, which casts it, fills its defaults and checks it, exactly like a create. A
 * change is cast one path at a time on a scratch record, the way an update casts only
 * what it writes: the rest of the stored record is never re-read through the rules, so a
 * field an older version left malformed does not stop an unrelated write.
 */

import type { Model } from 'mongoose';
import type { Patch } from '../patch';
import { matches, getPath } from '../match';
import * as F from '../filter';

const flat = { flattenMaps: true, depopulate: true } as const;

/** The created/updated field names of a record type that keeps timestamps, if any. */
function timestampFields(model: Model<any>): { created?: string; updated?: string } {
  const option: any = (model.schema as any).options?.timestamps;
  if (!option) return {};
  if (option === true) return { created: 'createdAt', updated: 'updatedAt' };
  return {
    created: option.createdAt === false ? undefined : (typeof option.createdAt === 'string' ? option.createdAt : 'createdAt'),
    updated: option.updatedAt === false ? undefined : (typeof option.updatedAt === 'string' ? option.updatedAt : 'updatedAt')
  };
}

/** A record as its type would create it: cast, defaulted, checked, stamped. Throws when refused. */
export function buildRecord(model: Model<any>, input: Record<string, any>, options: { validate?: boolean } = {}): any {
  const doc: any = new (model as any)(input);
  if (options.validate !== false) {
    const error = doc.validateSync();
    if (error) throw error;
  } else {
    const castOnly = castErrors(doc);
    if (castOnly) throw castOnly;
  }
  const record = doc.toObject(flat);
  const { created, updated } = timestampFields(model);
  const now = new Date();
  if (created && record[created] === undefined) record[created] = now;
  if (updated && record[updated] === undefined) record[updated] = now;
  if (record.__v === undefined && (model.schema as any).options?.versionKey !== false) record.__v = 0;
  return record;
}

// Only the cast failures of a scratch record: an update that does not validate still
// refuses a value of the wrong type.
function castErrors(doc: any, paths?: string[]): any {
  const error = doc.validateSync(paths);
  if (!error) return null;
  const casts = Object.entries(error.errors || {}).filter(([, e]: [string, any]) => e?.name === 'CastError');
  if (casts.length === 0) return null;
  const [, first] = casts[0] as [string, any];
  return first;
}

/**
 * A patch with every value cast by the record type: what a store writes for it. Values
 * on paths the type does not declare are dropped, unless `allowUndeclared`. Throws on a
 * value that cannot be cast, and with `validate` on one the rules refuse.
 */
export function castPatch(
  model: Model<any>,
  patch: Patch,
  options: { allowUndeclared?: boolean; validate?: boolean; seed?: Record<string, any> } = {}
): Patch {
  const out: Patch = { ...patch };
  const probe: any = new (model as any)(options.seed || {});
  const touched: string[] = [];
  // Written on the scratch record the way an update would write it: a path the type does
  // not declare is dropped there (strict), and kept with `allowUndeclared`.
  const castValue = (path: string, value: any): { keep: boolean; value: any } => {
    if (value === undefined) return { keep: true, value };
    probe.set(path, value, undefined, options.allowUndeclared ? { strict: false } : undefined);
    touched.push(path);
    const read = getPath(probe.toObject(flat), path);
    return read === undefined ? { keep: false, value } : { keep: true, value: read };
  };

  if (patch.set) {
    out.set = {};
    for (const [path, value] of Object.entries(patch.set)) {
      const cast = castValue(path, value);
      if (cast.keep) out.set[path] = cast.value;
    }
  }
  if (patch.setOnInsert) {
    out.setOnInsert = {};
    for (const [path, value] of Object.entries(patch.setOnInsert)) {
      const cast = castValue(path, value);
      if (cast.keep) out.setOnInsert[path] = cast.value;
    }
  }
  // An element added to a list is cast as a list of one, which also gives a record its id.
  const castElement = (path: string, value: any) => {
    const cast = castValue(path, [value]);
    return cast.keep ? { keep: true, value: Array.isArray(cast.value) ? cast.value[0] : cast.value } : cast;
  };
  if (patch.push) {
    out.push = {};
    for (const [path, value] of Object.entries(patch.push)) {
      const many = value && typeof value === 'object' && Array.isArray((value as any).each);
      const elements = many ? (value as any).each : [value];
      const cast = elements.map((element: any) => castElement(path, element));
      if (cast.every((c: any) => c.keep)) out.push[path] = { each: cast.map((c: any) => c.value) };
    }
  }
  if (patch.addToSet) {
    out.addToSet = {};
    for (const [path, value] of Object.entries(patch.addToSet)) {
      const cast = castElement(path, value);
      if (cast.keep) out.addToSet[path] = cast.value;
    }
  }

  const error = options.validate ? probe.validateSync(touched) : castErrors(probe, touched);
  if (error && (options.validate ? Object.keys(error.errors || {}).some(p => touched.some(t => p === t || p.startsWith(`${t}.`))) : true)) {
    throw error;
  }
  return out;
}

/** The field the record type stamps with the time of every change, if any. */
export function updatedField(model: Model<any>): string | undefined {
  return timestampFields(model).updated;
}

interface UniqueKey {
  fields: string[];
  sparse: boolean;
  partial?: F.Filter;
}

const keysCache = new WeakMap<object, UniqueKey[]>();

/** The unique keys a record type declares, from its indexes. */
export function uniqueKeys(model: Model<any>): UniqueKey[] {
  const cached = keysCache.get(model.schema);
  if (cached) return cached;
  const keys: UniqueKey[] = [];
  for (const [fields, options] of (model.schema as any).indexes() as [Record<string, any>, any][]) {
    if (!options?.unique) continue;
    const key: UniqueKey = { fields: Object.keys(fields), sparse: !!options.sparse };
    if (options.partialFilterExpression) {
      // Only presence conditions are ever used in a partial index here.
      key.partial = F.and(...Object.entries(options.partialFilterExpression).map(([path, test]: [string, any]) =>
        test && typeof test === 'object' && '$exists' in test ? (test.$exists ? F.exists(path) : F.missing(path)) : F.eq(path, test)));
    }
    keys.push(key);
  }
  if (!keys.some(k => k.fields.length === 1 && k.fields[0] === '_id')) keys.push({ fields: ['_id'], sparse: false });
  keysCache.set(model.schema, keys);
  return keys;
}

// Every tuple of values a record holds for a key: a field reaching into a list gives
// one value per element, as a multikey index reads it.
function keyTuples(record: any, key: UniqueKey): string[] | null {
  if (key.partial && !matches(record, key.partial)) return null;
  const perField = key.fields.map(field => {
    const values = reachValues(record, field);
    return values.length === 0 ? [null] : values;
  });
  if (key.sparse && perField.every(values => values.length === 1 && values[0] === null)) return null;
  let tuples: string[] = [''];
  for (const values of perField) {
    tuples = tuples.flatMap(prefix => values.map(v => `${prefix}\u0000${v === null || v === undefined ? '\u0001null' : String(v)}`));
  }
  return [...new Set(tuples)];
}

function reachValues(record: any, path: string): any[] {
  const out: any[] = [];
  const walk = (value: any, parts: string[]) => {
    if (value === undefined) return;
    if (parts.length === 0) {
      if (Array.isArray(value)) out.push(...value);
      else out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const element of value) walk(element, parts);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    walk(value[parts[0]!], parts.slice(1));
  };
  walk(record, path.split('.'));
  return out;
}

/** Whether the record type declares any unique key besides the id. */
export function hasUniqueKeys(model: Model<any>): boolean {
  return uniqueKeys(model).some(k => !(k.fields.length === 1 && k.fields[0] === '_id'));
}

/**
 * Throws the store's duplicate error when `record` holds a value another record already
 * holds on a unique key. `others` are the table's other records.
 */
export function checkUnique(model: Model<any>, record: any, others: Iterable<any>): void {
  const keys = uniqueKeys(model).filter(k => !(k.fields.length === 1 && k.fields[0] === '_id'));
  if (keys.length === 0) return;
  const own = keys.map(key => keyTuples(record, key));
  if (own.every(t => !t)) return;
  const id = String(record._id);
  for (const other of others) {
    if (String(other._id) === id) continue;
    keys.forEach((key, index) => {
      const mine = own[index];
      if (!mine) return;
      const theirs = keyTuples(other, key);
      if (theirs && theirs.some(t => mine.includes(t))) {
        throw duplicateError(key.fields);
      }
    });
  }
}

/** The error a store throws for a value a unique key already holds (see core/db/errors.ts). */
export function duplicateError(fields: string[]): Error {
  return Object.assign(new Error(`E11000 duplicate key: ${fields.join(', ')}`), {
    code: 11000,
    keyPattern: Object.fromEntries(fields.map(field => [field, 1]))
  });
}
