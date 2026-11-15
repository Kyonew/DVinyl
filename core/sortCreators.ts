/**
 * The key an item is sorted on by creator (artist, author, director...), built like the
 * title's: lowercased, accent folded, and without the leading articles its collection
 * ignores, so "The Beatles" files under B next to "Beatles".
 *
 * Which field names an item's creator depends on its type, and the storage layer derives
 * this key on every write with no plugin at hand. So each type tells this module its
 * creator field when it is registered, and the module holds no database import for the
 * same reason as core/sortArticles.ts.
 */

import { buildSortTitle } from './helpers';
import { DEFAULT_SORT_ARTICLES } from './sortArticles';

const byKind = new Map<string, string>();
/** The type that takes the items stored before types existed, which carry no `kind`. */
let legacyKind: string | undefined;

export function rememberCreatorField(kind: string, creatorField: string | undefined, matchesLegacyItems?: boolean): void {
  if (matchesLegacyItems) legacyKind = kind;
  if (creatorField) byKind.set(kind, creatorField);
  else byKind.delete(kind);
}

export function forgetCreatorField(kind: string): void {
  if (legacyKind === kind) legacyKind = undefined;
  byKind.delete(kind);
}

/** The field naming the creator of an item of this kind, or undefined when its type has none. */
export function creatorFieldOf(kind: unknown): string | undefined {
  if (kind == null || kind === '') return legacyKind ? byKind.get(legacyKind) : undefined;
  return typeof kind === 'string' ? byKind.get(kind) : undefined;
}

/** Every creator field some type uses, for a reader that must fetch them all at once. */
export function allCreatorFields(): string[] {
  return [...new Set(byKind.values())];
}

/** Several creators ("A, B") sort on the first one written, the way a shop files them. */
export function buildSortCreator(value: unknown, articles: readonly string[] = DEFAULT_SORT_ARTICLES): string {
  const text = Array.isArray(value)
    ? value.map(v => String(v ?? '').trim()).filter(Boolean).join(', ')
    : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return buildSortTitle(text, articles);
}

/** A value by field path, so a creator kept under `extra.` is read too. */
function valueAt(item: Record<string, any>, path: string): unknown {
  let value: any = item;
  for (const key of path.split('.')) {
    if (value == null || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

/** The creator sort key of a whole item, '' when its type names no creator. */
export function sortCreatorOf(item: Record<string, any>, articles: readonly string[]): string {
  const field = creatorFieldOf(item.kind);
  return field ? buildSortCreator(valueAt(item, field), articles) : '';
}

