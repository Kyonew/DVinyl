import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import { registry } from '../../../core/registry';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { resolveMemberRole, roleAtLeast } from '../../../utils/collectionHelpers';
import { applyVisibilityFilter } from '../../../utils/visibilityHelper';

const router = Router();

const MAX_CONDITION_LENGTH = 20;

router.get('/items/:itemId/estimate', requireApiAuth, async (req: any, res: any) => {
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

  // Mirrors GET /items/:itemId: an item the collection hides from viewers is not
  // priceable by id either (same id-non-disclosure rule).
  const settings: any = await Settings.findOne({ collection: item.collection }).lean();
  const visibilityQuery: any = { _id: item._id };
  applyVisibilityFilter(visibilityQuery, role === 'admin', settings);
  const visible = await Item.findOne(visibilityQuery).select('_id').lean();
  if (!visible) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const plugin = registry.getByKind(item.kind);
  if (!plugin || !plugin.estimatePrice || !plugin.externalIdField) {
    return res.status(404).json({ success: false, error: 'Price estimation is not supported for this item' });
  }

  const externalId = item[plugin.externalIdField];
  if (externalId === undefined || externalId === null || externalId === '') {
    return res.status(404).json({ success: false, error: 'Price estimation is not supported for this item' });
  }

  const condition = String(req.query.condition || '').trim().slice(0, MAX_CONDITION_LENGTH);

  try {
    const estimate = await plugin.estimatePrice(String(externalId), {
      condition,
      currency: req.user.currency || 'USD'
    });
    if (!estimate) {
      return res.status(200).json({ estimate: null, reason: 'unavailable' });
    }
    res.status(200).json({ estimate });
  } catch (err: any) {
    console.error(`API price estimate error for item ${itemId}:`, err.message);
    res.status(502).json({ success: false, error: `Price provider error: ${err.message}` });
  }
});

export = router;
