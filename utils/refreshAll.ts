import Item from '../models/Item';
import { PluginDefinition } from '../core/types';
import { PermanentRefreshError, syncStamp } from '../core/helpers';
import { alignImagesAfterRefresh } from '../core/itemImages';
import { deleteUnusedManagedItemImages } from '../core/itemImageStorage';
import { RefreshMode } from './refreshJobs';

/**
 * Metadata refresh shared by the web admin route (which forwards progress to socket.io)
 * and the /api/v1 job (which records it on the job). The logic is the web loop moved
 * verbatim; only the progress sink differs.
 */

export interface RefreshProgress {
  current: number;
  total: number;
  title: string;
}

/**
 * The items a bulk refresh covers: the plugin's items that carry an external id. Mirrors
 * the web query exactly, including the legacy fallback for plugins that claim kind-less
 * items. `mode: 'missing'` keeps only items whose genre metadata is still empty.
 */
export async function collectRefreshItems(
  plugin: PluginDefinition,
  collectionId: any,
  mode: RefreshMode
): Promise<any[]> {
  const idField = plugin.externalIdField || '_id';

  const query: any = {
    collection: collectionId,
    [idField]: { $exists: true, $ne: null }
  };

  if (plugin.matchesLegacyItems) {
    query.$and = [{ $or: [{ kind: plugin.kind }, { kind: { $exists: false } }] }];
  } else {
    query.kind = plugin.kind;
  }

  if (mode === 'missing') {
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { genre: { $exists: false } },
        { genre: '' },
        { genre: null },
        { genres: { $exists: false } },
        { genres: { $size: 0 } },
        { styles: { $exists: false } },
        { styles: { $size: 0 } }
      ]
    });
  }

  return Item.find(query).lean();
}

export interface RunPluginRefreshOptions {
  plugin: PluginDefinition;
  items: any[];
  mode: RefreshMode;
  req: any;
  onProgress?: (progress: RefreshProgress) => void;
}

export async function runPluginRefresh(
  options: RunPluginRefreshOptions
): Promise<{ refreshed: number; failed: number }> {
  const { plugin, items, mode, req, onProgress } = options;
  const total = items.length;
  let refreshed = 0;
  let failed = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    onProgress?.({ current: index + 1, total, title: `${item[plugin.creatorField]} - ${item.title}` });

    let success = false;
    let attempts = 0;
    while (!success && attempts < 3) {
      try {
        const refreshedData = await plugin.refreshItem!(item, req);
        // "missing" mode only backfills genre metadata, never clobbering cover/description/
        // publisher/etc that the user may have edited by hand.
        let dataToApply = refreshedData;
        if (mode === 'missing') {
          dataToApply = {};
          for (const k of ['genre', 'genres', 'styles']) {
            if (refreshedData[k] !== undefined) dataToApply[k] = refreshedData[k];
          }
        }
        // Same realignment as the single-item refresh: a new cover replaces the old one
        // inside the gallery instead of pushing it down into it. Copied rather than mutated,
        // since in full mode this is the plugin's own return value.
        const update = { ...dataToApply };
        const replacedCover = alignImagesAfterRefresh(item, update);
        // Written even when the provider changed nothing, so the date says when the item was
        // last checked rather than when it last happened to differ.
        // `kind` in the filter makes Mongoose cast against the plugin's discriminator schema;
        // without it, strict mode silently strips provider fields that are not base Item paths
        // (creator, theme, pieces...). Same filter the single-item API refresh uses.
        await Item.updateOne({ _id: item._id, kind: plugin.kind }, { $set: { ...update, ...syncStamp() } });
        if (replacedCover) {
          try {
            await deleteUnusedManagedItemImages([replacedCover]);
          } catch (cleanupError) {
            console.warn('[ITEM IMAGE] Post-refresh cleanup failed:', cleanupError);
          }
        }

        success = true;
        refreshed++;
        await new Promise(r => setTimeout(r, plugin.bulkRefreshDelayMs ?? 500));
      } catch (err: any) {
        attempts++;
        console.error(`[ERR] Refresh bulk ID for ${plugin.id} (Attempt ${attempts}):`, err.message);
        // Nothing about this item can change between attempts: retrying only stretches the
        // run by 6 seconds per item for the same failure.
        if (err instanceof PermanentRefreshError) break;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!success) failed++;
  }

  return { refreshed, failed };
}
