/**
 * Core filters, sorts and patches applied to records held in memory.
 *
 * What a store without a query language of its own (SQLite holding records as JSON)
 * runs them with. The semantics are those every store owes the core, spelled out in
 * core/db/filter.ts: a path reaches into lists, a missing field reads as null, text
 * tests ignore case. Ids compare as text whatever object holds them, dates as dates.
 */

import type { Filter, Scalar, Sort } from './filter';
import type { Patch } from './patch';

type Doc = Record<string, any>;

const isPlainObject = (value: any): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !isIdObject(value);

// An id object of the store (an ObjectId): compared and sorted as its text.
function isIdObject(value: any): boolean {
  return value !== null && typeof value === 'object' && value._bsontype === 'ObjectId';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every value a path reaches, walking into lists on the way: `members.user` gives the
 * user of each member. A list at the end of the path is given as itself and as each of
 * its elements, which is how a test on a list field reads its elements.
 */
function reach(doc: any, path: string): { values: any[]; found: boolean } {
  const parts = splitPath(path);
  const values: any[] = [];
  const state = { found: false };
  walkPath(doc, parts, 0, values, state);
  return { values, found: state.found };
}

const splitCache = new Map<string, string[]>();
function splitPath(path: string): string[] {
  let parts = splitCache.get(path);
  if (!parts) {
    parts = path.split('.');
    splitCache.set(path, parts);
  }
  return parts;
}

// Kept a plain recursive function, not a closure made on each call: it runs once per
// record and condition, and is the hottest path of every listing.
function walkPath(value: any, parts: string[], index: number, values: any[], state: { found: boolean }): void {
  if (index === parts.length) {
    state.found = true;
    values.push(value);
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) values.push(value[i]);
    return;
  }
  const key = parts[index]!;
  if (Array.isArray(value)) {
    if (/^\d+$/.test(key)) {
      if (Number(key) < value.length) walkPath(value[Number(key)], parts, index + 1, values, state);
      return;
    }
    for (let i = 0; i < value.length; i++) {
      if (isPlainObject(value[i])) walkPath(value[i], parts, index, values, state);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) return;
  walkPath(value[key], parts, index + 1, values, state);
}

/** The value at a path without walking into lists, or undefined. */
export function getPath(doc: any, path: string): any {
  let value = doc;
  for (const key of splitPath(path)) {
    if (value === null || value === undefined) return undefined;
    value = value instanceof Map ? value.get(key) : value[key];
  }
  return value;
}

function normalize(value: any): any {
  if (isIdObject(value)) return String(value);
  if (value instanceof Date) return value.getTime();
  return value;
}

function same(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  const x = normalize(a);
  const y = normalize(b);
  if (Array.isArray(x) || Array.isArray(y)) {
    return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => same(v, y[i]));
  }
  if (isPlainObject(x) && isPlainObject(y)) {
    const kx = Object.keys(x).filter(k => x[k] !== undefined);
    const ky = Object.keys(y).filter(k => y[k] !== undefined);
    return kx.length === ky.length && kx.every((k, i) => k === ky[i] && same(x[k], y[k]));
  }
  return x === y;
}

function equalsAny(doc: any, field: string, value: Scalar | any[]): boolean {
  const { values, found } = reach(doc, field);
  if (value === null) {
    // null reads as "nothing here": a missing field, a null, or a list holding a null
    return !found || values.some(v => v === null || v === undefined);
  }
  return values.some(v => same(v, value));
}

function textTest(doc: any, field: string, pattern: RegExp): boolean {
  return reach(doc, field).values.some(v => typeof v === 'string' && pattern.test(v));
}

// What an empty list sorts as: below every value, null and missing fields included.
const EMPTY_LIST = Symbol('empty list');

function typeOf(value: any): string {
  if (value === EMPTY_LIST) return 'empty';
  if (Array.isArray(value)) return 'list';
  if (value instanceof Date) return 'date';
  if (isIdObject(value)) return 'id';
  if (value === null) return 'null';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'record';
  return 'other';
}

