import mongoose from 'mongoose';
import { PluginDefinition } from './types';
import Item from '../models/Item';

const FLATTENS_EXTRA = Symbol('flattensExtra');

/**
 * Wraps formatForView so the user-defined values stored in item.extra are also
 * readable at the top level of the view model. Views index fields as
 * `item[field.name]`, and the extra fields are declared with a plain name, so
 * without this every one of them would render empty.
 *
 * Done once at registration rather than in each of the plugins' formatForView, and
 * spread under the plugin's own output so a plugin path always wins over a stale
 * extra value carrying the same name.
 */
function flattenExtraValues(plugin: PluginDefinition): void {
  if ((plugin as any)[FLATTENS_EXTRA]) return;
  const original = plugin.formatForView.bind(plugin);
  plugin.formatForView = function (item: any): any {
    const view = original(item);
    if (!view || typeof view !== 'object') return view;
    const extra = view.extra;
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return view;
    return { ...extra, ...view };
  };
  (plugin as any)[FLATTENS_EXTRA] = true;
}

class PluginRegistry {
  private plugins: Map<string, PluginDefinition> = new Map();

  register(plugin: PluginDefinition): void {
    flattenExtraValues(plugin);
    this.plugins.set(plugin.id, plugin);

    try {
      const schema = new mongoose.Schema(plugin.schemaDefinition);
      Item.discriminator(plugin.kind, schema);
      console.log(`[PluginRegistry] Registered Mongoose discriminator for ${plugin.kind}`);
    } catch (err: any) {
      console.warn(`[PluginRegistry] Mongoose discriminator ${plugin.kind} registry warning: ${err.message}`);
    }
  }

  /**
   * Removes a plugin (custom-plugin edit/delete at runtime). Also drops the
   * Mongoose discriminator model so re-registering with an updated schema works
   * without restart.
   */
  unregister(id: string): void {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    this.plugins.delete(id);
    try {
      if ((Item as any).discriminators) {
        delete (Item as any).discriminators[plugin.kind];
      }
      mongoose.deleteModel(plugin.kind);
      console.log(`[PluginRegistry] Unregistered plugin ${id} (${plugin.kind})`);
    } catch (err: any) {
      console.warn(`[PluginRegistry] Unregister ${id} warning: ${err.message}`);
    }
  }

  get(id: string): PluginDefinition | undefined {
    return this.plugins.get(id);
  }

  getByKind(kind: string): PluginDefinition | undefined {
    return Array.from(this.plugins.values()).find(p => p.kind === kind);
  }

  getAll(): PluginDefinition[] {
    return Array.from(this.plugins.values());
  }

  getEnabled(settings: any): PluginDefinition[] {
    return this.getAll().filter(p => settings?.modules?.[p.collectionType] === true);
  }

  /** Map collectionType -> true if all the plugin's requiredEnvKeys are present in process.env. */
  getApiKeyStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const p of this.getAll()) {
      status[p.collectionType] = (p.requiredEnvKeys || []).every(k => !!process.env[k]);
    }
    return status;
  }

  /** Reads a plugin-scoped setting value, falling back to the plugin's declared default. */
  getPluginSetting(settings: any, pluginId: string, key: string): any {
    const stored = settings?.pluginSettings?.[pluginId]?.[key];
    if (stored !== undefined) return stored;
    const def = this.get(pluginId)?.settings?.find(s => s.key === key);
    return def ? def.default : undefined;
  }

  // Fresh-install defaults, all derived from the registered plugins

  /** modules map for a brand-new install: each plugin on/off per `enabledByDefault` */
  getDefaultModules(): Record<string, boolean> {
    const modules: Record<string, boolean> = {};
    for (const p of this.getAll()) {
      modules[p.collectionType] = p.enabledByDefault === true;
    }
    return modules;
  }

  /** plugin-scoped settings map seeded from each plugin's declared setting defaults */
  getDefaultPluginSettings(): Record<string, Record<string, any>> {
    const out: Record<string, Record<string, any>> = {};
    for (const p of this.getAll()) {
      if (p.settings && p.settings.length > 0) {
        const bucket: Record<string, any> = {};
        for (const s of p.settings) bucket[s.key] = s.default;
        out[p.id] = bucket;
      }
    }
    return out;
  }

  /** theme presets map: 'home' + one entry per plugin */
  getDefaultThemes(): Record<string, { preset: string }> {
    const theme: Record<string, { preset: string }> = { home: { preset: 'default' } };
    for (const p of this.getAll()) {
      theme[p.collectionType] = { preset: 'default' };
    }
    return theme;
  }

  /** navbar shortcuts pre-selected on a fresh install: home + enabled-by-default plugins' shortcuts + wishlist */
  getDefaultNavbarShortcuts(): string[] {
    const enabledByDefault = this.getAll().filter(p => p.enabledByDefault);
    const pluginShortcuts = enabledByDefault.flatMap(p => (p.navbarShortcuts || []).map(s => s.id));
    return ['global_home', ...pluginShortcuts, 'global_wishlist'];
  }

  /** stats widgets pre-selected on a fresh install: total + enabled-by-default plugins' widgets */
  getDefaultStatsWidgets(): string[] {
    const enabledByDefault = this.getAll().filter(p => p.enabledByDefault);
    const pluginWidgets = enabledByDefault.flatMap(p => (p.statsWidgets || []).map(w => w.id));
    return ['total', ...pluginWidgets];
  }
}

export const registry = new PluginRegistry();

