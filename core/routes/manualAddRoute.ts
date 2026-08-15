import express from 'express';
import { registry } from '../registry';
import Item from '../../models/Item';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { buildFieldSuggestions } from '../fieldSuggestions';

const router = express.Router();

// GET /manual-add -> Renders manual add selector and dynamic form
router.get('/manual-add', requireAuth, requireCollectionRole('editor'), async (req: any, res: any) => {
  try {
    const settings = res.locals.settings;
    const enabledPlugins = registry.getEnabled(settings).filter(p => typeof p.getManualDefaults === 'function');

    if (enabledPlugins.length === 0) {
      return res.status(400).send("No manual add enabled modules");
    }

    const typeQuery = req.query.type as string | undefined;
    let selectedPlugin = enabledPlugins.find(p => p.id === typeQuery);

    if (!selectedPlugin) {
      selectedPlugin = enabledPlugins[0]!;
    }

    const defaults = selectedPlugin.getManualDefaults!();
    const activeCollectionId = res.locals.activeCollectionId;

    const suggestions = await buildFieldSuggestions(selectedPlugin, activeCollectionId, defaults);
    const genres = await Item.distinct('genre', {
      collection: activeCollectionId,
      genre: { $ne: "" },
      $or: [{ kind: selectedPlugin.kind }, { kind: { $exists: false } }]
    });

    res.render('manual-add', {
      enabledPlugins,
      selectedPlugin,
      plugin: selectedPlugin,
      defaults,
      item: defaults,
      isManual: true,
      suggestions,
      genres,
      baseUrl: res.locals.baseUrl || '',
      user: res.locals.user
    });
  } catch (err: any) {
    console.error("Error loading manual-add page:", err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
