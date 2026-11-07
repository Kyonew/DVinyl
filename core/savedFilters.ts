import { randomBytes } from 'crypto';

/**
 * Named views of the collection page ("7\" singles", "45 RPM"), kept per collection and
 * shared by its members. A saved filter is nothing but the page's own query string, so
 * whatever the page can filter, sort or show can be saved, now and as it grows, and
 * opening one is following a link.
 */

export interface SavedFilter {
  id: string;
  name: string;
  query: string;
}

export const MAX_SAVED_FILTERS = 30;
const MAX_NAME = 60;
const MAX_QUERY = 2000;
// Where the reader is on the page, not what they are looking at.
const NOT_PART_OF_A_VIEW = new Set(['page', 'furniture']);

/**
 * A query in one canonical spelling: parameters sorted, empty ones and paging dropped.
 * Two links that show the same thing then compare equal, which is how the page tells
 * which saved filter is the one being looked at.
 */
export function canonicalQuery(input: unknown): string {
  const params = new URLSearchParams();
  const source = typeof input === 'string'
    ? new URLSearchParams(input.replace(/^\?/, ''))
    : new URLSearchParams(Object.entries((input as Record<string, any>) || {}).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string').map(v => [key, v] as [string, string])));
  const pairs = [...source.entries()]
    .filter(([key, value]) => key && value.trim() !== '' && !NOT_PART_OF_A_VIEW.has(key))
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  for (const [key, value] of pairs) params.append(key, value);
  return params.toString();
}

/** The stored list, read defensively: whatever is not a well-formed entry is skipped. */
export function savedFiltersOf(settings: any): SavedFilter[] {
  const list = Array.isArray(settings?.savedFilters) ? settings.savedFilters : [];
  return list
    .filter((f: any) => f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.query === 'string')
    .map((f: any) => ({ id: f.id, name: f.name, query: f.query }));
}

/** A new entry from what a form posted, or the reason it is refused. */
export function newSavedFilter(name: unknown, query: unknown): SavedFilter | { error: string } {
  const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!cleanName) return { error: 'name_required' };
  const cleanQuery = canonicalQuery(String(query ?? '').slice(0, MAX_QUERY));
  if (!cleanQuery) return { error: 'nothing_to_save' };
  return { id: randomBytes(6).toString('hex'), name: cleanName, query: cleanQuery };
}
