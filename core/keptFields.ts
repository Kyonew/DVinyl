/**
 * What an owner wrote by hand outlives a metadata refresh.
 *
 * An item remembers, in `kept_fields`, the fields its owner changed in the edit form. A
 * refresh leaves those alone and only notes what the source would have written, in
 * `source_values`, so the edit form can offer it back. Nothing here knows which fields a
 * type has or which ones its source fills in: the summary of a board game, the cover of a
 * film and the title of a card all go through the same two steps.
 */

// Paths that are the owner's own business or the app's bookkeeping, never a source's.
// Changing them is not overriding anything, so it marks nothing.
const NEVER_KEPT = new Set([
  '_id', '__v', 'kind', 'owner', 'collection', 'parent', 'inside', 'quantity', 'added_at', 'created_at', 'updated_at',
  'modified_at', 'modified_by', 'synced_at', 'in_wishlist', 'comments', 'location', 'barcode_locked',
  'sort_title', 'source', 'source_id', 'kept_fields', 'source_values', 'images', 'user_image', 'extra',
  'purchase_price', 'purchase_currency'
]);

/** A value in the form two of them can be compared in, whatever round trip it made. */
function comparable(value: any): any {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  // An empty list says nothing was filled in, as an absent field does.
  if (Array.isArray(value)) return value.length === 0 ? '' : value.map(comparable);
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparable(value[key])]));
  }
  // A textarea posts its line breaks as CRLF, and a number comes back as text.
  return String(value).replace(/\r\n?/g, '\n').trim();
}

export function sameValue(a: any, b: any): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

const keptOf = (item: any): string[] => (Array.isArray(item?.kept_fields) ? item.kept_fields.map(String) : []);
const sourceValuesOf = (item: any): Record<string, any> =>
  item?.source_values && typeof item.source_values === 'object' ? { ...item.source_values } : {};

/**
 * A refresh patch with the owner's fields taken out of it. What the source said about
 * them goes into `source_values` instead, and only for those fields: the others are
 * written, so there is nothing to offer back.
 */
export function keepOwnerValues(item: any, patch: Record<string, any>): Record<string, any> {
  const kept = keptOf(item);
  if (kept.length === 0 || !patch) return patch;

  const result = { ...patch };
  const sourceValues = sourceValuesOf(item);
  let noted = false;
  for (const field of kept) {
    if (!(field in result)) continue;
    sourceValues[field] = result[field];
    delete result[field];
    noted = true;
  }
  if (noted) result.source_values = sourceValues;
  return result;
}

/**
 * What an edit-form save means for the fields kept across refreshes, read off the item
 * before and after the save. Returns the patch to write on top of it, or null.
 *
 * - A field the owner changed is kept, unless they changed it back to what the source
 *   says, which is the same as not overriding it.
 * - A field named in `reverted` is handed back to the source: it takes the value the
 *   last refresh noted, when there is one, and the next refresh is free to write it.
 */
export function trackOwnerEdits(
  before: any,
  after: any,
  reverted: string[] = [],
  ignored: Iterable<string> = []
): { set: Record<string, any>; unset: string[] } | null {
  const skip = new Set([...NEVER_KEPT, ...ignored]);
  const kept = new Set(keptOf(before));
  const sourceValues = sourceValuesOf(before);
  const set: Record<string, any> = {};
  const handedBack = new Set(reverted.filter(field => kept.has(field)));

  for (const field of handedBack) {
    kept.delete(field);
    if (field in sourceValues) {
      set[field] = sourceValues[field];
      delete sourceValues[field];
    }
  }

  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const field of fields) {
    if (skip.has(field) || field.startsWith('extra.') || handedBack.has(field)) continue;
    if (sameValue(before?.[field], after?.[field])) continue;
    if (field in sourceValues && sameValue(after?.[field], sourceValues[field])) {
      kept.delete(field);
      delete sourceValues[field];
    } else {
      kept.add(field);
    }
  }

  const keptList = [...kept].sort();
  const keptChanged = !sameValue(keptList, [...keptOf(before)].sort());
  const sourceChanged = !sameValue(sourceValues, sourceValuesOf(before));
  if (!keptChanged && !sourceChanged && Object.keys(set).length === 0) return null;

  // Emptied rather than written empty: an empty object is not stored at all, so writing
  // one would leave the old values in place.
  const unset: string[] = [];
  if (keptList.length > 0) set.kept_fields = keptList; else unset.push('kept_fields');
  if (Object.keys(sourceValues).length > 0) set.source_values = sourceValues; else unset.push('source_values');
  return { set, unset };
}

/** The kept fields the edit form can offer back: those a refresh has a value for. */
export function offeredSourceValues(item: any): { field: string; value: any }[] {
  const sourceValues = sourceValuesOf(item);
  return keptOf(item).filter(field => field in sourceValues).map(field => ({ field, value: sourceValues[field] }));
}
