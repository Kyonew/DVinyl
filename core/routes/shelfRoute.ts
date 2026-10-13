import express from 'express';
import mongoose from 'mongoose';
import Item from '../../models/Item';
import Furniture from '../../models/Furniture';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { resolveShelfLocation } from '../shelfStore';
import {
  locationKey, normalizeLocationName, findDuplicateCellKey, fitGrid,
  MAX_FURNITURE_COLUMNS, MAX_FURNITURE_ROWS
} from '../../utils/shelfHelpers';

const router = express.Router();

// One move can only ever be as large as the page that selected the items, and the
// collection page caps itself at 200 per page.
const MAX_MOVE = 500;

// Long enough for "Bibliotheque du salon", short enough to stay readable on a cell.
const MAX_NAME = 60;

const cleanName = (value: unknown) => normalizeLocationName(value).slice(0, MAX_NAME);
const clamp = (value: any, min: number, max: number, fallback: number) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** The piece of furniture named by :id, if it belongs to the caller's own collection. */
async function ownFurniture(req: any, res: any) {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Furniture.findOne({ _id: id, collection: res.locals.activeCollectionId });
}

/**
 * Puts items away, or takes them off their shelf.
 *
 * The one endpoint behind every "file this somewhere" gesture: the bulk action on the
 * collection page today, and a spine dragged onto a compartment later. Both hand it the
 * same thing, a list of items and the name of a place.
 */
