import express from 'express';
import Item from '../models/Item';
import Settings from '../models/Settings';
import { requireAuth, requireCollectionRole } from '../middleware/authMiddleware';
import { registry } from '../core/registry';
import {
  buildConfigFromSubmission,
  writeCustomPluginDir,
  deleteCustomPluginDir,
  getCustomConfig,
  CUSTOM_PLUGIN_PALETTE,
  CUSTOM_PLUGIN_ICONS
} from '../core/customPluginStore';
import { registerPluginDirAtRuntime, unregisterPluginAtRuntime } from '../core/pluginRuntime';

/**
 * /create-plugin: builder for user-created ("custom") plugins.
 *
 * Collection admins design a manual-only item type (fields, formats, image shape...)
 * with a live preview; saving writes plugins/<id>/{plugin.json,index.ts} and
 * hot-registers the plugin without restarting the server.
 */
const router = express.Router();

router.use(requireAuth, requireCollectionRole('admin'));

async function listCustomPlugins() {
  const out: { config: any; itemCount: number }[] = [];
  for (const p of registry.getAll()) {
    const config = getCustomConfig(p);
    if (!config) continue;
    // Instance-wide count: the plugin folder is global, not per-collection
    const itemCount = await Item.countDocuments({ kind: p.kind });
    out.push({ config, itemCount });
  }
  return out;
}

// GET /create-plugin[?edit=<id>] -> builder page
router.get('/', async (req: any, res: any) => {
  try {
    const customPlugins = await listCustomPlugins();
    const editId = typeof req.query.edit === 'string' ? req.query.edit : '';
    const editConfig = editId
      ? (customPlugins.find(c => c.config.id === editId)?.config || null)
      : null;

    res.render('create-plugin', {
      user: res.locals.user,
      customPlugins,
      editConfig,
      palette: CUSTOM_PLUGIN_PALETTE,
      iconChoices: CUSTOM_PLUGIN_ICONS
    });
  } catch (err: any) {
    console.error('[PluginBuilder] page error:', err);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /create-plugin/save -> create or update a custom plugin (JSON API)
router.post('/save', async (req: any, res: any) => {
  try {
    const editId = typeof req.body.editId === 'string' ? req.body.editId : '';
    const existingPlugin = editId ? registry.get(editId) : undefined;
    const existing = existingPlugin ? getCustomConfig(existingPlugin) : undefined;
    if (editId && !existing) {
      return res.status(404).json({ success: false, errors: [req.t('errors.not_found')] });
    }

    const { config, errors } = buildConfigFromSubmission(req.body, existing);
    if (!config) {
      return res.status(400).json({ success: false, errors: errors.map((k: string) => req.t(k)) });
    }

    writeCustomPluginDir(config);
    const result = registerPluginDirAtRuntime(config.id, existing?.id);
    if (!result.plugin) {
      // Should not happen (config was validated), but never leave a broken folder behind
      try { deleteCustomPluginDir(config.id); } catch { /* best effort */ }
      console.error(`[PluginBuilder] hot-register failed for ${config.id}:`, result.errors);
      return res.status(500).json({ success: false, errors: result.errors });
    }

    // Rename: drop the old folder once the new registration is live
    if (existing && existing.id !== config.id) {
      try { deleteCustomPluginDir(existing.id); } catch (err: any) {
        console.warn(`[PluginBuilder] could not remove old folder plugins/${existing.id}: ${err.message}`);
      }
    }

    // Enable the module right away for the admin's active collection
    const activeCollectionId = res.locals.activeCollectionId;
    if (activeCollectionId) {
      const update: any = { $set: { [`modules.${config.id}`]: true } };
      if (existing && existing.id !== config.id) {
        update.$unset = { [`modules.${existing.id}`]: '' };
      }
      await Settings.updateOne({ collection: activeCollectionId }, update);
    }

    res.json({ success: true, id: config.id });
  } catch (err: any) {
    console.error('[PluginBuilder] save error:', err);
    res.status(500).json({ success: false, errors: [req.t('errors.generic_server_error')] });
  }
});

// POST /create-plugin/delete/:id -> remove a custom plugin (items stay in DB)
router.post('/delete/:id', async (req: any, res: any) => {
  try {
    const plugin = registry.get(req.params.id);
    const config = plugin ? getCustomConfig(plugin) : undefined;
    if (!plugin || !config) {
      return res.status(404).json({ success: false, error: req.t('errors.not_found') });
    }

    deleteCustomPluginDir(config.id);
    unregisterPluginAtRuntime(config.id);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[PluginBuilder] delete error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

export default router;
