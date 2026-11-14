import express from 'express';
import { db } from '../core/db';
import { eq, idOf } from '../core/db/query';
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
import { sanitizeExtraFields, getExtraFields, nativeLookalikesByPlugin, findNativeLookalikes } from '../core/pluginExtraFields';
import { planTransfer, runTransfer } from '../core/extraFieldTransfer';
import { and, filled } from '../core/db/filter';
import { SUPPORTED_LANGUAGES } from '../config/constants';
import { placeholderUrl } from '../core/placeholderImage';
import { defaultPlacement, detailCandidates, placementOf, sanitizeDetailPlacement } from '../core/detailPlacement';
import { cardFieldCandidates, isTranslationKey, getCardLines, MAX_CARD_LINES, CORNER_POSITIONS, DEFAULT_CORNER_POSITION, defaultTableColumnNames, sanitizeTableColumns, tableColumnNames } from '../core/cardFields';
import { filterCandidates, filterOverrides, activeFilters, sanitizeFilterSelection } from '../core/filterFields';
import { registerPluginDirAtRuntime, unregisterPluginAtRuntime } from '../core/pluginRuntime';
import { saveCustomPluginToDB, deleteCustomPluginFromDB } from '../core/customPluginSync';
import { generatePluginDraft } from '../core/ai/pluginGenerate';
import { getAiConfig } from '../core/ai/instance';
import { isAiConfigured } from '../core/ai/config';

/**
 * /create-plugin: builder for user-created ("custom") plugins.
 *
 * Collection admins design a manual-only item type (fields, formats, image shape...)
 * with a live preview; saving writes plugins/<id>/{plugin.json,index.ts} and
 * hot-registers the plugin without restarting the server.
 */
const router = express.Router();

router.use(requireAuth, requireCollectionRole('admin'));

/** A description is a sentence, not a pasted list: generous but not import-sized. */
const MAX_DESCRIPTION_CHARS = 2000;

