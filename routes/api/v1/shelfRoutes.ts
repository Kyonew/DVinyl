import { Router } from 'express';
import mongoose from 'mongoose';
import Furniture from '../../../models/Furniture';
import Item from '../../../models/Item';
import { furnitureToApi } from '../../../core/apiSerializers';
import { createFurniture, moveCell, resolveShelfLocation, saveFurniture, shelfChoices, shelfCounts } from '../../../core/shelfStore';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter } from '../../../utils/visibilityHelper';
import { MAX_SHELF_MOVE } from '../../../utils/shelfHelpers';

const router = Router();

router.use(requireApiAuth);

/** The per-cell counts for a set of pieces, under this caller's visibility filters. */
async function countsFor(collectionId: any, pieces: any[], role: string, settings: any): Promise<Map<string, number>> {
  const names = pieces.flatMap((piece: any) => (piece.cells || []).map((cell: any) => cell.name));
  if (names.length === 0) return new Map();
  const match: any = { collection: collectionId, in_wishlist: false, location: { $in: names } };
  applyVisibilityFilter(match, role === 'admin', settings);
  applyEnabledModulesFilter(match, settings);
  applyContainedFilter(match);
  return shelfCounts(match);
}

/** Loads the piece named by :furnitureId in this collection, or null. */
async function ownFurniture(collectionId: any, id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Furniture.findOne({ _id: id, collection: collectionId });
}

/** Refuses a layout the model does not know, rather than coercing it (the web coerces). */
function badLayout(layout: unknown): boolean {
  return layout !== undefined && layout !== 'cubes' && layout !== 'rows';
}

/** The location picker's vocabulary: compartment names plus any stray item location. */
router.get('/collections/:id/shelves', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    res.status(200).json({ shelves: await shelfChoices(req.apiCollection._id) });
  } catch (err: any) {
    console.error('API shelves list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list shelves' });
  }
});

router.get('/collections/:id/furniture', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    const collectionId = req.apiCollection._id;
    const settings: any = await getCollectionSettings(collectionId);
    const furniture = await Furniture.find({ collection: collectionId })
      .sort({ order: 1, created_at: 1 })
      .lean();

    // The counts answer "how much stands here?", so they carry the same visibility the
    // listing does: a viewer must not be told about an item hidden from them.
    const names = furniture.flatMap((piece: any) => (piece.cells || []).map((cell: any) => cell.name));
    let counts = new Map<string, number>();
    if (names.length > 0) {
      const match: any = { collection: collectionId, in_wishlist: false, location: { $in: names } };
      applyVisibilityFilter(match, req.apiCollectionRole === 'admin', settings);
      applyEnabledModulesFilter(match, settings);
      applyContainedFilter(match);
      counts = await shelfCounts(match);
    }

    res.status(200).json({ furniture: furniture.map((piece: any) => furnitureToApi(piece, counts)) });
  } catch (err: any) {
    console.error('API furniture list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list furniture' });
  }
});

router.post('/collections/:id/furniture', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  try {
    if (badLayout(req.body?.layout)) {
      return res.status(400).json({ success: false, error: 'A layout must be cubes or rows' });
    }
    const verdict = await createFurniture(req.apiCollection._id, req.body || {}, req.user._id);
    if (!verdict.ok) return res.status(400).json({ success: false, error: 'name is required' });
    res.status(201).json({ furniture: furnitureToApi(verdict.furniture, new Map()) });
  } catch (err: any) {
    console.error('API furniture create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create furniture' });
  }
});

router.put('/collections/:id/furniture/:furnitureId', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  try {
    if (badLayout(req.body?.layout)) {
      return res.status(400).json({ success: false, error: 'A layout must be cubes or rows' });
    }
    const collectionId = req.apiCollection._id;
    const piece = await ownFurniture(collectionId, req.params.furnitureId);
    if (!piece) return res.status(404).json({ success: false, error: 'Furniture not found' });

    const verdict = await saveFurniture(collectionId, piece, req.body || {});
    if (!verdict.ok) {
      if (verdict.error === 'name_required') {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      if (verdict.error === 'too_many_shelves') {
        return res.status(400).json({ success: false, error: 'That is more shelves than one piece of furniture can hold' });
      }
      // The race path (the unique index refusing a shelf another request just took) knows
      // the clash only as a write failure, so the message must not name a shelf it lacks.
      if (verdict.error === 'duplicate_shelf') {
        const body: any = {
          success: false,
          error: verdict.shelf
            ? `A shelf named "${verdict.shelf}" already exists in this piece of furniture`
            : 'A shelf with this name already exists in this piece of furniture'
        };
        if (verdict.shelf) body.shelf = verdict.shelf;
        return res.status(409).json(body);
      }
      const body: any = {
        success: false,
        error: verdict.shelf
          ? `A shelf named "${verdict.shelf}" already exists in "${verdict.furniture}"`
          : `A shelf with this name already exists in "${verdict.furniture}"`
      };
      body.furniture = verdict.furniture;
      return res.status(409).json(body);
    }

    const settings: any = await getCollectionSettings(collectionId);
    const counts = await countsFor(collectionId, [verdict.furniture], req.apiCollectionRole, settings);
    res.status(200).json({
      furniture: furnitureToApi(verdict.furniture, counts),
      renamed: verdict.renamed,
      moved: verdict.moved
    });
  } catch (err: any) {
    console.error('API furniture save error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save furniture' });
  }
});

router.delete('/collections/:id/furniture/:furnitureId', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.furnitureId)) {
      return res.status(404).json({ success: false, error: 'Furniture not found' });
    }
    const deleted = await Furniture.deleteOne({ _id: req.params.furnitureId, collection: req.apiCollection._id });
    if (deleted.deletedCount === 0) return res.status(404).json({ success: false, error: 'Furniture not found' });
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API furniture delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete furniture' });
  }
});

router.post('/collections/:id/shelf/cell/move', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const verdict = await moveCell(req.apiCollection._id, req.body?.key, req.body?.to);
    if (!verdict.ok) {
      if (verdict.error === 'target_full') {
        return res.status(409).json({ success: false, error: 'The target piece of furniture is full' });
      }
      return res.status(verdict.error === 'bad_request' ? 400 : 404).json({
        success: false,
        error: verdict.error === 'bad_request' ? 'key and to are required' : 'Furniture not found'
      });
    }
    res.status(200).json({ moved: verdict.moved });
  } catch (err: any) {
    console.error('API shelf move error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to move the shelf' });
  }
});

router.post('/collections/:id/shelf/move', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const collectionId = req.apiCollection._id;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id: any) => mongoose.Types.ObjectId.isValid(id)).slice(0, MAX_SHELF_MOVE)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids must be a non-empty array' });
    }

    // The store decides the spelling, and creates the compartment for a name the
    // collection has never seen. An empty name takes the items off their shelf.
    const location = await resolveShelfLocation(collectionId, req.body?.location);
    const result = await Item.updateMany(
      { _id: { $in: ids }, collection: collectionId },
      { $set: { location } }
    );
    res.status(200).json({ moved: result.modifiedCount, matched: result.matchedCount, location });
  } catch (err: any) {
    console.error('API shelf move items error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to move the items' });
  }
});

export = router;
