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
  isValidIcon,
  CUSTOM_PLUGIN_PALETTE,
  CUSTOM_PLUGIN_ICONS
} from '../core/customPluginStore';
import { sanitizeExtraFields, getExtraFields } from '../core/pluginExtraFields';
import { placeholderUrl } from '../core/placeholderImage';
import { cardFieldCandidates, getCardLines, MAX_CARD_LINES, CORNER_POSITIONS, DEFAULT_CORNER_POSITION } from '../core/cardFields';
import { registerPluginDirAtRuntime, unregisterPluginAtRuntime } from '../core/pluginRuntime';
import { saveCustomPluginToDB, deleteCustomPluginFromDB } from '../core/customPluginSync';

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

// GET /create-plugin[?edit=<id>] -> plugin editor page
router.get('/', async (req: any, res: any) => {
  try {
    const customPlugins = await listCustomPlugins();
    const editId = typeof req.query.edit === 'string' ? req.query.edit : '';
    const edited = editId
      ? (customPlugins.find(c => c.config.id === editId)?.config || null)
      : null;

    // An uploaded default cover is a few hundred kB of base64 and the config is inlined
    // in the page: the builder only gets a URL to preview it, and the stored value is
    // kept server-side unless the form actually posts a new one.
    const editPlaceholder = edited ? placeholderUrl(edited.id, edited.defaultCover) : '';
    let editConfig: any = null;
    if (edited) {
      const { defaultCover, ...rest } = edited;
      editConfig = rest;
    }

    const settings = res.locals.settings;
    const customization = settings?.pluginCustomization || {};

    // Cosmetic-override targets: every plugin, with translated labels for the modal.
    // Read through the decorated registry so the collection's user-defined fields are
    // offered as card fields too.
    const customizablePlugins = res.locals.registry.getAll().map((p: any) => ({
      id: p.id,
      label: req.t(p.label),
      icon: p.icon,
      isCustom: !!getCustomConfig(p),
      enabled: settings?.modules?.[p.collectionType] === true,
      formats: (p.formats || []).map((f: any) => ({ value: f.value, label: req.t(f.label) })),
      current: customization[p.id] || {},
      extraFields: getExtraFields(settings, p.id),
      cardFieldChoices: cardFieldCandidates(p).map(f => ({
        name: f.name,
        label: req.t(f.label, { defaultValue: f.label })
      })),
      // What the cards show today, so an untouched plugin opens on its real state
      cardFields: p.defaultCardFields || [p.creatorField]
    }));

    res.render('create-plugin', {
      user: res.locals.user,
      customPlugins,
      customizablePlugins,
      editConfig,
      editPlaceholder,
      palette: CUSTOM_PLUGIN_PALETTE,
      iconChoices: CUSTOM_PLUGIN_ICONS,
      maxCardLines: MAX_CARD_LINES
    });
  } catch (err: any) {
    console.error('[PluginBuilder] page error:', err);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /create-plugin/customize/:pluginId -> per-collection cosmetic overrides
// (icon, format badge colors). An empty submission clears the override.
router.post('/customize/:pluginId', async (req: any, res: any) => {
  try {
    const plugin = registry.get(req.params.pluginId);
    if (!plugin) {
      return res.status(404).json({ success: false, error: req.t('errors.not_found') });
    }
    const activeCollectionId = res.locals.activeCollectionId;
    if (!activeCollectionId) {
      return res.status(400).json({ success: false, error: req.t('errors.generic_server_error') });
    }

    const cosmetics: any = {};
    const icon = typeof req.body.icon === 'string' ? req.body.icon.trim() : '';
    if (icon) {
      if (!isValidIcon(icon)) {
        return res.status(400).json({ success: false, error: req.t('create_plugin.err_bad_icon') });
      }
      cosmetics.icon = icon;
    }

    const submitted = req.body.formatColors || {};
    const formatColors: Record<string, string> = {};
    for (const f of plugin.formats || []) {
      const color = submitted[f.value];
      if (typeof color === 'string' && (CUSTOM_PLUGIN_PALETTE as readonly string[]).includes(color)) {
        formatColors[f.value] = color;
      }
    }
    if (Object.keys(formatColors).length > 0) cosmetics.formatColors = formatColors;

    if (req.body.sortFormats === true || req.body.sortFormats === 'true') cosmetics.sortFormats = true;

    // Corner field. Checked against what the plugin actually offers, so a crafted payload
    // cannot put an arbitrary path on every cover; an empty submission clears it.
    if (typeof req.body.cornerField === 'string' && req.body.cornerField) {
      const decorated = res.locals.registry.get(plugin.id) || plugin;
      if (cardFieldCandidates(decorated).some(f => f.name === req.body.cornerField)) {
        cosmetics.cornerField = req.body.cornerField;
        // Only ever one of the free corners; anything else falls back to the default
        // rather than being written and rendered as a broken class string.
        cosmetics.cornerPosition = Object.prototype.hasOwnProperty.call(CORNER_POSITIONS, req.body.cornerPosition)
          ? req.body.cornerPosition
          : DEFAULT_CORNER_POSITION;
      }
    }

    // Card fields. Reordered to the plugin's own field order (the modal is a selection,
    // not a ranking) and capped, so a crafted payload cannot overflow the card.
    if (Array.isArray(req.body.cardFields)) {
      const decorated = res.locals.registry.get(plugin.id) || plugin;
      const picked = new Set(req.body.cardFields.filter((n: any) => typeof n === 'string'));
      cosmetics.cardFields = cardFieldCandidates(decorated)
        .map(f => f.name)
        .filter(name => picked.has(name))
        .slice(0, MAX_CARD_LINES);
    }

    // User-defined fields. Only validated and written when the submission carries the
    // key, so a caller that only changes the icon never touches the declared fields.
    let extraUpdate: { set?: any; unset?: string } | null = null;
    if (req.body.extraFields !== undefined) {
      const { fields, errors } = sanitizeExtraFields(req.body.extraFields, plugin);
      if (errors.length > 0) {
        return res.status(400).json({ success: false, error: errors.map(e => req.t(e)).join(' ') });
      }
      const path = `pluginExtraFields.${plugin.id}`;
      extraUpdate = fields.length > 0 ? { set: { [path]: fields } } : { unset: path };
    }

    const cosmeticsPath = `pluginCustomization.${plugin.id}`;
    const $set: any = {};
    const $unset: any = {};
    if (cosmetics.icon || cosmetics.formatColors || cosmetics.cardFields || cosmetics.sortFormats || cosmetics.cornerField) $set[cosmeticsPath] = cosmetics;
    else $unset[cosmeticsPath] = '';
    if (extraUpdate?.set) Object.assign($set, extraUpdate.set);
    if (extraUpdate?.unset) $unset[extraUpdate.unset] = '';

    const update: any = {};
    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys($unset).length > 0) update.$unset = $unset;
    await Settings.updateOne({ collection: activeCollectionId }, update);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[PluginBuilder] customize error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
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

    // Persist to the DB (source of truth). The folder is just a regenerable cache,
    // so this is what makes the plugin survive rebuilds and travel with backups.
    await saveCustomPluginToDB(config, existing?.id);

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
    await deleteCustomPluginFromDB(config.id);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[PluginBuilder] delete error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

export default router;
