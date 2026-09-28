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
      if (verdict.error === 'duplicate_shelf') {
        return res.status(409).json({
          success: false,
          error: `A shelf named "${verdict.shelf}" already exists in this piece of furniture`,
          shelf: verdict.shelf
        });
      }
      return res.status(409).json({
        success: false,
        error: `A shelf named "${verdict.shelf}" already exists in "${verdict.furniture}"`,
        furniture: verdict.furniture
      });
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
    const deleted = await Furniture.deleteOne({ _id: req.params.furnitureId, collection: req.apiCollection._id });
    if (deleted.deletedCount === 0) return res.status(404).json({ success: false, error: 'Furniture not found' });
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('API furniture delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete furniture' });
  }
});

export = router;
