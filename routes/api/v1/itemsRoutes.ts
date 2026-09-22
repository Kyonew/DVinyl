import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import { registry } from '../../../core/registry';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { resolveMemberRole, roleAtLeast } from '../../../utils/collectionHelpers';
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

  const plugin = registry.getByKind(item.kind);
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  res.status(200).json({ item: toApiItem(item, plugin) });
});

export = router;
