import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import { registry } from '../../../core/registry';
import { escapeRegExp } from '../../../core/helpers';
import { toApiItem } from '../../../core/apiSerializers';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { listUserCollectionsWithRole } from '../../../utils/collectionHelpers';
import { resolveShelfItems } from '../../../utils/itemHelpers';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter } from '../../../utils/visibilityHelper';

const router = Router();

router.use(requireApiAuth);

router.get('/collections', async (req: any, res: any) => {
  const collections = await listUserCollectionsWithRole(req.user);
  res.status(200).json({ collections });
});

/**
 * Settings are scoped per collection (models/Settings.ts). Fetched fresh here
 * rather than trusted from res.locals.settings, which middleware/settingsMiddleware.ts
 * only ever populates for the session's active collection - not necessarily the :id
 * this request is about. Mirrors settingsMiddleware's own upsert pattern exactly.
 */
async function getCollectionSettings(collectionId: any) {
  return Settings.findOneAndUpdate(
    { collection: collectionId },
    { $setOnInsert: { collection: collectionId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

router.get('/collections/:id/items', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';
  const enabledPlugins = registry.getEnabled(settings);

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 25));

  const query: any = { collection: req.apiCollection._id, in_wishlist: false };
  applyVisibilityFilter(query, isAdmin, settings);
  applyEnabledModulesFilter(query, settings);
  applyContainedFilter(query);

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  if (type && type !== 'all') {
    const plugin = enabledPlugins.find(p => p.id === type);
    if (plugin) {
      if (plugin.matchesLegacyItems) {
        query.$and = [...(query.$and || []), { $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }];
      } else {
        query.kind = plugin.kind;
      }
    }
  }

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search) {
    const regex = new RegExp(escapeRegExp(search), 'i');
    const searchOr: any[] = [{ title: regex }, { barcode: regex }];
    for (const plugin of enabledPlugins) {
      searchOr.push({ [plugin.creatorField]: regex });
    }
    if (mongoose.Types.ObjectId.isValid(search)) searchOr.push({ _id: search });
    query.$and = [...(query.$and || []), { $or: searchOr }];
  }

  const totalItems = await Item.countDocuments(query);
  const found = await Item.find(query)
    .sort({ added_at: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  // resolveShelfItems reads res.locals.isCollectionAdmin/res.locals.settings - set them
  // explicitly for THIS collection rather than trusting whatever the global
  // collectionMiddleware/settingsMiddleware chain set for the session's active one.
  res.locals.isCollectionAdmin = isAdmin;
  res.locals.settings = settings;
  const resolved = await resolveShelfItems(found, res);

  const items = resolved
    .map((item: any) => {
      const plugin = registry.getByKind(item.kind);
      return plugin ? toApiItem(item, plugin) : null;
    })
    .filter(Boolean);

  res.status(200).json({
    items,
    page,
    limit,
    totalItems,
    totalPages: Math.ceil(totalItems / limit) || 1
  });
});

export = router;