function inRange(value: any, bounds: { gte?: number | Date; lte?: number | Date }): boolean {
  const comparable = (bound: number | Date) => (bound instanceof Date ? value instanceof Date : typeof value === 'number');
  const n = (v: any) => (v instanceof Date ? v.getTime() : v);
  if (bounds.gte !== undefined && (!comparable(bounds.gte) || n(value) < n(bounds.gte))) return false;
  if (bounds.lte !== undefined && (!comparable(bounds.lte) || n(value) > n(bounds.lte))) return false;
  return true;
}

type Predicate = (doc: any) => boolean;

const compiled = new WeakMap<Filter, Predicate>();

/** The filter as a function of a record, built once per filter (its patterns included). */
function compile(filter: Filter): Predicate {
  const known = compiled.get(filter);
  if (known) return known;
  let test: Predicate;
  switch (filter.op) {
    case 'all': test = () => true; break;
    case 'none': test = () => false; break;
    case 'and': { const parts = filter.filters.map(compile); test = doc => parts.every(p => p(doc)); break; }
    case 'or': { const parts = filter.filters.map(compile); test = doc => parts.some(p => p(doc)); break; }
    case 'not': { const inner = compile(filter.filter); test = doc => !inner(doc); break; }
    case 'eq': { const { field, value } = filter; test = doc => equalsAny(doc, field, value); break; }
    case 'in': { const { field, values } = filter; test = doc => values.some(value => equalsAny(doc, field, value)); break; }
    case 'ci': { const pattern = new RegExp(`^${escapeRegExp(filter.value)}$`, 'i'); const { field } = filter; test = doc => textTest(doc, field, pattern); break; }
    case 'contains': { const pattern = new RegExp(escapeRegExp(filter.value), 'i'); const { field } = filter; test = doc => textTest(doc, field, pattern); break; }
    case 'missing': { const { field } = filter; test = doc => !reach(doc, field).found; break; }
    case 'blank': {
      const { field } = filter;
      test = doc => {
        const { values, found } = reach(doc, field);
        return !found || values.some(v => v === null || v === '' || (Array.isArray(v) && v.length === 0));
      };
      break;
    }
    case 'range': { const bounds = filter; test = doc => reach(doc, bounds.field).values.some(v => !Array.isArray(v) && inRange(v, bounds)); break; }
    case 'some': {
      const inner = compile(filter.filter);
      const { field } = filter;
      test = doc => {
        const list = getPath(doc, field);
        return Array.isArray(list) && list.some(element => isPlainObject(element) && inner(element));
      };
      break;
    }
    case 'size': { const { field, size } = filter; test = doc => { const list = getPath(doc, field); return Array.isArray(list) && list.length === size; }; break; }
    case 'sameAs': {
      const { field, other } = filter;
      test = doc => {
        const a = getPath(doc, field);
        const b = getPath(doc, other);
        return (a === undefined || a === null) && (b === undefined || b === null) ? true : same(a, b);
      };
      break;
    }
    case 'type': { const { field, type } = filter; test = doc => reach(doc, field).values.some(v => typeOf(v) === type); break; }
  }
  compiled.set(filter, test);
  return test;
}

export function matches(doc: Doc, filter: Filter): boolean {
  return compile(filter)(doc);
}

// Order of value types when sorting, smallest first.
const TYPE_RANK: Record<string, number> = { empty: -1, null: 0, number: 1, text: 2, record: 3, list: 4, id: 5, boolean: 6, date: 7, other: 8 };

function compareValues(a: any, b: any): number {
  const ta = typeOf(a === undefined ? null : a);
  const tb = typeOf(b === undefined ? null : b);
  if (ta !== tb) return TYPE_RANK[ta]! - TYPE_RANK[tb]!;
  switch (ta) {
    case 'null': case 'empty': return 0;
    case 'number': return a - b;
    case 'text': return a < b ? -1 : a > b ? 1 : 0;
    case 'boolean': return Number(a) - Number(b);
    case 'date': return a.getTime() - b.getTime();
    case 'id': { const x = String(a); const y = String(b); return x < y ? -1 : x > y ? 1 : 0; }
    default: return 0;
  }
}