router.post('/shelf/move', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      return res.status(400).json({ success: false, error: 'no_active_collection' });
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const valid = ids
      .filter((id: any) => mongoose.Types.ObjectId.isValid(id))
      .slice(0, MAX_MOVE);

    if (valid.length === 0) {
      return res.status(400).json({ success: false, error: 'no_items' });
    }

    // An empty name is a legitimate destination: it is how something is taken back off
    // its shelf and into the reserve.
    const location = await resolveShelfLocation(activeCollectionId, req.body?.location);

    // Scoped to the active collection, like every other item mutation: an id belonging
    // to a collection the caller is merely a member of elsewhere moves nothing.
    const result = await Item.updateMany(
      { _id: { $in: valid }, collection: activeCollectionId },
      { $set: { location } }
    );

    res.json({ success: true, moved: result.modifiedCount, matched: result.matchedCount, location });
  } catch (err: any) {
    console.error('Shelf move error:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

/**
 * Builds a new, empty piece of furniture for the collection.
 */
router.post('/shelf/furniture', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) return res.status(400).json({ success: false, error: 'no_active_collection' });

    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ success: false, error: 'name_required' });

    const count = await Furniture.countDocuments({ collection: activeCollectionId });
    const { columns, rows } = fitGrid(4);

    const created = await Furniture.create({
      collection: activeCollectionId,
      name,
      layout: req.body?.layout === 'rows' ? 'rows' : 'cubes',
      columns,
      rows,
      order: 100 + count,
      cells: [],
      createdBy: req.user._id
    });

    res.json({ success: true, id: String(created._id) });
  } catch (err: any) {
    console.error('Furniture create error:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

/**
 * Saves a piece of furniture whole: its shape, and the shelves in it.
 *
 * Cells arrive in reading order and carry no coordinates; the grid is derived from the
 * order and the column count, so a compartment cannot be placed outside its own
 * furniture and changing the width simply reflows it.
 *
 * `from` on a cell is the key it had before, which is what tells a rename apart from a
 * shelf being removed and another created. A renamed shelf takes its items with it.
 */
router.post('/shelf/furniture/:id', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const furniture = await ownFurniture(req, res);
    if (!furniture) return res.status(404).json({ success: false, error: 'not_found' });

    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ success: false, error: 'name_required' });

    const columns = clamp(req.body?.columns, 1, MAX_FURNITURE_COLUMNS, furniture.columns);
    const incoming = Array.isArray(req.body?.cells) ? req.body.cells : [];

    const cells: any[] = [];
    for (const raw of incoming) {
      const cellName = cleanName(raw?.name);
      const key = locationKey(cellName);
      // A shelf with no name is not a shelf. Dropped rather than refused, so an empty
      // row left in the form does not cost the user the whole save.
      if (!key) continue;

      cells.push({
        name: cellName,
        key,
        row: Math.floor(cells.length / columns),
        column: cells.length % columns,
        capacity: clamp(raw?.capacity, 0, 100000, 0),
        from: typeof raw?.from === 'string' ? raw.from : null
      });
    }

    const duplicate = findDuplicateCellKey(cells);
    if (duplicate) return res.status(409).json({ success: false, error: 'duplicate_shelf', shelf: duplicate });

    // The unique index would catch this too, but only as a write failure with nothing to
    // tell the user. Named here, before anything is touched.
    const elsewhere = await Furniture.findOne({
      collection: res.locals.activeCollectionId,
      _id: { $ne: furniture._id },
      'cells.key': { $in: cells.map(c => c.key) }
    }).select('name cells.key').lean();
    if (elsewhere) {
      return res.status(409).json({ success: false, error: 'shelf_elsewhere', furniture: (elsewhere as any).name });
    }

    // Read off the stored cells before they are replaced: a shelf that changed name has
    // to take the items standing on it along, and they only know the old name.
    const storedByKey = new Map((furniture.cells as any[]).map((cell: any) => [cell.key, cell]));
    const renames = cells
      .map(cell => ({ before: cell.from ? storedByKey.get(cell.from) : null, after: cell.name }))
      .filter(entry => entry.before && entry.before.name !== entry.after) as { before: any; after: string }[];

    furniture.name = name;
    furniture.layout = req.body?.layout === 'rows' ? 'rows' : 'cubes';
    furniture.columns = columns;
    // Tall enough to hold what it was given, whatever the form asked for: a compartment
    // must never end up below its own furniture's floor.
    furniture.rows = Math.min(
      MAX_FURNITURE_ROWS,
      Math.max(clamp(req.body?.rows, 1, MAX_FURNITURE_ROWS, furniture.rows), Math.ceil(cells.length / columns) || 1)
    );
    furniture.cells = cells.map(({ from, ...cell }) => cell) as any;
    await furniture.save();

    // One pass, so a pair of shelves swapping names cannot see each other's work: run in
    // sequence, "A becomes B" then "B becomes A" would land everything on A.
    let moved = 0;
    if (renames.length > 0) {
      const result = await Item.updateMany(
        { collection: res.locals.activeCollectionId, location: { $in: renames.map(r => r.before.name) } },
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

    res.json({ success: true, renamed: renames.length, moved });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ success: false, error: 'duplicate_shelf' });
    }
    console.error('Furniture save error:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

/**
 * Takes a piece of furniture away. The items that stood in it are left alone: nothing
 * points at them any more, so they show up in the reserve, still saying where they used
 * to be. Building the same shelf again puts them straight back on it.
 */
router.post('/shelf/furniture/:id/delete', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const furniture = await ownFurniture(req, res);
    if (!furniture) return res.status(404).json({ success: false, error: 'not_found' });

    await Furniture.deleteOne({ _id: furniture._id });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Furniture delete error:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

/**
 * Carries one shelf, with everything on it, to another piece of furniture.
 *
 * Its own endpoint rather than two saves: the shelf must never exist in both pieces at
 * once, nor in neither. The items are not touched at all, since the shelf keeps its
 * name and they only ever refer to it by that.
 */
router.post('/shelf/cell/move', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    const key = locationKey(req.body?.key);
    const targetId = req.body?.to;

    if (!key || !mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ success: false, error: 'bad_request' });
    }

    const [source, target] = await Promise.all([
      Furniture.findOne({ collection: activeCollectionId, 'cells.key': key }),
      Furniture.findOne({ _id: targetId, collection: activeCollectionId })
    ]);
    if (!source || !target) return res.status(404).json({ success: false, error: 'not_found' });
    if (String(source._id) === String(target._id)) return res.json({ success: true, moved: false });

    const cell = (source.cells as any[]).find((c: any) => c.key === key);
    source.cells = (source.cells as any[]).filter((c: any) => c.key !== key) as any;
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

    // The source first: while both hold the shelf, the unique index would refuse the
    // second write and leave the move half done.
    await source.save();
    await target.save();

    res.json({ success: true, moved: true });
  } catch (err: any) {
    console.error('Shelf move between furniture error:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

export default router;
