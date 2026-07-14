import fs from 'fs';
import path from 'path';
import { registry } from './registry';
import { PluginDefinition } from './types';

export const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

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
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.warn('[PluginLoader] No plugins/ directory found.');
    return;
  }

  const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const discovered: PluginDefinition[] = [];
  const seen = { id: new Map<string, string>(), kind: new Map<string, string>(), routePrefix: new Map<string, string>(), collectionType: new Map<string, string>() };

  for (const dir of dirs) {
    const { plugin, errors } = loadPluginFromDir(dir);
    if (!plugin) {
      console.error(`[PluginLoader] plugins/${dir} skipped:\n  - ${errors.join('\n  - ')}`);
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

/**
 * Loads and shape-validates a single plugins/<dir> module, without registering it.
 * Used by the boot-time scan above and by the custom-plugin hot (re)load, which
 * clears the require cache first to pick up a rewritten plugin.json/index.ts.
 */
export function loadPluginFromDir(dir: string, freshRequire = false): { plugin?: PluginDefinition; errors: string[] } {
  const dirPath = path.join(PLUGINS_DIR, dir);

  if (freshRequire) {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(dirPath + path.sep)) delete require.cache[key];
    }
  }

  let mod: any;
  try {
    mod = require(path.join(dirPath, 'index'));
  } catch (err: any) {
    return { errors: [`failed to load: ${err.message}`] };
  }

  const plugin: PluginDefinition | undefined =
    mod.default && isPlugin(mod.default)
      ? mod.default
      : Object.values(mod).find(isPlugin) as PluginDefinition | undefined;

  if (!plugin) {
    return { errors: ['exports no valid PluginDefinition'] };
  }

  const problems = validatePlugin(plugin, dir);
  if (problems.length > 0) {
    return { errors: problems };
  }

  return { plugin, errors: [] };
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
