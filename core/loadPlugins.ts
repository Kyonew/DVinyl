import fs from 'fs';
import path from 'path';
import { registry } from './registry';
import { PluginDefinition } from './types';

/**
 * Auto-discovers and registers every plugin under `plugins/`.
 *
 * A plugin is any sub-directory of `plugins/` exposing an `index` module whose
 * default export (or first PluginDefinition-shaped named export) is a plugin.
 * Dropping a new folder, e.g. `plugins/lego/`, makes it appear everywhere
 * (navbar, themes, hidden types, widgets, imports...) without touching the core.
 *
 * Plugins are registered in ascending `order` (default 100), then by folder name,
 * so display order stays stable and controllable.
 */
export function loadPlugins(): void {
  const pluginsDir = path.join(__dirname, '..', 'plugins');

  if (!fs.existsSync(pluginsDir)) {
    console.warn('[PluginLoader] No plugins/ directory found.');
    return;
  }

  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const discovered: PluginDefinition[] = [];
  const seen = { id: new Map<string, string>(), kind: new Map<string, string>(), routePrefix: new Map<string, string>(), collectionType: new Map<string, string>() };

  for (const dir of dirs) {
    let mod: any;
    try {
      mod = require(path.join(pluginsDir, dir, 'index'));
    } catch (err: any) {
      console.error(`[PluginLoader] plugins/${dir} failed to load, skipped: ${err.message}`);
      continue;
    }

    const plugin: PluginDefinition | undefined =
      mod.default && isPlugin(mod.default)
        ? mod.default
        : Object.values(mod).find(isPlugin) as PluginDefinition | undefined;

    if (!plugin) {
      console.warn(`[PluginLoader] plugins/${dir} exports no valid PluginDefinition, skipped.`);
      continue;
    }

    // Validate the contract: required fields + uniqueness across plugins
    const problems = validatePlugin(plugin, dir);
    if (problems.length > 0) {
      console.error(`[PluginLoader] plugins/${dir} is invalid, skipped:\n  - ${problems.join('\n  - ')}`);
      continue;
    }

    const clashes: string[] = [];
    for (const key of ['id', 'kind', 'routePrefix', 'collectionType'] as const) {
      const val = (plugin as any)[key];
      if (seen[key].has(val)) clashes.push(`${key} "${val}" already used by plugins/${seen[key].get(val)}`);
    }
    if (clashes.length > 0) {
      console.error(`[PluginLoader] plugins/${dir} conflicts, skipped:\n  - ${clashes.join('\n  - ')}`);
      continue;
    }
    for (const key of ['id', 'kind', 'routePrefix', 'collectionType'] as const) {
      seen[key].set((plugin as any)[key], dir);
    }

    discovered.push(plugin);
  }

  discovered
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id))
    .forEach(plugin => registry.register(plugin));

  console.log(`[PluginLoader] Registered ${registry.getAll().length} plugin(s): ${registry.getAll().map(p => p.id).join(', ')}`);
}

function isPlugin(value: any): value is PluginDefinition {
  return !!value
    && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.kind === 'string'
    && !!value.schemaDefinition;
}

/** Returns a list of contract violations (empty = valid). Keeps error messages actionable for plugin authors. */
function validatePlugin(p: PluginDefinition, dir: string): string[] {
  const problems: string[] = [];
  const requiredString = ['id', 'kind', 'label', 'icon', 'routePrefix', 'collectionType', 'creatorField', 'i18nKey'] as const;
  for (const field of requiredString) {
    if (typeof (p as any)[field] !== 'string' || !(p as any)[field]) {
      problems.push(`missing/empty required string field "${field}"`);
    }
  }
  if (p.routePrefix && !p.routePrefix.startsWith('/')) problems.push(`routePrefix "${p.routePrefix}" must start with "/"`);
  if (!p.schemaDefinition || typeof p.schemaDefinition !== 'object') problems.push('missing schemaDefinition object');
  if (!Array.isArray(p.formFields) || p.formFields.length === 0) problems.push('formFields must be a non-empty array');
  if (!Array.isArray(p.formats)) problems.push('formats must be an array');
  for (const fn of ['getStats', 'formatForView', 'findDuplicate', 'getVariants'] as const) {
    if (typeof (p as any)[fn] !== 'function') problems.push(`missing required method "${fn}()"`);
  }
  if (p.creatorField && p.schemaDefinition && !(p.creatorField in p.schemaDefinition)) {
    // creatorField may legitimately live on the base Item schema; warn softly rather than reject
    console.warn(`[PluginLoader] plugins/${dir}: creatorField "${p.creatorField}" is not in schemaDefinition (ok if on the base Item schema).`);
  }
  return problems;
}
