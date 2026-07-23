import { Router } from 'express';
import { registry } from './registry';
import { createItemRoutes } from './routes/itemRoutes';
import { loadPluginFromDir } from './loadPlugins';
import { PluginDefinition } from './types';

/**
 * Runtime plugin routing.
 *
 * Plugin routers are NOT mounted directly on `app`: anything mounted after boot
 * would land behind the 404 handler and never match. Instead app.ts mounts a
 * single dispatcher middleware once, and this module keeps the per-plugin
 * routers in a map that can be updated at runtime (custom-plugin create/edit/
 * delete without restarting the server).
 */
const routers = new Map<string, Router>();

export function mountPluginRoutes(plugin: PluginDefinition): void {
  routers.set(plugin.id, createItemRoutes(plugin));
}

export function unmountPluginRoutes(pluginId: string): void {
  routers.delete(pluginId);
}

export function pluginDispatcher(req: any, res: any, next: any): void {
  const list = Array.from(routers.values());
  let i = 0;
  const run = (err?: any): void => {
    if (err) return next(err);
    const router = list[i++];
    if (!router) return next();
    router(req, res, run);
  };
  run();
}

/**
 * Hot (re)loads plugins/<dir>: fresh require, contract validation, uniqueness
 * check against the live registry, then registry + routes swap. `replacesId`
 * is set when editing an existing plugin (its old registration is removed first).
 */
export function registerPluginDirAtRuntime(dir: string, replacesId?: string): { plugin?: PluginDefinition; errors: string[] } {
  const { plugin, errors } = loadPluginFromDir(dir, true);
  if (!plugin) return { errors };

  const clashes: string[] = [];
  for (const other of registry.getAll()) {
    if (other.id === replacesId || other.id === plugin.id) continue;
    for (const key of ['id', 'kind', 'routePrefix', 'collectionType'] as const) {
      if ((other as any)[key] === (plugin as any)[key]) {
        clashes.push(`${key} "${(plugin as any)[key]}" already used by plugin "${other.id}"`);
      }
    }
  }
  if (clashes.length > 0) return { errors: clashes };

  if (replacesId && registry.get(replacesId)) {
    registry.unregister(replacesId);
    unmountPluginRoutes(replacesId);
  }
  // Same-id re-register (edit without rename): drop the stale discriminator so
  // the updated schema takes effect immediately.
  if (registry.get(plugin.id)) {
    registry.unregister(plugin.id);
    unmountPluginRoutes(plugin.id);
  }

  registry.register(plugin);
  mountPluginRoutes(plugin);
  console.log(`[PluginRuntime] Hot-registered plugin "${plugin.id}" from plugins/${dir}`);
  return { plugin, errors: [] };
}

/** Removes a plugin from the live app (registry + routes). Files are handled by the caller. */
export function unregisterPluginAtRuntime(pluginId: string): void {
  registry.unregister(pluginId);
  unmountPluginRoutes(pluginId);
}
