import Settings from '../models/Settings';
import { registry } from '../core/registry';

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
