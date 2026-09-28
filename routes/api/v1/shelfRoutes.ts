import { Router } from 'express';
import Furniture from '../../../models/Furniture';
import { furnitureToApi } from '../../../core/apiSerializers';
import { shelfChoices, shelfCounts } from '../../../core/shelfStore';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter } from '../../../utils/visibilityHelper';

const router = Router();

router.use(requireApiAuth);

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

export = router;
