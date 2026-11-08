/**
 * Items kept inside another one: the film of a boxset, the games of a compilation box,
 * the albums of a CD box. One card per object on the shelf, which is what a collector
 * counts, while each thing inside stays a real item with its own page and metadata.
 *
 * `inside` holds the box's id. It is not `parent`, which ties a TV season to its show:
 * a season may sit under its show and inside a boxset at once. One level only: a box is
 * never put in another box, and an item holding others is not put anywhere.
 *
 * An item inside a box leaves the grid and the counts like a season does, comes back in
 * a search, and is reached from the box's page. Taking the box away (deleting it, moving
 * it to another collection or to the wishlist) puts what it held back on the shelf.
 */
import { registry } from './registry';
import { db } from './db';
import { and, contains, eq, isIn, missing, ne, Filter } from './db/filter';
import { idOf, isId } from './db/ids';

export const INSIDE_FIELD = 'inside';

export type InsideError = 'not_found' | 'same_item' | 'box_inside' | 'holds_items' | 'wishlist';

/** What a box holds, as the page lists it. */
export async function contentsOf(boxId: any, visible: Filter): Promise<any[]> {
  return db.items.find(and(eq(INSIDE_FIELD, idOf(boxId)), visible));
}

/** Whether an item holds anything. */
export async function holdsItems(itemId: any): Promise<boolean> {
  return db.items.exists(eq(INSIDE_FIELD, idOf(itemId)));
}

/**
 * Puts `itemId` inside `boxId`, both in `collectionId`. Returns why it cannot be done,
 * or null once done.
 */
export async function putInside(collectionId: any, itemId: any, boxId: any): Promise<InsideError | null> {
  if (!isId(itemId) || !isId(boxId)) return 'not_found';
  if (String(itemId) === String(boxId)) return 'same_item';
  const inCollection = (id: any) => and(eq('_id', idOf(id)), eq('collection', idOf(collectionId)));
  const [item, box] = await Promise.all([
    db.items.findOne(inCollection(itemId)),
    db.items.findOne(inCollection(boxId))
  ]);
  if (!item || !box) return 'not_found';
  if (item.in_wishlist || box.in_wishlist) return 'wishlist';
  // One level: a box sits on the shelf itself, and a season under its show is no box.
  if (box.inside || box.parent) return 'box_inside';
  if (await holdsItems(itemId)) return 'holds_items';
  await db.items.updateOne(eq('_id', idOf(itemId)), { set: { [INSIDE_FIELD]: idOf(boxId) } });
  return null;
}

/** Takes an item out of its box, back onto the shelf. */
export async function takeOut(collectionId: any, itemId: any): Promise<boolean> {
  if (!isId(itemId)) return false;
  const result: any = await db.items.updateOne(
    and(eq('_id', idOf(itemId)), eq('collection', idOf(collectionId))),
    { unset: [INSIDE_FIELD] }
  );
  return !!result;
}

/**
 * Puts back on the shelf whatever the given boxes held, and takes the given items out of
 * any box. Called before the boxes go away or leave the collection.
 */
export async function releaseBoxes(ids: any[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const wanted = ids.map(idOf);
  await db.items.updateMany(isIn(INSIDE_FIELD, wanted), { unset: [INSIDE_FIELD] });
  await db.items.updateMany(isIn('_id', wanted), { unset: [INSIDE_FIELD] });
}

/**
 * Boxes an item could go in: what stands on the shelf of the collection, the item itself
 * and what is already inside a box left out, matched on the title.
 */
export async function boxCandidates(collectionId: any, itemId: any, query: string, visible: Filter): Promise<any[]> {
  const text = String(query || '').trim().slice(0, 100);
  return db.items.find(and(
    eq('collection', idOf(collectionId)),
    eq('in_wishlist', false),
    isId(itemId) ? ne('_id', idOf(itemId)) : null,
    missing(INSIDE_FIELD),
    missing('parent'),
    text ? contains('title', text) : null,
    visible
  ), { limit: 12, sort: [{ field: 'title', dir: 'asc' }], fields: ['title', 'kind', 'cover_image', 'images', 'year'] });
}

/** The page of an item of any type, for a link from another type's page. */
export function itemHref(item: any): string | null {
  const plugin = registry.getByKind(item?.kind);
  return plugin ? `${plugin.routePrefix}/${item._id}` : null;
}
