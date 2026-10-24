import express from 'express';
import { registry } from '../registry';
import { requireAuth } from '../../middleware/authMiddleware';
import { shelfFilter } from '../../utils/visibilityHelper';
import { db } from '../db';
import { and, contains, desc, eq, idOf, isIn, or } from '../db/query';

const router = express.Router();

const PAGE_SIZE = 25;
const MIN_QUERY_LENGTH = 2;
// The query becomes a text match run against every item of every collection the user belongs
// to, so its cost is bounded here rather than by what fits in the address bar.
const MAX_QUERY_LENGTH = 100;

router.get('/search', requireAuth, async (req: any, res: any) => {
  try {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, MAX_QUERY_LENGTH) : '';
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

    // Names and roles only: a whole Collection document also carries its share link
    // tokens, which have no business being read for a search page.
    const memberships = await db.collections.find(eq('members.user', idOf(req.user._id)), { fields: ['name', 'members'] });
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

    const settingsDocs = await db.settings.find(isIn('collection', collectionIds.map(idOf)));
    const settingsById = new Map<string, any>();
    settingsDocs.forEach((s: any) => settingsById.set(String(s.collection), s));


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

      // Same shelf every other listing shows: what is owned, holders only. A wishlist
      // entry is not in the collection yet, and a season belongs to its show.
      return and(
        shelfFilter({ collectionId: id, inWishlist: false, isAdmin: roleById.get(idStr) === 'admin', settings }),
        or(contains('title', rawQuery), ...Array.from(creatorFields).map(f => contains(f, rawQuery)))
      );
    });

    const query = or(...subFilters);

    const totalItems = await db.items.count(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);

    const found = await db.items.find(query, {
      sort: [desc('added_at')],
      skip: (currentPage - 1) * PAGE_SIZE,
      limit: PAGE_SIZE
    });

    const results = found.map((item: any) => {
      const plugin = registry.getByKind(item.kind);
      const formatted = plugin ? plugin.formatForView(item) : item;
      const collectionIdStr = String(item.collection);
      return {
        item: formatted,
        plugin,
        collectionId: collectionIdStr,
        collectionName: nameById.get(collectionIdStr) || '',
        // A card badge is a property of the collection the item lives in, not of the one
        // the user happens to have open (music reads its advanced CD option from there).
        collectionSettings: settingsById.get(collectionIdStr) || null
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
