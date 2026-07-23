import express from 'express';
import { registry } from '../registry';
import Item from '../../models/Item';
import { requireAuth } from '../../middleware/authMiddleware';
import { applyVisibilityFilter, applyEnabledModulesFilter } from '../../utils/visibilityHelper';

const router = express.Router();

router.get('/', requireAuth, async (req: any, res: any) => {
  try {
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      // The user is a member of no collection: explicit empty state, not a hollow dashboard
      return res.render('no-collection', { user: res.locals.user });
    }
    const settings = res.locals.settings;

    let queryAll: any = { collection: activeCollectionId, in_wishlist: false };
    applyVisibilityFilter(queryAll, res.locals.isCollectionAdmin, settings);
    applyEnabledModulesFilter(queryAll, settings);
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
    const latestItems = await Item.find(latestQuery).sort({ added_at: -1 }).limit(4).lean() as any[];

    const latestCollection = latestItems.map(item => {
      const plugin = registry.getByKind(item.kind as any);
      return plugin ? plugin.formatForView(item) : item;
    });

    // Wishlist items
    let wishlistQuery: any = { collection: activeCollectionId, in_wishlist: true };
    applyVisibilityFilter(wishlistQuery, res.locals.isCollectionAdmin, settings);
    applyEnabledModulesFilter(wishlistQuery, settings);
    const wishlistItems = await Item.find(wishlistQuery).sort({ added_at: -1 }).limit(4).lean() as any[];

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
