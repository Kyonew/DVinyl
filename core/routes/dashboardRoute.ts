import express from 'express';
import { registry } from '../registry';
import List from '../../models/List';
import { requireAuth } from '../../middleware/authMiddleware';
import { shelfFilter } from '../../utils/visibilityHelper';
import { db } from '../db';
import { desc } from '../db/filter';
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

    const shelf = (inWishlist: boolean) => shelfFilter({
      collectionId: activeCollectionId,
      inWishlist,
      isAdmin: res.locals.isCollectionAdmin,
      settings
    });
    const owned = shelf(false);
    const wished = shelf(true);
    const allItems = await db.items.find(owned);

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
    // Ten for the phone's sideways row; the desktop grid shows the first four.
    const latestItems = await resolveShelfItems(await db.items.find(owned, { sort: [desc('added_at')], limit: 10 }), res) as any[];

    const latestCollection = latestItems.map(item => {
      const plugin = registry.getByKind(item.kind as any);
      return plugin ? plugin.formatForView(item) : item;
    });

    // Wishlist items
    const wishlistItems = await resolveShelfItems(await db.items.find(wished, { sort: [desc('added_at')], limit: 4 }), res) as any[];

    const latestWishlist = wishlistItems.map(item => {
      const plugin = registry.getByKind(item.kind as any);
      return plugin ? plugin.formatForView(item) : item;
    });

    // The counters of the phone dashboard's tiles, next to the collection total above.
    const [wishlistCount, listsCount] = await Promise.all([
      db.items.count(wished),
      List.countDocuments({ collection: activeCollectionId })
    ]);

    res.render('index', {
      latestCollection,
      latestWishlist,
      wishlistCount,
      listsCount,
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
