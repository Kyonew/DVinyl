import fs from 'fs';
import CustomPlugin from '../models/CustomPlugin';
import { PLUGINS_DIR } from './loadPlugins';
import { registry } from './registry';
import { CustomPluginConfig } from './customPlugin';
import { writeCustomPluginDir, deleteCustomPluginDir, getCustomConfig } from './customPluginStore';
import { registerPluginDirAtRuntime, unregisterPluginAtRuntime } from './pluginRuntime';

/**
 * Database persistence for no-code plugins.
 *
 * The plugins/<id>/ folder is a regenerable cache; the CustomPlugin collection is
 * the source of truth. This module keeps the two in sync so custom types survive
 * container rebuilds and travel with an instance backup:
 *   - the builder dual-writes via saveCustomPluginToDB / deleteCustomPluginFromDB,
 *   - boot and instance-restore reconcile disk with the DB (see app.ts, backupRoutes.ts).
 */

/** Upsert a custom plugin config into the DB. `previousId` drops the old doc on rename. */
export async function saveCustomPluginToDB(config: CustomPluginConfig, previousId?: string): Promise<void> {
  if (previousId && previousId !== config.id) {
    await CustomPlugin.deleteOne({ id: previousId });
  }
  await CustomPlugin.updateOne(
    { id: config.id },
    { $set: { id: config.id, kind: config.kind, config } },
    { upsert: true }
  );
}

/** Remove a custom plugin from the DB. */
export async function deleteCustomPluginFromDB(id: string): Promise<void> {
  await CustomPlugin.deleteOne({ id });
}

/**
 * Persist any on-disk custom plugin folder that has no matching DB row yet (loaded
 * by loadPlugins() but never stored). Never removes anything. Runs at boot before
 * applyCustomPluginsFromDB so a folder is never lost when the DB row is missing.
 */
export async function backfillCustomPluginsToDB(): Promise<void> {
  for (const plugin of registry.getAll()) {
    const config = getCustomConfig(plugin);
    if (!config) continue;
    if (await CustomPlugin.exists({ id: config.id })) continue;
    try {
      await saveCustomPluginToDB(config);
      console.log(`[CustomPluginSync] Backfilled "${config.id}" into the database.`);
    } catch (err: any) {
      console.error(`[CustomPluginSync] Backfill failed for "${config.id}": ${err.message}`);
    }
  }
}

/**
 * Make the live app's custom plugins match the DB exactly:
 *   - prune custom plugins that are registered/on disk but no longer in the DB,
 *   - (re)materialize the folder and hot-register every plugin stored in the DB.
 * Used at boot (fresh/rebuilt container re-grows its plugin folders) and right
 * after an instance restore. Best-effort per plugin: a bad one is logged and
 * skipped so it never blocks boot.
 */
export async function applyCustomPluginsFromDB(): Promise<void> {
  const stored = await CustomPlugin.find({}).lean() as any[];
  const storedIds = new Set(stored.map(d => d?.config?.id).filter(Boolean));

  // Prune custom plugins that the DB no longer knows about (e.g. after a restore
  // that replaced the whole instance).
  for (const plugin of registry.getAll()) {
    const config = getCustomConfig(plugin);
    if (!config || storedIds.has(config.id)) continue;
    unregisterPluginAtRuntime(config.id);
    try { deleteCustomPluginDir(config.id); } catch { /* folder may already be gone */ }
    console.log(`[CustomPluginSync] Pruned custom plugin "${config.id}" (not in database).`);
  }

  // Materialize + hot-register everything stored. Re-registering an already-live
  // plugin is idempotent (registerPluginDirAtRuntime swaps the discriminator), so
  // this also picks up config changes brought in by a restore.
  for (const doc of stored) {
    const config = doc?.config as CustomPluginConfig | undefined;
    if (!config || !config.id) continue;
    try {
      writeCustomPluginDir(config);
      const { plugin, errors } = registerPluginDirAtRuntime(config.id);
      if (plugin) {
        console.log(`[CustomPluginSync] Applied custom plugin "${config.id}" from the database.`);
      } else {
        console.error(`[CustomPluginSync] Could not register "${config.id}": ${errors.join(', ')}`);
      }
    } catch (err: any) {
      console.error(`[CustomPluginSync] Apply failed for "${config.id}": ${err.message}`);
    }
  }
}

/** Full boot reconciliation: backfill disk -> DB (migration), then apply DB -> disk. */
export async function syncCustomPluginsOnBoot(): Promise<void> {
  if (!fs.existsSync(PLUGINS_DIR)) return;
  await backfillCustomPluginsToDB();
  await applyCustomPluginsFromDB();
}
