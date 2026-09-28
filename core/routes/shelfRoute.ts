import express from 'express';
import mongoose from 'mongoose';
import Item from '../../models/Item';
import Furniture from '../../models/Furniture';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { createFurniture, moveCell, resolveShelfLocation, saveFurniture } from '../shelfStore';
import { MAX_SHELF_MOVE } from '../../utils/shelfHelpers';

const router = express.Router();

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
      .slice(0, MAX_SHELF_MOVE);

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

    const verdict = await createFurniture(activeCollectionId, req.body, req.user._id);
    if (!verdict.ok) return res.status(400).json({ success: false, error: 'name_required' });

    res.json({ success: true, id: String(verdict.furniture._id) });
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

    const verdict = await saveFurniture(res.locals.activeCollectionId, furniture, req.body);
    if (!verdict.ok) {
      if (verdict.error === 'name_required') return res.status(400).json({ success: false, error: 'name_required' });
      if (verdict.error === 'too_many_shelves') return res.status(400).json({ success: false, error: 'too_many_shelves' });
      if (verdict.error === 'duplicate_shelf') return res.status(409).json({ success: false, error: 'duplicate_shelf', shelf: verdict.shelf });
      return res.status(409).json({ success: false, error: 'shelf_elsewhere', furniture: verdict.furniture });
    }
    res.json({ success: true, renamed: verdict.renamed, moved: verdict.moved });
  } catch (err: any) {
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
    const verdict = await moveCell(res.locals.activeCollectionId, req.body?.key, req.body?.to);
    if (!verdict.ok) {
      if (verdict.error === 'target_full') return res.status(409).json({ success: false, error: 'target_full' });
      return res.status(verdict.error === 'bad_request' ? 400 : 404).json({ success: false, error: verdict.error });
    }
    res.json({ success: true, moved: verdict.moved });
  } catch (err: any) {
    console.error('Shelf move between furniture error:', err.message);
    res.status(500).json({ success: false, error: 'server_error' });
  }
});

export default router;
