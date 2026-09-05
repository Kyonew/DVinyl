import Furniture from '../models/Furniture';
import Item from '../models/Item';
import {
  locationKey, normalizeLocationName, pickDisplayName, capacityPerFurniture, fitGrid,
  MAX_FURNITURE_ROWS
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

/**
 * Turns a collection's free-text `location` values into furniture, and returns what it
 * had to do. Every spelling of one place ends up as a single compartment, and the items
 * that used another spelling are rewritten onto the one the collection uses most.
 *
 * Used by the boot migration for collections that predate the furniture, and again by a
 * per-collection restore, whose dump may carry locations but no furniture at all.
 */
export async function seedFurnitureFromLocations(
  collectionId: any,
  furnitureName: string
): Promise<{ shelves: number; renamed: number; blanked: number }> {
  // Counted per spelling, since the most used one is the one kept.
  const storedLocations = await Item.collection.aggregate([
    { $match: { collection: collectionId, location: { $nin: ['', null] } } },
    { $group: { _id: '$location', count: { $sum: 1 } } }
  ]).toArray();

  const groups = new Map<string, { name: string; count: number }[]>();
  let blanked = 0;
  for (const entry of storedLocations) {
    const raw = String(entry._id ?? '');
    const key = locationKey(raw);
    // A value made of nothing but spaces is not a place; it is an empty field that looks
    // filled, and it would seed a nameless shelf.
    if (!key) {
      const cleared = await Item.updateMany(
        { collection: collectionId, location: raw },
        { $set: { location: '' } }
      );
      blanked += cleared.modifiedCount;
      continue;
    }
    groups.set(key, [...(groups.get(key) || []), { name: raw, count: entry.count }]);
  }

  const shelves: { name: string; key: string }[] = [];
  let renamed = 0;
  for (const [key, variants] of groups) {
    const name = pickDisplayName(variants);
    shelves.push({ name, key });
    for (const variant of variants) {
      if (variant.name === name) continue;
      const merged = await Item.updateMany(
        { collection: collectionId, location: variant.name },
        { $set: { location: name } }
      );
      renamed += merged.modifiedCount;
    }
  }
  shelves.sort((a, b) => a.name.localeCompare(b.name));

  // More shelves than one piece of furniture can hold means several, which is what the
  // view pages over anyway.
  const perFurniture = capacityPerFurniture();
  for (let start = 0, page = 0; start < shelves.length; start += perFurniture, page += 1) {
    const chunk = shelves.slice(start, start + perFurniture);
    const { columns, rows } = fitGrid(chunk.length);
    await Furniture.create({
      collection: collectionId,
      name: page === 0 ? furnitureName : `${furnitureName} (${page + 1})`,
      layout: 'cubes',
      columns,
      rows,
      order: 100 + page,
      cells: chunk.map((shelf, index) => ({
        name: shelf.name,
        key: shelf.key,
        row: Math.floor(index / columns),
        column: index % columns
      }))
    });
  }

  return { shelves: shelves.length, renamed, blanked };
}
