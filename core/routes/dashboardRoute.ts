import express from 'express';
import { registry } from '../registry';
import Item from '../../models/Item';
import { requireAuth } from '../../middleware/authMiddleware';
import { applyVisibilityFilter, applyEnabledModulesFilter, applyContainedFilter } from '../../utils/visibilityHelper';
import { resolveShelfItems } from '../../utils/itemHelpers';
import { applyHomeCollection, homePathFor } from '../../utils/homePage';

const router = express.Router();

// The app's entry point (bookmark, PWA start_url, the logo, post-login): puts the user
// in their home collection and sends them to the page they chose to land on. The
// dashboard keeps its own path below so it stays reachable for someone whose home is
// the collection.
//
// Once per session, not on every visit, because '/' is also where the app sends people
// on its own: the collection switcher redirects here after switching, and re-applying
// the home collection on that hop would undo the switch on the way back. The express
// session cookie carries no maxAge, so it dies with the browser and a genuine relaunch
// gets a fresh one. Keyed by user id so signing in as somebody else in the same browser
// still lands on their own home.
router.get('/', requireAuth, async (req: any, res: any) => {
  const userId = String(req.user._id);
  if (req.session && req.session.homeAppliedFor !== userId) {
    req.session.homeAppliedFor = userId;
    await applyHomeCollection(req);
  }

  const target = homePathFor(req.user);
  // Callers reach '/' carrying a message to show ('/?msg=collection_created'), and the
  // page that displays one is the page being redirected to.
  const msg = typeof req.query.msg === 'string' ? req.query.msg : '';
  res.redirect(msg ? `${target}?msg=${encodeURIComponent(msg)}` : target);
});

router.get('/dashboard', requireAuth, async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      // The user is a member of no collection: explicit empty state, not a hollow dashboard
      return res.render('no-collection', { user: res.locals.user, msgKey: req.query.msg });
    }
    const settings = res.locals.settings;

    let queryAll: any = { collection: activeCollectionId, in_wishlist: false };
    applyVisibilityFilter(queryAll, res.locals.isCollectionAdmin, settings);
    applyEnabledModulesFilter(queryAll, settings);
    applyContainedFilter(queryAll);
    const allItems = await Item.find(queryAll).lean() as any[];

    // Calculate total collection items count
    const stats: any = {
      total: allItems.reduce((acc, i) => acc + (i.quantity || 1), 0),
    };

    // Aggregate stats from all enabled plugins
    const enabledPlugins = registry.getEnabled(settings);
    for (const plugin of enabledPlugins) {
      const pluginItems = allItems.filter(i => i.kind === plugin.kind);
      const pluginStats = plugin.getStats(pluginItems);
      Object.assign(stats, pluginStats);
    }

    // Latest collection items
    let latestQuery: any = { collection: activeCollectionId, in_wishlist: false };
    applyVisibilityFilter(latestQuery, res.locals.isCollectionAdmin, settings);
    applyEnabledModulesFilter(latestQuery, settings);
    applyContainedFilter(latestQuery);
    const latestItems = await resolveShelfItems(await Item.find(latestQuery).sort({ added_at: -1 }).limit(4).lean(), res) as any[];

    const latestCollection = latestItems.map(item => {
      const plugin = registry.getByKind(item.kind as any);
      return plugin ? plugin.formatForView(item) : item;
    });

    // Wishlist items
    let wishlistQuery: any = { collection: activeCollectionId, in_wishlist: true };
    applyVisibilityFilter(wishlistQuery, res.locals.isCollectionAdmin, settings);
    applyEnabledModulesFilter(wishlistQuery, settings);
    applyContainedFilter(wishlistQuery);
    const wishlistItems = await resolveShelfItems(await Item.find(wishlistQuery).sort({ added_at: -1 }).limit(4).lean(), res) as any[];

    const latestWishlist = wishlistItems.map(item => {
      const plugin = registry.getByKind(item.kind as any);
      return plugin ? plugin.formatForView(item) : item;
    });

    res.render('index', {
      latestCollection,
      latestWishlist,
      stats,
      user: res.locals.user,
      settings
    });
  } catch (err: any) {
    console.error("Dashboard route error:", err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
