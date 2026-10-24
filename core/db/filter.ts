/**
 * The query language the core speaks to its storage.
 *
 * A filter says which records to match without saying how a database finds them: routes,
 * helpers and plugins build these, and only the storage layer turns them into its own
 * queries. Nothing here knows a field name; a field is any path into a record, dotted for
 * a nested value (`extra.custom_0123456789ab`).
 *
 * Every test on a field holding a list applies to its elements: `eq('genres', 'Rock')`
 * matches a record whose genres include "Rock", as one holding "Rock" as a plain value.
 * A missing field reads as null, so `eq(field, null)` and `in(field, [null])` also match
 * the records that never had it.
 */

export type Scalar = string | number | boolean | Date | null;

export type Filter =
  | { op: 'all' }
  | { op: 'none' }
  | { op: 'and'; filters: Filter[] }
  | { op: 'or'; filters: Filter[] }
  | { op: 'not'; filter: Filter }
  | { op: 'eq'; field: string; value: Scalar }
  | { op: 'in'; field: string; values: Scalar[] }
  /** Equal as text, ignoring case. */
  | { op: 'ci'; field: string; value: string }
  /** Holds the text somewhere, ignoring case. The text is literal, never a pattern. */
  | { op: 'contains'; field: string; value: string }
  /** The field is absent from the record. */
  | { op: 'missing'; field: string }
  /** Absent, null, an empty text or an empty list: nothing filled in. */
  | { op: 'blank'; field: string }
  /** Within bounds, both included. Numbers compare as numbers, dates as dates. */
  | { op: 'range'; field: string; gte?: number | Date; lte?: number | Date }
  /** A list holding no element at all (not an absent field). */
  | { op: 'emptyList'; field: string }
  /** One record of a list of records matches `filter`, whose fields are the record's own. */
  | { op: 'some'; field: string; filter: Filter };

export type SortDirection = 'asc' | 'desc';
export type Sort = { field: string; dir: SortDirection }[];

export const all = (): Filter => ({ op: 'all' });
export const none = (): Filter => ({ op: 'none' });

/** Every filter at once. `all` members drop out, a `none` member wins, nested ands flatten. */
export function and(...filters: (Filter | null | undefined)[]): Filter {
  const flat: Filter[] = [];
  for (const filter of filters) {
    if (!filter || filter.op === 'all') continue;
    if (filter.op === 'none') return none();
    if (filter.op === 'and') flat.push(...filter.filters);
    else flat.push(filter);
  }
  if (flat.length === 0) return all();
  return flat.length === 1 ? flat[0]! : { op: 'and', filters: flat };
}

/** Any of the filters. An empty list matches nothing. */
export function or(...filters: (Filter | null | undefined)[]): Filter {
  const flat: Filter[] = [];
  for (const filter of filters) {
    if (!filter || filter.op === 'none') continue;
    if (filter.op === 'all') return all();
    if (filter.op === 'or') flat.push(...filter.filters);
    else flat.push(filter);
  }
  if (flat.length === 0) return none();
  return flat.length === 1 ? flat[0]! : { op: 'or', filters: flat };
}

export function not(filter: Filter): Filter {
  if (filter.op === 'all') return none();
  if (filter.op === 'none') return all();
  if (filter.op === 'not') return filter.filter;
  return { op: 'not', filter };
}

export const eq = (field: string, value: Scalar): Filter => ({ op: 'eq', field, value });
export const ne = (field: string, value: Scalar): Filter => not(eq(field, value));
export const ci = (field: string, value: string): Filter => ({ op: 'ci', field, value });
export const contains = (field: string, value: string): Filter => ({ op: 'contains', field, value });
export const missing = (field: string): Filter => ({ op: 'missing', field });
export const exists = (field: string): Filter => not(missing(field));
export const blank = (field: string): Filter => ({ op: 'blank', field });
export const filled = (field: string): Filter => not(blank(field));

export function isIn(field: string, values: Scalar[]): Filter {
  return values.length === 0 ? none() : { op: 'in', field, values };
}

export function notIn(field: string, values: Scalar[]): Filter {
  return values.length === 0 ? all() : not(isIn(field, values));
}

export function range(field: string, bounds: { gte?: number | Date; lte?: number | Date }): Filter {
  const filter: Filter = { op: 'range', field };
  if (bounds.gte !== undefined) filter.gte = bounds.gte;
  if (bounds.lte !== undefined) filter.lte = bounds.lte;
  return filter.gte === undefined && filter.lte === undefined ? all() : filter;
}

export const some = (field: string, filter: Filter): Filter => ({ op: 'some', field, filter });
export const emptyList = (field: string): Filter => ({ op: 'emptyList', field });

export const asc = (field: string) => ({ field, dir: 'asc' as const });
export const desc = (field: string) => ({ field, dir: 'desc' as const });

/**
 * The same text as `value` ignoring case, or, when `value` is empty, no text at all
 * (absent or empty). How two copies are told apart by an optional detail such as a
 * colour variant: two copies that both leave it out are the same edition.
 */
export function textOrUnset(field: string, value: string | null | undefined): Filter {
  const text = (value ?? '').trim();
  return text ? ci(field, text) : or(missing(field), eq(field, ''));
}
