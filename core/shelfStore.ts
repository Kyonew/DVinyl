import mongoose from 'mongoose';
import Furniture from '../models/Furniture';
import Item from '../models/Item';
import {
  locationKey, normalizeLocationName, pickDisplayName, capacityPerFurniture, fitGrid,
  cleanShelfName, clampInt, findDuplicateCellKey,
  MAX_FURNITURE_COLUMNS, MAX_FURNITURE_ROWS, MAX_CELL_CAPACITY
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
 * How many items carry each `location`, for an Item match the caller built. A `find`
 * rather than an aggregate on purpose: an aggregate does not cast, so the visibility
 * filter's hidden-item ids would compare as strings against ObjectIds and every hidden
 * item would be counted. The caller narrows the match to the compartment names, so the
 * returned map is bounded by the furniture; the documents read are that collection's
 * shelved items, which can be most of the collection. Bounding the read itself wants an
 * index on (collection, location), which is a follow-up rather than this surface's job.
 */
export async function shelfCounts(match: Record<string, any>): Promise<Map<string, number>> {
  const items = await Item.find(match).select('location').lean();
  const counts = new Map<string, number>();
  for (const item of items as any[]) {
    const location = item.location;
    if (typeof location === 'string' && location) {
      counts.set(location, (counts.get(location) || 0) + 1);
    }
  }
  return counts;
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
 *
 * Safe on a collection that already has furniture: a place one of its shelves already
 * holds is not built a second time (the unique index on the shelf key would refuse the
 * whole piece), its items are only moved onto that shelf's spelling.
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

  // Shelf key -> the spelling the furniture holds, for the shelves that already exist.
  const existing = new Map<string, string>();
  const furnitureList = await Furniture.find({ collection: collectionId }).select('cells.name cells.key').lean();
  for (const piece of furnitureList as any[]) {
    for (const cell of piece.cells || []) existing.set(cell.key, cell.name);
  }

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
    const shelved = existing.get(key);
    const name = shelved ?? pickDisplayName(variants);
    if (shelved === undefined) shelves.push({ name, key });
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

/** What a whole-piece save answers: the saved piece, or why it was refused. */
export type FurnitureSaveVerdict =
  | { ok: true; furniture: any; renamed: number; moved: number }
  | { ok: false; error: 'name_required' | 'duplicate_shelf' | 'shelf_elsewhere'; shelf?: string; furniture?: string };

/**
 * Saves a piece whole: its shape, and the shelves in it. Cells arrive in reading order and
 * carry no coordinates; the grid is derived from the order and the column count. `from` on a
 * cell is the key it had before, which tells a rename from a remove-and-create: a renamed
 * shelf takes its items with it. Shared by the web editor and the API.
 */
export async function saveFurniture(collectionId: any, furniture: any, input: any): Promise<FurnitureSaveVerdict> {
  const name = cleanShelfName(input?.name);
  if (!name) return { ok: false, error: 'name_required' };

  const columns = clampInt(input?.columns, 1, MAX_FURNITURE_COLUMNS, furniture.columns);
  const incoming = Array.isArray(input?.cells) ? input.cells : [];

  const cells: any[] = [];
  for (const raw of incoming) {
    const cellName = cleanShelfName(raw?.name);
    const key = locationKey(cellName);
    // A shelf with no name is not a shelf. Dropped rather than refused, so an empty row
    // left in the form does not cost the user the whole save.
    if (!key) continue;
    cells.push({
      name: cellName,
      key,
      row: Math.floor(cells.length / columns),
      column: cells.length % columns,
      capacity: clampInt(raw?.capacity, 0, MAX_CELL_CAPACITY, 0),
      from: typeof raw?.from === 'string' ? raw.from : null
    });
  }

  const duplicate = findDuplicateCellKey(cells);
  if (duplicate) return { ok: false, error: 'duplicate_shelf', shelf: duplicate };

  const elsewhere: any = await Furniture.findOne({
    collection: collectionId,
    _id: { $ne: furniture._id },
    'cells.key': { $in: cells.map(c => c.key) }
  }).select('name cells.key').lean();
  if (elsewhere) {
    const clash = cells.find(c => (elsewhere.cells || []).some((x: any) => x.key === c.key));
    return { ok: false, error: 'shelf_elsewhere', shelf: clash?.name, furniture: elsewhere.name };
  }

  const storedByKey = new Map((furniture.cells as any[]).map((cell: any) => [cell.key, cell]));
  const renames = cells
    .map(cell => ({ before: cell.from ? storedByKey.get(cell.from) : null, after: cell.name }))
    .filter(entry => entry.before && entry.before.name !== entry.after) as { before: any; after: string }[];

  furniture.name = name;
  furniture.layout = input?.layout === 'rows' ? 'rows' : 'cubes';
  furniture.columns = columns;
  // Tall enough to hold what it was given, whatever the form asked for: a compartment
  // must never end up below its own furniture's floor.
  furniture.rows = Math.min(
    MAX_FURNITURE_ROWS,
    Math.max(clampInt(input?.rows, 1, MAX_FURNITURE_ROWS, furniture.rows), Math.ceil(cells.length / columns) || 1)
  );
  furniture.cells = cells.map(({ from, ...cell }) => cell) as any;

  try {
    await furniture.save();
  } catch (err: any) {
    // The unique index on (collection, cells.key) refusing a shelf another request just took.
    if (err?.code === 11000) return { ok: false, error: 'duplicate_shelf' };
    throw err;
  }

  // One pass, so a pair of shelves swapping names cannot see each other's work: run in
  // sequence, "A becomes B" then "B becomes A" would land everything on A.
  let moved = 0;
  if (renames.length > 0) {
    const result = await Item.updateMany(
      { collection: collectionId, location: { $in: renames.map(r => r.before.name) } },
      [{
        $set: {
          location: {
            $switch: {
              branches: renames.map(r => ({ case: { $eq: ['$location', r.before.name] }, then: r.after })),
              default: '$location'
            }
          }
        }
      }]
    );
    moved = result.modifiedCount;
  }

  return { ok: true, furniture, renamed: renames.length, moved };
}

/** Builds a new, empty piece. `order` defaults after the collection's existing pieces. */
export async function createFurniture(
  collectionId: any,
  input: { name?: unknown; layout?: unknown; columns?: unknown; rows?: unknown; order?: unknown },
  userId: any
): Promise<{ ok: true; furniture: any } | { ok: false; error: 'name_required' }> {
  const name = cleanShelfName(input?.name);
  if (!name) return { ok: false, error: 'name_required' };

  const count = await Furniture.countDocuments({ collection: collectionId });
  const fit = fitGrid(4);
  const order = Number.isFinite(Number(input?.order))
    ? Math.max(0, Math.floor(Number(input?.order)))
    : 100 + count;

  const created = await Furniture.create({
    collection: collectionId,
    name,
    layout: input?.layout === 'rows' ? 'rows' : 'cubes',
    columns: clampInt(input?.columns, 1, MAX_FURNITURE_COLUMNS, fit.columns),
    rows: clampInt(input?.rows, 1, MAX_FURNITURE_ROWS, fit.rows),
    order,
    cells: [],
    createdBy: userId
  });
  return { ok: true, furniture: created };
}

/**
 * Carries one shelf, with everything on it, to another piece. Its own operation rather than
 * two saves: the shelf must never exist in both pieces at once, nor in neither. The items
 * are not touched, since the shelf keeps its name and they refer to it by that.
 */
export async function moveCell(
  collectionId: any,
  key: unknown,
  targetId: any
): Promise<{ ok: true; moved: boolean } | { ok: false; error: 'bad_request' | 'not_found' }> {
  const cellKey = locationKey(key);
  if (!cellKey || !mongoose.Types.ObjectId.isValid(targetId)) return { ok: false, error: 'bad_request' };

  const [source, target] = await Promise.all([
    Furniture.findOne({ collection: collectionId, 'cells.key': cellKey }),
    Furniture.findOne({ _id: targetId, collection: collectionId })
  ]);
  if (!source || !target) return { ok: false, error: 'not_found' };
  if (String(source._id) === String(target._id)) return { ok: true, moved: false };

  const cell = (source.cells as any[]).find((c: any) => c.key === cellKey);
  source.cells = (source.cells as any[]).filter((c: any) => c.key !== cellKey) as any;
  // Repacked, so removing a shelf from the middle does not leave a gap behind it.
  (source.cells as any[]).forEach((c: any, index: number) => {
    c.row = Math.floor(index / source.columns);
    c.column = index % source.columns;
  });

  const at = (target.cells as any[]).length;
  (target.cells as any[]).push({
    name: cell.name,
    key: cell.key,
    capacity: cell.capacity,
    row: Math.floor(at / target.columns),
    column: at % target.columns
  });
  if (Math.floor(at / target.columns) + 1 > target.rows) {
    target.rows = Math.min(MAX_FURNITURE_ROWS, Math.floor(at / target.columns) + 1);
  }

  // The source first: while both hold the shelf, the unique index would refuse the second
  // write and leave the move half done.
  await source.save();
  await target.save();
  return { ok: true, moved: true };
}
