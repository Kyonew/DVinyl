/**
 * A change to apply to stored records, said without reference to any database.
 */

import type { Filter, Scalar } from './filter';

export interface Patch {
  /** Values to write, by field path. */
  set?: Record<string, any>;
  /** Values written only when an upsert creates the record. */
  setOnInsert?: Record<string, any>;
  /** Fields to remove. */
  unset?: string[];
  /** Values to append to a list, by list field: one value, or several with `each`. */
  push?: Record<string, any>;
  /** A value to add to a list unless an equal one is already there. */
  addToSet?: Record<string, any>;
  /**
   * Entries to take out of a list, by list field: a plain value, or for a list of
   * records a filter on the entry's own fields.
   */
  pull?: Record<string, Scalar | Filter>;
}

/** Several values for `push`, appended in order. */
export function each(values: any[]): { each: any[] } {
  return { each: values };
}
