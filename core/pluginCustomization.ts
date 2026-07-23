import { registry } from './registry';
import { PluginDefinition } from './types';

/**
 * Per-collection cosmetic overrides for plugins (native and custom alike),
 * stored in settings.pluginCustomization:
 *   { [pluginId]: { icon: 'fa-xxx', formatColors: { [formatValue]: paletteColor } } }
 *
 * Plugin definitions are shared singletons, so they are never mutated. Instead,
 * each request gets decorated shallow clones through a registry facade placed on
 * res.locals.registry, plus a res.render wrapper for the routes that hand a
 * `plugin` object straight to their view. Business logic keeps importing the
 * real registry and never sees the cosmetics.
 */
export interface PluginCosmetics {
  icon?: string;
  formatColors?: Record<string, string>;
}

export type PluginCustomizationMap = Record<string, PluginCosmetics>;

export function decoratePlugin(plugin: PluginDefinition, map: PluginCustomizationMap): PluginDefinition {
  const cosmetics = map?.[plugin.id];
  if (!cosmetics || (!cosmetics.icon && !cosmetics.formatColors)) return plugin;

  const clone: any = { ...plugin };
  if (cosmetics.icon) {
    // PluginDefinition.icon is stored without the 'fa-' prefix (views prepend it)
    clone.icon = cosmetics.icon.replace(/^fa-/, '');
  }
  if (cosmetics.formatColors) {
    // cardBadge implementations resolve colors through this.formats, so
    // recoloring the clone's formats also recolors the card badges.
    clone.formats = (plugin.formats || []).map(f =>
      cosmetics.formatColors![f.value]
        ? { ...f, color: `bg-${cosmetics.formatColors![f.value]}-600/90` }
        : f
    );
  }
  return clone as PluginDefinition;
}

export function applyPluginCustomization(res: any): void {
  const map: PluginCustomizationMap = res.locals.settings?.pluginCustomization || {};
  const decorate = (p: PluginDefinition | undefined) => (p ? decoratePlugin(p, map) : p);

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
