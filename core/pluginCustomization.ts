import { registry } from './registry';
import { PluginDefinition } from './types';
import { getExtraFields, toFieldDefinitions } from './pluginExtraFields';

/**
 * Per-collection overrides for plugins (native and custom alike):
 *   - cosmetics, in settings.pluginCustomization:
 *       { [pluginId]: { icon: 'fa-xxx', formatColors: { [formatValue]: paletteColor } } }
 *   - user-defined fields, in settings.pluginExtraFields (see pluginExtraFields.ts)
 *
 * Plugin definitions are shared singletons, so they are never mutated. Instead,
 * each request gets decorated shallow clones through a registry facade placed on
 * res.locals.registry, plus a res.render wrapper for the routes that hand a
 * `plugin` object straight to their view. Business logic keeps importing the
 * real registry and never sees the overrides.
 */
export interface PluginCosmetics {
  icon?: string;
  formatColors?: Record<string, string>;
  // Fields shown under the cover on cards; overrides the plugin's defaultCardFields.
  // An empty array is a deliberate "title only", so presence is what matters here.
  cardFields?: string[];
  // Formats listed alphabetically rather than in the order the plugin declares them.
  // Off by default: a native plugin's order carries meaning that sorting would lose.
  sortFormats?: boolean;
}

export type PluginCustomizationMap = Record<string, PluginCosmetics>;

export function decoratePlugin(
  plugin: PluginDefinition,
  map: PluginCustomizationMap,
  settings?: any,
  t?: (key: string, opts?: any) => string
): PluginDefinition {
  const cosmetics = map?.[plugin.id];
  const extraDefs = settings ? getExtraFields(settings, plugin.id) : [];
  const hasCosmetics = !!cosmetics && (!!cosmetics.icon || !!cosmetics.formatColors || !!cosmetics.cardFields || !!cosmetics.sortFormats);
  if (!hasCosmetics && extraDefs.length === 0) return plugin;

  const clone: any = { ...plugin };
  if (cosmetics?.icon) {
    // PluginDefinition.icon is stored without the 'fa-' prefix (views prepend it)
    clone.icon = cosmetics.icon.replace(/^fa-/, '');
  }
  if (cosmetics?.formatColors) {
    // cardBadge implementations resolve colors through this.formats, so
    // recoloring the clone's formats also recolors the card badges.
    clone.formats = (plugin.formats || []).map(f =>
      cosmetics.formatColors![f.value]
        ? { ...f, color: `bg-${cosmetics.formatColors![f.value]}-600/90` }
        : f
    );
  }
  if (cosmetics?.cardFields) {
    clone.defaultCardFields = cosmetics.cardFields;
  }
  if (cosmetics?.sortFormats) {
    // Sorted on what the reader sees, not on the raw label: a native plugin's labels are
    // translation keys, so ordering those would follow the key rather than the language.
    const shown = (label: string) => (t ? t(label, { defaultValue: label }) : label);
    const byLabel = (a: any, b: any) => shown(a.label).localeCompare(shown(b.label));
    clone.formats = [...(clone.formats || [])].sort(byLabel);
    // The form's own format select, whose options were built from the same list. Its
    // leading blank entry stays put: it is not a format, it is the absence of one.
    clone.formFields = (clone.formFields || []).map((f: any) => {
      if (f.name !== 'format' || !Array.isArray(f.options)) return f;
      const blanks = f.options.filter((o: any) => o.value === '');
      const rest = f.options.filter((o: any) => o.value !== '').sort(byLabel);
      return { ...f, options: [...blanks, ...rest] };
    });
  }
  if (extraDefs.length > 0) {
    // Appended, so user-defined fields land at the end of their own group and the
    // plugin's own field order is untouched. Reads the clone, not the plugin, so it
    // keeps whatever the blocks above already rewrote.
    clone.formFields = [...(clone.formFields || []), ...toFieldDefinitions(extraDefs)];
  }
  return clone as PluginDefinition;
}

export function applyPluginCustomization(res: any): void {
  const settings = res.locals.settings;
  const map: PluginCustomizationMap = settings?.pluginCustomization || {};
  const t = res.locals.t;
  const decorate = (p: PluginDefinition | undefined) => (p ? decoratePlugin(p, map, settings, t) : p);

  res.locals.registry = {
    getAll: () => registry.getAll().map(p => decorate(p)),
    getEnabled: (settings: any) => registry.getEnabled(settings).map(p => decorate(p)),
    get: (id: string) => decorate(registry.get(id)),
    getByKind: (kind: string) => decorate(registry.getByKind(kind)),
    getApiKeyStatus: () => registry.getApiKeyStatus(),
    getPluginSetting: (settings: any, pluginId: string, key: string) => registry.getPluginSetting(settings, pluginId, key),
    getDefaultStatsWidgets: () => registry.getDefaultStatsWidgets()
  };

  const render = res.render.bind(res);
  res.render = function (view: string, locals?: any, cb?: any) {
    if (locals && typeof locals === 'object') {
      for (const key of ['plugin', 'selectedPlugin'] as const) {
        if (locals[key]) locals[key] = decorate(locals[key]);
      }
      if (Array.isArray(locals.enabledPlugins)) {
        locals.enabledPlugins = locals.enabledPlugins.map((p: PluginDefinition) => decorate(p));
      }
    }
    return render(view, locals, cb);
  };
}
