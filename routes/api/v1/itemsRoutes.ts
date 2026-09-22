import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import { registry } from '../../../core/registry';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { resolveMemberRole, roleAtLeast } from '../../../utils/collectionHelpers';
import { applyVisibilityFilter } from '../../../utils/visibilityHelper';
import { toApiItem } from '../../../core/apiSerializers';

const router = Router();

router.get('/items/:itemId', requireApiAuth, async (req: any, res: any) => {
  const { itemId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const item: any = await Item.findById(itemId).lean();
  if (!item || !item.collection) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const { role } = await resolveMemberRole(req.user, item.collection);
  if (!roleAtLeast(role, 'viewer')) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  // Mirrors core/routes/itemRoutes.ts's own detail route: an item the collection hides
  // from its viewers (settings.visibility) is hidden from direct-by-id access too, not
  // just from the listing - the id is the only thing standing between the two, and a
  // client can guess it just as easily as a share link visitor.
  const settings: any = await Settings.findOne({ collection: item.collection }).lean();
  const visibilityQuery: any = { _id: item._id };
  applyVisibilityFilter(visibilityQuery, role === 'admin', settings);
  const stillVisible = await Item.findOne(visibilityQuery).select('_id').lean();
  if (!stillVisible) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const plugin = registry.getByKind(item.kind);
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  res.status(200).json({ item: toApiItem(item, plugin) });
});

export = router;
