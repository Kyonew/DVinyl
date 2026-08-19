import express from 'express';
import { registry } from '../registry';
import Item from '../../models/Item';
import Collection from '../../models/Collection';
import Settings from '../../models/Settings';
import { requireAuth } from '../../middleware/authMiddleware';
import { escapeRegExp } from '../helpers';
import { applyVisibilityFilter, applyEnabledModulesFilter } from '../../utils/visibilityHelper';

const router = express.Router();

const PAGE_SIZE = 25;
const MIN_QUERY_LENGTH = 2;

router.get('/search', requireAuth, async (req: any, res: any) => {
  try {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);

    const emptyResult = {
      query: rawQuery,
      results: [] as any[],
      totalItems: 0,
      totalPages: 0,
      currentPage: 1,
      user: res.locals.user
    };

    if (rawQuery.length < MIN_QUERY_LENGTH) {
      return res.render('search', emptyResult);
    }

    const memberships = await Collection.find({ 'members.user': req.user._id });
    if (memberships.length === 0) {
      return res.render('search', emptyResult);
    }

    const collectionIds = memberships.map((c: any) => c._id);
    const roleById = new Map<string, string>();
    const nameById = new Map<string, string>();
    memberships.forEach((c: any) => {
      const membership = (c.members || []).find((m: any) => String(m.user) === String(req.user._id));
      roleById.set(String(c._id), req.user.isAdmin ? 'admin' : (membership ? membership.role : 'viewer'));
      nameById.set(String(c._id), c.name);
    });

    const settingsDocs = await Settings.find({ collection: { $in: collectionIds } }).lean();
    const settingsById = new Map<string, any>();
    settingsDocs.forEach((s: any) => settingsById.set(String(s.collection), s));

    const regex = new RegExp(escapeRegExp(rawQuery), 'i');

    // Only title + creator field, unlike /collection's search box: comments/tracklist,
    // barcode and extraSearchFields are a separate roadmap item (full-text search), kept
    // out here to keep this query cheap across every collection at once.
    const subFilters = collectionIds.map((id: any) => {
      const idStr = String(id);
      // A collection nobody has opened yet has no Settings doc (settingsMiddleware
      // upserts one lazily, only for the active collection). Falls back to the same
      // "enabledByDefault plugins only, no visibility restrictions" default that
      // middleware/settingsMiddleware.ts uses for that exact case.
      const settings = settingsById.get(idStr) || { modules: registry.getDefaultModules() };
      const enabledPlugins = registry.getEnabled(settings);
      const creatorFields = new Set<string>();
      enabledPlugins.forEach(p => creatorFields.add(p.creatorField));

      const subFilter: any = {
        collection: id,
        $or: [
          { title: regex },
          ...Array.from(creatorFields).map(f => ({ [f]: regex }))
        ]
      };

      const isAdminHere = roleById.get(idStr) === 'admin';
      applyVisibilityFilter(subFilter, isAdminHere, settings);
      applyEnabledModulesFilter(subFilter, settings);

      return subFilter;
    });

    const query = { $or: subFilters };

    const totalItems = await Item.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);

    const items = await Item.find(query)
      .sort({ added_at: -1 })
      .skip((currentPage - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();

    const results = items.map((item: any) => {
      const plugin = registry.getByKind(item.kind);
      const formatted = plugin ? plugin.formatForView(item) : item;
      const collectionIdStr = String(item.collection);
      return {
        item: formatted,
        plugin,
        collectionId: collectionIdStr,
        collectionName: nameById.get(collectionIdStr) || ''
      };
    });

    res.render('search', {
      query: rawQuery,
      results,
      totalItems,
      totalPages,
      currentPage,
      user: res.locals.user
    });
  } catch (err: any) {
    console.error('Search error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
