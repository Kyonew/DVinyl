import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import { registry } from '../../../core/registry';
import { escapeRegExp, isBarcodeQuery, lookupBarcodeTitle, searchWithTitleFallback } from '../../../core/helpers';
import { toApiItem } from '../../../core/apiSerializers';
import { buildFieldSuggestions } from '../../../core/fieldSuggestions';
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

router.post('/collections/:id/items/search', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const { pluginId, query, type, year, country, genre_filter, label_filter } = req.body;
  const plugin = registry.get(pluginId);
  if (!plugin || !plugin.searchProvider) {
    return res.status(404).json({ success: false, error: 'Unknown or non-searchable plugin' });
  }

  const rawQuery = typeof query === 'string' ? query.trim() : '';
  const postedBarcode = String(req.body.scanned_barcode || '');
  let scannedBarcode = isBarcodeQuery(postedBarcode) ? postedBarcode.replace(/[- ]/g, '') : '';
  let searchQuery = rawQuery;
  let resolvedTitle = '';

  try {
    if (plugin.supportsBarcodeSearch && isBarcodeQuery(rawQuery)) {
      const { barcode, title } = await lookupBarcodeTitle(rawQuery, plugin.barcodeNoiseTerms);
      scannedBarcode = barcode;
      if (!title) {
        return res.status(200).json({ results: [], query: rawQuery, scannedBarcode: barcode, error: 'barcode_not_found' });
      }
      searchQuery = title;
      resolvedTitle = title;
    }

    const settings = await getCollectionSettings(req.apiCollection._id);
    const runSearch = (q: string) => plugin.searchProvider!.search(q, {
      type: type || plugin.id,
      year, country, genre_filter, label_filter,
      language: req.language,
      pluginSettings: settings?.pluginSettings?.[plugin.id] || {}
    });

    let results;
    if (resolvedTitle) {
      const attempt = await searchWithTitleFallback(resolvedTitle, runSearch);
      results = attempt.results;
      searchQuery = attempt.query;
    } else {
      results = await runSearch(searchQuery);
    }

    res.status(200).json({ results, query: searchQuery, scannedBarcode: scannedBarcode || undefined });
  } catch (err: any) {
    console.error(`API search error for ${plugin.id}:`, err.message);
    res.status(502).json({ success: false, error: `Search provider error: ${err.message}` });
  }
});

router.get('/collections/:id/items/confirm', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const { pluginId, externalId } = req.query;
  const plugin = registry.get(String(pluginId || ''));
  if (!plugin || !plugin.searchProvider) {
    return res.status(404).json({ success: false, error: 'Unknown or non-searchable plugin' });
  }
  if (!externalId) {
    return res.status(400).json({ success: false, error: 'externalId is required' });
  }

  try {
    const details = await plugin.searchProvider.getDetails(String(externalId), {
      ...req.query,
      language: req.language
    });

    if (details.creator !== undefined && details[plugin.creatorField] === undefined) {
      details[plugin.creatorField] = details.creator;
    }
    if (req.query.barcode) {
      details.barcode = String(req.query.barcode);
    }

    const collectionId = req.apiCollection._id;
    const suggestions = await buildFieldSuggestions(plugin, collectionId, details);

    let duplicates: any[];
    if (plugin.findPotentialDuplicates) {
      duplicates = await plugin.findPotentialDuplicates(collectionId, details);
    } else {
      const exact = await plugin.findDuplicate(collectionId, details);
      duplicates = exact ? [exact] : [];
    }

    res.status(200).json({ item: details, suggestions, duplicates });
  } catch (err: any) {
    console.error(`API details fetch error for ${plugin.id} ID ${externalId}:`, err.message);
    res.status(502).json({ success: false, error: `Search provider error: ${err.message}` });
  }
});

router.get('/collections/:id/stats', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  const settings: any = await getCollectionSettings(req.apiCollection._id);
  const isAdmin = req.apiCollectionRole === 'admin';

  const query: any = { collection: req.apiCollection._id, in_wishlist: false };
  applyVisibilityFilter(query, isAdmin, settings);
  applyEnabledModulesFilter(query, settings);
  applyContainedFilter(query);

  const allItems = await Item.find(query).lean();
  const stats: any = { total: allItems.reduce((acc: number, i: any) => acc + (i.quantity || 1), 0) };

  for (const plugin of registry.getEnabled(settings)) {
    const pluginItems = allItems.filter((i: any) => i.kind === plugin.kind);
    Object.assign(stats, plugin.getStats(pluginItems));
  }

  res.status(200).json({ stats });
});

export = router;
