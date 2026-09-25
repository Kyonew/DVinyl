import mongoose from 'mongoose';
import Settings from '../models/Settings';
import Item from '../models/Item';
import PRESETS from '../config/themes';
import { registry } from '../core/registry';
import { CARD_ASPECT_RATIOS } from '../core/customPlugin';

/** Reads a Mongoose Map or a plain object with the same keys: a `.lean()` read may
 *  hand back either, depending on the field type. */
export function mapGet(map: any, key: string): any {
  if (!map) return undefined;
  if (typeof map.get === 'function') return map.get(key);
  return map[key];
}

/**
 * Settings are scoped per collection (models/Settings.ts). Fetched fresh rather than
 * trusted from res.locals.settings, which middleware/settingsMiddleware.ts only ever
 * populates for the session's active collection. Mirrors settingsMiddleware's own
 * upsert pattern. Shared by collectionsRoutes, valuesRoutes and the settings routes.
 */
export async function getCollectionSettings(collectionId: any) {
  return Settings.findOneAndUpdate(
    { collection: collectionId },
    { $setOnInsert: { collection: collectionId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

/**
 * The API shape of a Settings document: JSON-native (`theme` flattened out of the
 * stored `{ preset }` sub-document), covering every registered plugin so a client
 * renders a full screen even for a plugin added after the document was written.
 * Stored keys for plugins that are no longer registered are ignored, not leaked.
 */
export function serializeCollectionSettings(settings: any) {
  const modules: Record<string, boolean> = {};
  const theme: Record<string, string> = { home: mapGet(settings?.theme, 'home')?.preset ?? 'default' };
  for (const plugin of registry.getAll()) {
    const ct = plugin.collectionType;
    modules[ct] = mapGet(settings?.modules, ct) ?? plugin.enabledByDefault === true;
    theme[ct] = mapGet(settings?.theme, ct)?.preset ?? 'default';
  }

  // Only registered plugins' declared keys, each backed by its declared default, so a
  // stored setting for a plugin that no longer exists is ignored rather than echoed.
  const pluginSettings: Record<string, Record<string, any>> = {};
  for (const plugin of registry.getAll()) {
    const declared = plugin.settings || [];
    if (declared.length === 0) continue;
    const stored = mapGet(settings?.pluginSettings, plugin.id) || {};
    const bucket: Record<string, any> = {};
    for (const def of declared) {
      bucket[def.key] = stored[def.key] !== undefined ? stored[def.key] : def.default;
    }
    pluginSettings[plugin.id] = bucket;
  }

  const vis = settings?.visibility || {};
  return {
    modules,
    mergeDuplicates: settings?.mergeDuplicates !== false,
    pluginSettings,
    visibility: {
      applyToAdmin: vis.applyToAdmin === true,
      hiddenItems: (vis.hiddenItems || []).map((id: any) => String(id)),
      hiddenGenres: vis.hiddenGenres || [],
      hiddenTypes: vis.hiddenTypes || []
    },
    theme,
    aspectRatioClass: settings?.aspectRatioClass || 'aspect-square',
    navbarShortcuts: settings?.navbarShortcuts || [],
    statsWidgets: settings?.statsWidgets || [],
    fastAdd: settings?.fastAdd || ''
  };
}

export const MAX_NAVBAR_SHORTCUTS = 6;
export const MAX_VISIBILITY_LIST = 500;

export const GLOBAL_NAVBAR_SHORTCUTS = [
  { id: 'global_home', label: 'nav.home' },
  { id: 'global_collection', label: 'nav.collection' },
  { id: 'global_wishlist', label: 'nav.wishlist' }
];

export const GLOBAL_STATS_WIDGETS = [
  { id: 'total', label: 'stats.total_label', kind: 'count' as const }
];

const SETTINGS_KEYS = new Set([
  'modules', 'mergeDuplicates', 'pluginSettings', 'visibility',
  'theme', 'aspectRatioClass', 'navbarShortcuts', 'statsWidgets', 'fastAdd'
]);

const isPlainObject = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

function stringArray(value: any): string[] | null {
  if (!Array.isArray(value) || value.some((v: any) => typeof v !== 'string')) return null;
  return value;
}

/**
 * Validates a partial settings PATCH against the current document and returns the
 * dotted `$set` update. Rejects before the caller writes anything, judging rules that
 * depend on the result (e.g. "one module stays on") on current + patch. `error` with no
 * `update` means the request is invalid.
 */
export async function buildSettingsUpdate(
  collectionId: any,
  current: any,
  body: any
): Promise<{ update?: Record<string, any>; error?: string; code?: string }> {
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    return { error: 'Nothing to update' };
  }
  for (const key of Object.keys(body)) {
    if (!SETTINGS_KEYS.has(key)) return { error: `Unknown field: ${key}` };
  }

  const plugins = registry.getAll();
  const update: Record<string, any> = {};

  if ('modules' in body) {
    if (!isPlainObject(body.modules)) return { error: 'modules must be an object' };
    const merged: Record<string, boolean> = {};
    for (const p of plugins) merged[p.collectionType] = !!mapGet(current?.modules, p.collectionType);
    for (const [ct, val] of Object.entries(body.modules)) {
      if (!plugins.some(p => p.collectionType === ct)) return { error: `Unknown module: ${ct}` };
      if (typeof val !== 'boolean') return { error: `Module ${ct} must be a boolean` };
      merged[ct] = val;
      update[`modules.${ct}`] = val;
    }
    if (!Object.values(merged).some(Boolean)) {
      return { error: 'At least one module must stay active', code: 'no_module' };
    }
  }

  if ('mergeDuplicates' in body) {
    if (typeof body.mergeDuplicates !== 'boolean') return { error: 'mergeDuplicates must be a boolean' };
    update.mergeDuplicates = body.mergeDuplicates;
  }

  if ('pluginSettings' in body) {
    if (!isPlainObject(body.pluginSettings)) return { error: 'pluginSettings must be an object' };
    for (const [pluginId, values] of Object.entries(body.pluginSettings)) {
      const plugin = registry.get(pluginId);
      if (!plugin) return { error: `Unknown plugin: ${pluginId}` };
      if (!isPlainObject(values)) return { error: `pluginSettings.${pluginId} must be an object` };
      for (const [key, val] of Object.entries(values as Record<string, any>)) {
        const def = (plugin.settings || []).find(s => s.key === key);
        if (!def) return { error: `Unknown setting for ${pluginId}: ${key}` };
        if (typeof val !== 'boolean') return { error: `pluginSettings.${pluginId}.${key} must be a boolean` };
        update[`pluginSettings.${pluginId}.${key}`] = val;
      }
    }
  }

  if ('visibility' in body) {
    const vis = body.visibility;
    if (!isPlainObject(vis)) return { error: 'visibility must be an object' };
    for (const key of Object.keys(vis)) {
      if (!['applyToAdmin', 'hiddenItems', 'hiddenGenres', 'hiddenTypes'].includes(key)) {
        return { error: `Unknown field: visibility.${key}` };
      }
    }

    if ('applyToAdmin' in vis) {
      if (typeof vis.applyToAdmin !== 'boolean') return { error: 'visibility.applyToAdmin must be a boolean' };
      update['visibility.applyToAdmin'] = vis.applyToAdmin;
    }

    if ('hiddenItems' in vis) {
      if (!Array.isArray(vis.hiddenItems)) return { error: 'visibility.hiddenItems must be an array' };
      const ids = vis.hiddenItems.map((raw: any) => String(raw));
      for (const id of ids) {
        if (!mongoose.Types.ObjectId.isValid(id)) return { error: 'A hidden item id is not valid' };
      }
      if (ids.length > MAX_VISIBILITY_LIST) return { error: `Too many hidden items (max ${MAX_VISIBILITY_LIST})` };
      if (ids.length > 0) {
        const found = await Item.countDocuments({ collection: collectionId, _id: { $in: ids } });
        if (found !== new Set(ids).size) {
          return { error: 'A hidden item does not exist in this collection' };
        }
      }
      update['visibility.hiddenItems'] = ids;
    }

    if ('hiddenGenres' in vis) {
      const arr = stringArray(vis.hiddenGenres);
      if (!arr || arr.some(g => g.trim() === '')) {
        return { error: 'visibility.hiddenGenres must be an array of non-empty strings' };
      }
      if (arr.length > MAX_VISIBILITY_LIST) return { error: `Too many hidden genres (max ${MAX_VISIBILITY_LIST})` };
      update['visibility.hiddenGenres'] = arr;
    }

    if ('hiddenTypes' in vis) {
      const arr = stringArray(vis.hiddenTypes);
      if (!arr) return { error: 'visibility.hiddenTypes must be an array of strings' };
      if (arr.length > MAX_VISIBILITY_LIST) return { error: `Too many hidden types (max ${MAX_VISIBILITY_LIST})` };
      const kinds = new Set(plugins.map(p => p.kind));
      for (const kind of arr) {
        if (!kinds.has(kind)) return { error: `Unknown item type: ${kind}` };
      }
      update['visibility.hiddenTypes'] = arr;
    }
  }

  if ('theme' in body) {
    if (!isPlainObject(body.theme)) return { error: 'theme must be an object' };
    const validKeys = new Set(['home', ...plugins.map(p => p.collectionType)]);
    for (const [key, preset] of Object.entries(body.theme)) {
      if (!validKeys.has(key)) return { error: `Unknown theme key: ${key}` };
      if (typeof preset !== 'string' || !Object.prototype.hasOwnProperty.call(PRESETS, preset)) {
        return { error: `Invalid theme preset: ${preset}` };
      }
      update[`theme.${key}.preset`] = preset;
    }
  }

  if ('aspectRatioClass' in body) {
    if (!(CARD_ASPECT_RATIOS as readonly string[]).includes(body.aspectRatioClass)) {
      return { error: `Invalid aspect ratio: ${body.aspectRatioClass}` };
    }
    update.aspectRatioClass = body.aspectRatioClass;
  }

  if ('navbarShortcuts' in body) {
    const arr = stringArray(body.navbarShortcuts);
    if (!arr) return { error: 'navbarShortcuts must be an array of strings' };
    const valid = new Set<string>(GLOBAL_NAVBAR_SHORTCUTS.map(s => s.id));
    for (const p of plugins) for (const s of p.navbarShortcuts || []) valid.add(s.id);
    for (const id of arr) {
      if (!valid.has(id)) return { error: `Unknown navbar shortcut: ${id}` };
    }
    const deduped = Array.from(new Set(arr));
    if (deduped.length > MAX_NAVBAR_SHORTCUTS) {
      return { error: `Too many navbar shortcuts (max ${MAX_NAVBAR_SHORTCUTS})` };
    }
    update.navbarShortcuts = deduped;
  }

  if ('statsWidgets' in body) {
    const arr = stringArray(body.statsWidgets);
    if (!arr) return { error: 'statsWidgets must be an array of strings' };
    const valid = new Set<string>(GLOBAL_STATS_WIDGETS.map(w => w.id));
    for (const p of plugins) for (const w of p.statsWidgets || []) valid.add(w.id);
    for (const id of arr) {
      if (!valid.has(id)) return { error: `Unknown stats widget: ${id}` };
    }
    update.statsWidgets = Array.from(new Set(arr));
  }

  if ('fastAdd' in body) {
    const valid = new Set<string>(['']);
    for (const p of plugins) for (const o of p.fastAddOptions || []) valid.add(o.value);
    if (typeof body.fastAdd !== 'string' || !valid.has(body.fastAdd)) {
      return { error: `Unknown quick-add option: ${body.fastAdd}` };
    }
    update.fastAdd = body.fastAdd;
  }

  if (Object.keys(update).length === 0) return { error: 'Nothing to update' };
  return { update };
}