// What a record sorts on for one field: a list sorts on its smallest element going up and
// on its largest going down; an empty list sorts below everything, either way.
function sortKey(doc: Doc, field: string, ascending: boolean): any {
  const value = getPath(doc, field);
  if (!Array.isArray(value)) return value === undefined ? null : value;
  if (value.length === 0) return EMPTY_LIST;
  return value.reduce((best, v) => (compareValues(v, best) * (ascending ? 1 : -1) < 0 ? v : best));
}

/** Sorted copy of `docs`; records equal on every field keep their order. */
export function sortDocs<T extends Doc>(docs: T[], sort: Sort | undefined): T[] {
  if (!sort || sort.length === 0) return docs.slice();
  return docs
    .map((doc, index) => ({ doc, index, keys: sort.map(({ field, dir }) => sortKey(doc, field, dir === 'asc')) }))
    .sort((x, y) => {
      for (let i = 0; i < sort.length; i++) {
        const c = compareValues(x.keys[i], y.keys[i]);
        if (c !== 0) return sort[i]!.dir === 'asc' ? c : -c;
      }
      return x.index - y.index;
    })
    .map(entry => entry.doc);
}

/** The distinct values a path holds across records, lists contributing their elements. */
export function distinctValues(docs: Doc[], field: string): any[] {
  const seen = new Map<string, any>();
  for (const doc of docs) {
    const { values } = reach(doc, field);
    for (const v of values) {
      if (Array.isArray(v) || v === undefined) continue;
      const key = distinctKey(v);
      if (!seen.has(key)) seen.set(key, v);
    }
  }
  return [...seen.values()];
}

// Equal values share a key: what `same` tells apart, typed so 1 and "1" stay apart.
function distinctKey(value: any): string {
  if (value instanceof Date) return `d${value.getTime()}`;
  if (isIdObject(value)) return `i${String(value)}`;
  if (value === null) return 'n';
  if (typeof value === 'object') return `o${JSON.stringify(value)}`;
  return `${typeof value}${String(value)}`;
}

function setPath(doc: Doc, path: string, value: any): void {
  const parts = path.split('.');
  let target: any = doc;
  for (const key of parts.slice(0, -1)) {
    if (!isPlainObject(target[key]) && !Array.isArray(target[key])) target[key] = {};
    target = target[key];
  }
  target[parts[parts.length - 1]!] = value;
}

function unsetPath(doc: Doc, path: string): void {
  const parts = path.split('.');
  let target: any = doc;
  for (const key of parts.slice(0, -1)) {
    target = target?.[key];
    if (target === null || typeof target !== 'object') return;
  }
  delete target[parts[parts.length - 1]!];
}

/**
 * Applies a patch to a record as it is stored, with no type rules: values are written
 * exactly as given. Returns whether anything changed.
 */
export function applyRawPatch(doc: Doc, patch: Patch, inserting = false): boolean {
  const before = JSON.stringify(doc);
  for (const [path, value] of Object.entries(patch.set || {})) setPath(doc, path, value);
  if (inserting) for (const [path, value] of Object.entries(patch.setOnInsert || {})) setPath(doc, path, value);
  for (const path of patch.unset || []) unsetPath(doc, path);
  for (const [path, value] of Object.entries(patch.push || {})) {
    const list = getPath(doc, path);
    const additions = value && typeof value === 'object' && Array.isArray(value.each) ? value.each : [value];
    if (Array.isArray(list)) list.push(...additions);
    else setPath(doc, path, [...additions]);
  }
  for (const [path, value] of Object.entries(patch.addToSet || {})) {
    const list = getPath(doc, path);
    if (Array.isArray(list)) {
      if (!list.some(v => same(v, value))) list.push(value);
    } else {
      setPath(doc, path, [value]);
    }
  }
  for (const [path, condition] of Object.entries(patch.pull || {})) {
    const list = getPath(doc, path);
    if (!Array.isArray(list)) continue;
    const isFilter = condition !== null && typeof condition === 'object' && 'op' in (condition as any);
    const kept = list.filter(v => (isFilter ? !(isPlainObject(v) && matches(v, condition as Filter)) : !same(v, condition)));
    setPath(doc, path, kept);
  }
  return JSON.stringify(doc) !== before;
}