async function listCustomPlugins() {
  const out: { config: any; itemCount: number }[] = [];
  for (const p of registry.getAll()) {
    const config = getCustomConfig(p);
    if (!config) continue;
    // Instance-wide count: the plugin folder is global, not per-collection
    const itemCount = await db.items.count(eq('kind', p.kind));
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
    // Read on the bare registry: the decorated one lists the user-defined fields among
    // the plugin's own, which would make every one of them look like itself.
    const lookalikes = nativeLookalikesByPlugin(
      settings,
      registry.getAll(),
      key => SUPPORTED_LANGUAGES.map(lng => req.t(key, { lng }))
    );

    const customizablePlugins = res.locals.registry.getAll().map((p: any) => ({
      id: p.id,
      label: req.t(p.label),
      icon: p.icon,
      isCustom: !!getCustomConfig(p),
      enabled: settings?.modules?.[p.collectionType] === true,
      formats: (p.formats || []).map((f: any) => ({ value: f.value, label: req.t(f.label) })),
      current: customization[p.id] || {},
      extraFields: getExtraFields(settings, p.id),
      // User-defined field key -> label of the plugin's own field it looks like
      lookalikes: Object.fromEntries((lookalikes[p.id] || []).map(l => [l.name, req.t(l.nativeLabel)])),
      // ...and the key of that field, which "keep both" records.
      lookalikeNames: Object.fromEntries((lookalikes[p.id] || []).map(l => [l.name, l.nativeName])),
      cardFieldChoices: cardFieldCandidates(p).map(f => ({
        name: f.name,
        label: req.t(f.label, { defaultValue: f.label })
      })),
      // What the cards show today, so an untouched plugin opens on its real state
      cardFields: p.defaultCardFields || [p.creatorField],
      tableColumns: tableColumnNames(p),
      // Every field of the item page with where it sits now, and where it would by default
      detailChoices: detailCandidates(p).map(f => ({
        name: f.name,
        label: req.t(f.label, { defaultValue: f.label }),
        placement: placementOf(p, f.name),
        byDefault: defaultPlacement(p, f.name)
      })),
      // Read on the bare plugin for the same reason as the lookalikes above
      filterChoices: (() => {
        const bare = registry.get(p.id);
        if (!bare) return [];
        const candidates = filterCandidates(bare, getExtraFields(settings, p.id));
        const on = new Set(activeFilters(candidates, filterOverrides(customization, p.id)).map(c => c.id));
        return candidates.map(c => ({
          id: c.id,
          label: isTranslationKey(c.label) ? req.t(c.label, { defaultValue: c.label }) : c.label,
          on: on.has(c.id)
        }));
      })()
    }));

    res.render('create-plugin', {
      user: res.locals.user,
      customPlugins,
      customizablePlugins,
      editConfig,
      editPlaceholder,
      palette: CUSTOM_PLUGIN_PALETTE,
      iconChoices: CUSTOM_PLUGIN_ICONS,
      maxCardLines: MAX_CARD_LINES,
      aiConfigured: isAiConfigured(await getAiConfig()),
      maxAiDescriptionChars: MAX_DESCRIPTION_CHARS
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

    // Table columns, after the card fields, which an untouched table follows.
    if (Array.isArray(req.body.tableColumns)) {
      const decorated = res.locals.registry.get(plugin.id) || plugin;
      const tableColumns = sanitizeTableColumns(decorated, req.body.tableColumns, [
        defaultTableColumnNames(decorated),
        defaultTableColumnNames({ ...decorated, defaultCardFields: cosmetics.cardFields || decorated.defaultCardFields })
      ]);
      if (tableColumns) cosmetics.tableColumns = tableColumns;
    }

    // Where fields sit on the item page. Only moves away from the type's default are
    // kept, and only for fields the page lays out.
    if (req.body.detailFields !== undefined) {
      const decorated = res.locals.registry.get(plugin.id) || plugin;
      const detailFields = sanitizeDetailPlacement(decorated, req.body.detailFields);
      if (detailFields) cosmetics.detailFields = detailFields;
    }

    // Filters shown on the collection page once this type is selected. Only what differs
    // from the default is kept (see core/filterFields.ts), so leaving every box as it
    // came stores nothing. Read against the fields declared before this save: one added
    // in the same submission has no box yet and simply keeps its default.
    if (Array.isArray(req.body.filters)) {
      const candidates = filterCandidates(plugin, getExtraFields(res.locals.settings, plugin.id));
      const filters = sanitizeFilterSelection(candidates, req.body.filters);
      if (Object.keys(filters).length > 0) cosmetics.filters = filters;
    }

    // User-defined fields. Only validated and written when the submission carries the
    // key, so a caller that only changes the icon never touches the declared fields.
    let extraUpdate: { set?: any; unset?: string } | null = null;
    if (req.body.extraFields !== undefined) {
      const existingFields = getExtraFields(res.locals.settings, plugin.id);
      const { fields, errors } = sanitizeExtraFields(req.body.extraFields, plugin, existingFields);
      if (errors.length > 0) {
        return res.status(400).json({ success: false, error: errors.map(e => req.t(e)).join(' ') });
      }
      const path = `pluginExtraFields.${plugin.id}`;
      extraUpdate = fields.length > 0 ? { set: { [path]: fields } } : { unset: path };
    }

    const cosmeticsPath = `pluginCustomization.${plugin.id}`;
    const set: Record<string, any> = {};
    const unset: string[] = [];
    if (cosmetics.icon || cosmetics.formatColors || cosmetics.cardFields || cosmetics.sortFormats || cosmetics.cornerField || cosmetics.filters || cosmetics.tableColumns || cosmetics.detailFields) set[cosmeticsPath] = cosmetics;
    else unset.push(cosmeticsPath);
    if (extraUpdate?.set) Object.assign(set, extraUpdate.set);
    if (extraUpdate?.unset) unset.push(extraUpdate.unset);

    await db.settings.updateOne(eq('collection', idOf(activeCollectionId)), { set, unset });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[PluginBuilder] customize error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// A field of the active collection, and the plugin's own field it looks like if any.
// Read on the bare plugin, like the lookalikes of the page itself.
function fieldAndLookalike(req: any, res: any) {
  const plugin = registry.get(req.params.pluginId);
  if (!plugin) return null;
  const def = getExtraFields(res.locals.settings, plugin.id).find(f => f.name === req.params.name);
  if (!def) return null;
  const labelsFor = (key: string) => SUPPORTED_LANGUAGES.map(lng => req.t(key, { lng }));
  const look = findNativeLookalikes(plugin, [{ ...def, keepBeside: undefined } as any], labelsFor)[0];
  const native = look ? (plugin.formFields || []).find(f => f.name === look.nativeName) || null : null;
  return { plugin, def, native };
}

// GET /create-plugin/customize/:pluginId/fields/:name -> how many items hold a value in a
// collection's field, and what moving it into the plugin's own lookalike would do.
router.get('/customize/:pluginId/fields/:name', async (req: any, res: any) => {
  try {
    const found = fieldAndLookalike(req, res);
    if (!found) return res.status(404).json({ success: false, error: req.t('errors.not_found') });
    const { plugin, def, native } = found;
    const collectionId = res.locals.activeCollectionId;
    const withValue = await db.items.count(and(eq('collection', idOf(collectionId)), eq('kind', plugin.kind), filled(`extra.${def.name}`)));
    if (!native) return res.json({ success: true, withValue, native: null });
    const plan = await planTransfer(collectionId, plugin, def, native, (k: string) => req.t(k));
    res.json({
      success: true,
      withValue,
      native: { name: native.name, label: req.t(native.label, { defaultValue: native.label }) },
      move: plan.move.length,
      same: plan.same.length,
      conflict: plan.conflict,
      incompatible: plan.incompatible
    });
  } catch (err: any) {
    console.error('[PluginBuilder] field usage error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /create-plugin/customize/:pluginId/fields/:name/transfer -> moves the values into
// the plugin's own field, never over a different one (core/extraFieldTransfer.ts).
router.post('/customize/:pluginId/fields/:name/transfer', async (req: any, res: any) => {
  try {
    const found = fieldAndLookalike(req, res);
    if (!found || !found.native) return res.status(404).json({ success: false, error: req.t('errors.not_found') });
    const result = await runTransfer(res.locals.activeCollectionId, found.plugin, found.def, found.native, (k: string) => req.t(k));
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[PluginBuilder] field transfer error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /create-plugin/customize/:pluginId/fields/:name/keep -> keeps a field beside the
// plugin's own lookalike on purpose, so it is no longer reported.
router.post('/customize/:pluginId/fields/:name/keep', async (req: any, res: any) => {
  try {
    const found = fieldAndLookalike(req, res);
    if (!found || !found.native) return res.status(404).json({ success: false, error: req.t('errors.not_found') });
    const fields = getExtraFields(res.locals.settings, found.plugin.id)
      .map(f => (f.name === found.def.name ? { ...f, keepBeside: found.native!.name } : f));
    await db.settings.updateOne(eq('collection', idOf(res.locals.activeCollectionId)), { set: { [`pluginExtraFields.${found.plugin.id}`]: fields } });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[PluginBuilder] field keep error:', err);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /create-plugin/ai-generate -> draft a plugin config from a text description
router.post('/ai-generate', async (req: any, res: any) => {
  try {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!description) {
      return res.status(400).json({ success: false, errors: [req.t('create_plugin.ai_err_empty')] });
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      return res.status(400).json({
        success: false,
        errors: [req.t('create_plugin.ai_err_too_long', { max: MAX_DESCRIPTION_CHARS })]
      });
    }

    const config = await getAiConfig();
    if (!isAiConfigured(config)) {
      return res.status(400).json({ success: false, errors: [req.t('ai.err_not_configured')] });
    }

    let draft;
    try {
      draft = await generatePluginDraft(config, description);
    } catch (err: any) {
      return res.status(502).json({
        success: false,
        errors: [req.t('create_plugin.ai_err_generation_failed', { error: err.message })]
      });
    }
    if (!draft) {
      return res.status(502).json({ success: false, errors: [req.t('create_plugin.ai_err_failed')] });
    }

    res.json({ success: true, draft });
  } catch (err: any) {
    console.error('[PluginBuilder] AI generate error:', err);
    res.status(500).json({ success: false, errors: [req.t('errors.generic_server_error')] });
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
      await db.settings.updateOne(eq('collection', idOf(activeCollectionId)), {
        set: { [`modules.${config.id}`]: true },
        unset: existing && existing.id !== config.id ? [`modules.${existing.id}`] : []
      });
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
