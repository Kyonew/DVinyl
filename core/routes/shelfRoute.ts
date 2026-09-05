import express from 'express';
import mongoose from 'mongoose';
import Item from '../../models/Item';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { resolveShelfLocation } from '../shelfStore';

const router = express.Router();

// One move can only ever be as large as the page that selected the items, and the
// collection page caps itself at 200 per page.
const MAX_MOVE = 500;

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

export default router;
