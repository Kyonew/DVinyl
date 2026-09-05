import Furniture from '../models/Furniture';
import Item from '../models/Item';
import {
  locationKey, normalizeLocationName, capacityPerFurniture, fitGrid, MAX_FURNITURE_ROWS
} from '../utils/shelfHelpers';

/** Every shelf in a collection, in the spelling its furniture holds. */
export async function shelfNames(collectionId: any): Promise<string[]> {
  const furnitureList = await Furniture.find({ collection: collectionId }).select('cells.name').lean();
  return furnitureList.flatMap((piece: any) => (piece.cells || []).map((cell: any) => cell.name));
}

/**
 * Everywhere an item could be said to be kept: the collection's shelves first, plus any
 * value still stored on an item that names none of them, so a stray left by an import
 * or an older backup stays pickable instead of vanishing from the choices. Deduped on
 * the shelf key, the furniture's spelling winning.
 */
export async function shelfChoices(collectionId: any): Promise<string[]> {
  const [names, stored] = await Promise.all([
    shelfNames(collectionId),
    Item.distinct('location', { collection: collectionId, location: { $nin: ['', null] } })
  ]);

  const byKey = new Map<string, string>();
  for (const value of [...names, ...stored]) {
    const key = locationKey(value);
    if (key && !byKey.has(key)) byKey.set(key, normalizeLocationName(value));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Turns whatever was said about where an item lives into the name of a real shelf.
 *
 * This is the only way `location` should ever be written. Every caller hands it raw
 * text (a form, an importer, a bulk action), and it answers with the one spelling the
 * collection uses, creating the shelf if the collection has never heard of it. Bypass
 * it anywhere and the duplicates the migration merged come straight back.
 *
 * Returns '' for anything that names no place, which is how an item is taken off its
 * shelf without being given another.
 */
export async function resolveShelfLocation(collectionId: any, raw: unknown): Promise<string> {
  const name = normalizeLocationName(raw);
  const key = locationKey(name);
  if (!key) return '';

  const furnitureList = await Furniture.find({ collection: collectionId }).sort({ order: 1, created_at: 1 });

  const holder = furnitureList.find((piece: any) => (piece.cells || []).some((cell: any) => cell.key === key));
  if (holder) {
    return (holder.cells as any[]).find((cell: any) => cell.key === key).name;
  }

  // Somewhere to put it: the first piece of furniture with a free compartment, else a
  // new piece of its own.
  const target = furnitureList.find((piece: any) => (piece.cells || []).length < capacityPerFurniture(piece.columns));

  try {
    if (target) {
      const taken = new Set((target.cells as any[]).map((cell: any) => `${cell.row}:${cell.column}`));
      let placed = false;

      for (let row = 0; row < MAX_FURNITURE_ROWS && !placed; row++) {
        for (let column = 0; column < target.columns && !placed; column++) {
          if (taken.has(`${row}:${column}`)) continue;
          (target.cells as any[]).push({ name, key, row, column, capacity: 0 });
          // The furniture grows a row rather than hiding the new compartment below its
          // own floor.
          if (row + 1 > target.rows) target.rows = row + 1;
          placed = true;
        }
      }

      if (placed) {
        await target.save();
        return name;
      }
    }

    const { columns, rows } = fitGrid(1);
    await Furniture.create({
      collection: collectionId,
      name,
      layout: 'cubes',
      columns,
      rows,
      order: 100 + furnitureList.length,
      cells: [{ name, key, row: 0, column: 0, capacity: 0 }]
    });
    return name;
  } catch (err: any) {
    // Two requests filing into the same new shelf at once: the unique index on
    // (collection, cells.key) lets one through and rejects the other. The loser reads
    // back what the winner created instead of failing, which is the whole point of
    // having the index rather than trusting the check above.
    if (err?.code !== 11000) throw err;

    const winner = await Furniture.findOne({ collection: collectionId, 'cells.key': key }).select('cells').lean();
    const cell = ((winner as any)?.cells || []).find((c: any) => c.key === key);
    return cell ? cell.name : name;
  }
}

/**
 * A resolver that remembers, for a caller filing many items in a row (an import, a bulk
 * move). Each distinct shelf costs one lookup; the rest are free.
 */
export function createShelfLocationResolver(collectionId: any): (raw: unknown) => Promise<string> {
  const seen = new Map<string, string>();

  return async (raw: unknown) => {
    const key = locationKey(raw);
    if (!key) return '';

    const known = seen.get(key);
    if (known !== undefined) return known;

    const resolved = await resolveShelfLocation(collectionId, raw);
    seen.set(key, resolved);
    return resolved;
  };
}
