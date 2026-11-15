/**
 * Keeping a copy of the images items link to (#136). A cover chosen from a search, a
 * picture pasted as an address: both stay on someone else's server, which may delete,
 * move or refuse them one day, and neither travels in a backup. Once a collection keeps
 * copies, each such image is downloaded through core/safeFetch.ts, checked to be an
 * image, stored like an upload, and only then put in place of the address.
 *
 * The instance says whether collections keep copies; a collection may say always or
 * never instead. New images are taken as they come: right after an item is saved or
 * refreshed, and in an automatic pass over what changed since copies were turned on
 * (imports). The images already there wait for an admin to start the run explicitly,
 * since it may mean a lot of downloads and disk space.
 *
 * Nothing is replaced until its copy is on disk, an address that fails stays as it was
 * and is not tried again by the automatic pass, and the run stops on its own when the
 * disk runs low. One run at a time, two downloads at once.
 */
import { promises as fs } from 'fs';
import { db } from './db';
import { all, and, eq, isIn, or, range, contains, Filter } from './db/filter';
import { idOf } from './db/ids';
import { fetchPublic, isFetchableUrl } from './safeFetch';
import {
  deleteUnusedManagedItemImages, imageExtensionOf, ITEM_IMAGES_DIR, MAX_ITEM_IMAGE_UPLOAD_BYTES, storeItemImage
} from './itemImageStorage';

export type CollectionImageMode = 'inherit' | 'download' | 'keep';
export const COLLECTION_IMAGE_MODES: CollectionImageMode[] = ['inherit', 'download', 'keep'];

const CONCURRENCY = 2;
const AUTO_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
// Below this much free space the run stops rather than fill the disk. IMAGE_DOWNLOAD_MIN_FREE_MB
// moves the line.
const minFreeBytes = () => Math.max(0, Number(process.env.IMAGE_DOWNLOAD_MIN_FREE_MB || 500)) * 1024 * 1024;

const IMAGE_PATHS = ['cover_image', 'images', 'user_image'] as const;

/** The addresses an item shows that live on another server. */
export function externalImagesOf(item: any): string[] {
  const values = [item?.cover_image, ...(Array.isArray(item?.images) ? item.images : []), item?.user_image];
  return [...new Set(values.filter((v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && isFetchableUrl(v.trim())))];
}

/** What a collection keeps, the instance's word applied where it defers. */
export function keepsCopies(instance: { enabled?: boolean } | null | undefined, settings: any): boolean {
  const mode: CollectionImageMode = COLLECTION_IMAGE_MODES.includes(settings?.imageDownload) ? settings.imageDownload : 'inherit';
  if (mode === 'download') return true;
  if (mode === 'keep') return false;
  return !!instance?.enabled;
}

/** Since when a collection keeps copies, for the automatic pass. */
function keepingSince(instance: any, settings: any): Date | null {
  const mode = settings?.imageDownload;
  const raw = mode === 'download' ? settings?.imageDownloadSince : instance?.since;
  const date = raw ? new Date(raw) : null;
  return date && !isNaN(date.getTime()) ? date : null;
}

async function instanceChoice(): Promise<{ enabled: boolean; since: Date | null }> {
  const doc: any = await db.instanceSettings.findOne(eq('key', 'instance'));
  return { enabled: !!doc?.imageDownload?.enabled, since: doc?.imageDownload?.since || null };
}

/** The collections that keep copies, each with the date their automatic pass starts at. */
export async function collectionsKeepingCopies(): Promise<{ collectionId: any; since: Date | null }[]> {
  const instance = await instanceChoice();
  const every = await db.settings.find(all(), { fields: ['collection', 'imageDownload', 'imageDownloadSince'] });
  return (every as any[])
    .filter(s => s.collection && keepsCopies(instance, s))
    .map(s => ({ collectionId: s.collection, since: keepingSince(instance, s) }));
}

async function enoughDisk(): Promise<boolean> {
  try {
    await fs.mkdir(ITEM_IMAGES_DIR, { recursive: true });
    const stat: any = await (fs as any).statfs(ITEM_IMAGES_DIR);
    return Number(stat.bavail) * Number(stat.bsize) >= minFreeBytes();
  } catch {
    // A system that cannot tell is not stopped for it.
    return true;
  }
}

// ---- Two downloads at a time, whoever asks --------------------------------------------
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

class DiskFullError extends Error {}

/**
 * Downloads what one item links to and puts the copies in place. Addresses that failed
 * before are skipped unless `retry`. Returns how many images were copied and failed.
 */
export async function copyItemImages(itemId: any, retry = false): Promise<{ copied: number; failed: number }> {
  const item: any = await db.items.findById(idOf(itemId));
  if (!item) return { copied: 0, failed: 0 };
  const previouslyFailed = new Set<string>(Array.isArray(item.image_download_failed) ? item.image_download_failed : []);
  const wanted = externalImagesOf(item).filter(url => retry || !previouslyFailed.has(url));
  if (wanted.length === 0) return { copied: 0, failed: 0 };

  const copies = new Map<string, string>();
  const failed = new Set<string>(retry ? [] : previouslyFailed);
  for (const url of wanted) {
    if (!(await enoughDisk())) throw new DiskFullError('disk_low');
    try {
      const buffer = await withSlot(() => fetchPublic(url, { maxBytes: MAX_ITEM_IMAGE_UPLOAD_BYTES, timeoutMs: 15000 }));
      if (!imageExtensionOf(buffer)) throw new Error('not_an_image');
      copies.set(url, await storeItemImage(buffer));
      failed.delete(url);
    } catch (err: any) {
      failed.add(url);
    }
  }

  // Read again: someone may have edited the item while it downloaded. Only the
  // addresses it still shows are replaced; a copy nobody needs any more is removed.
  const fresh: any = await db.items.findById(idOf(itemId));
  const unused: string[] = [];
  if (!fresh) {
    unused.push(...copies.values());
  } else {
    const set: Record<string, any> = {};
    const replace = (value: any) => (typeof value === 'string' && copies.has(value.trim()) ? copies.get(value.trim()) : value);
    for (const path of IMAGE_PATHS) {
      const value = fresh[path];
      if (Array.isArray(value)) {
        const next = value.map(replace);
        if (next.some((v: any, i: number) => v !== value[i])) set[path] = next;
      } else if (typeof value === 'string' && copies.has(value.trim())) {
        set[path] = replace(value);
      }
    }
    const shown = new Set([fresh.cover_image, ...(fresh.images || []), fresh.user_image].filter(Boolean).map((v: string) => v.trim()));
    const origins = (Array.isArray(fresh.image_origins) ? fresh.image_origins : []).filter((o: any) => o && o.file && o.url);
    for (const [url, file] of copies) {
      if (shown.has(url)) origins.push({ file, url });
      else unused.push(file);
    }
    if (origins.length > 0) set.image_origins = origins;
    const stillFailed = [...failed].filter(url => shown.has(url));
    const patch: any = { set };
    if (stillFailed.length > 0) set.image_download_failed = stillFailed;
    else patch.unset = ['image_download_failed'];
    await db.items.updateOne(eq('_id', idOf(itemId)), patch);
  }
  if (unused.length > 0) {
    try { await deleteUnusedManagedItemImages(unused); } catch { /* the periodic sweep will */ }
  }
  return { copied: copies.size, failed: wanted.filter(url => !copies.has(url)).length };
}

// ---- One item, right after it was saved or refreshed ---------------------------------
const pending = new Set<string>();

/** Copies an item's images in the background when its collection keeps copies. Never throws. */
export function copyItemImagesSoon(itemId: any, collectionId: any): void {
  const key = String(itemId);
  if (!itemId || pending.has(key)) return;
  pending.add(key);
  (async () => {
    try {
      const settings = await db.settings.findOne(eq('collection', idOf(collectionId)), { fields: ['imageDownload'] });
      if (!keepsCopies(await instanceChoice(), settings)) return;
      await copyItemImages(itemId);
    } catch (err: any) {
      if (!(err instanceof DiskFullError)) console.warn('[IMAGE DOWNLOAD] Item copy failed:', err.message);
    } finally {
      pending.delete(key);
    }
  })();
}

// ---- A run over many items ------------------------------------------------------------
export interface ImageDownloadStatus {
  running: boolean;
  mode: 'existing' | 'auto' | null;
  items: number;
  doneItems: number;
  copied: number;
  failed: number;
  stopped: 'disk_low' | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const status: ImageDownloadStatus = {
  running: false, mode: null, items: 0, doneItems: 0, copied: 0, failed: 0, stopped: null, startedAt: null, finishedAt: null
};

export function imageDownloadStatus(): ImageDownloadStatus {
  return { ...status };
}

// Items of the collections given that still show an address. The stores have no "starts
// with" test, so the filter is broad and externalImagesOf() has the last word.
function linkingFilter(collectionIds: any[], since?: Date | null): Filter {
  return and(
    isIn('collection', collectionIds.map(idOf)),
    or(...IMAGE_PATHS.map(path => contains(path, '://'))),
    since ? range('updated_at', { gte: since }) : null
  );
}

/**
 * How many images the explicit run would download, across the collections keeping copies,
 * and among them how many were already tried and did not answer: those are said apart,
 * since another run only tries them again.
 */
export async function countExistingExternalImages(onlyCollection?: any): Promise<{ items: number; images: number; failed: number }> {
  const collections = (await collectionsKeepingCopies())
    .filter(c => !onlyCollection || String(c.collectionId) === String(onlyCollection));
  if (collections.length === 0) return { items: 0, images: 0, failed: 0 };
  const items = await db.items.find(linkingFilter(collections.map(c => c.collectionId)), { fields: [...IMAGE_PATHS, 'image_download_failed'] });
  let count = 0;
  let images = 0;
  let failed = 0;
  for (const item of items as any[]) {
    const tried = new Set(Array.isArray(item.image_download_failed) ? item.image_download_failed : []);
    const found = externalImagesOf(item);
    if (found.length > 0) { count++; images += found.length; }
    failed += found.filter(url => tried.has(url)).length;
  }
  return { items: count, images, failed };
}

async function run(mode: 'existing' | 'auto', onlyCollection?: any): Promise<void> {
  const collections = (await collectionsKeepingCopies())
    .filter(c => !onlyCollection || String(c.collectionId) === String(onlyCollection));
  const targets: any[] = [];
  for (const { collectionId, since } of collections) {
    // The automatic pass only takes what changed since copies were turned on.
    if (mode === 'auto' && !since) continue;
    const found = await db.items.find(linkingFilter([collectionId], mode === 'auto' ? since : null), { fields: [...IMAGE_PATHS, 'image_download_failed'] });
    for (const item of found as any[]) {
      const failed = new Set(Array.isArray(item.image_download_failed) ? item.image_download_failed : []);
      const urls = externalImagesOf(item).filter(url => mode === 'existing' || !failed.has(url));
      if (urls.length > 0) targets.push(item._id);
    }
  }

  Object.assign(status, {
    running: true, mode, items: targets.length, doneItems: 0, copied: 0, failed: 0, stopped: null,
    startedAt: new Date(), finishedAt: null
  });
  try {
    // Items in turn, each one's images two at a time through the shared slots.
    for (const id of targets) {
      try {
        const result = await copyItemImages(id, mode === 'existing');
        status.copied += result.copied;
        status.failed += result.failed;
      } catch (err: any) {
        if (err instanceof DiskFullError) { status.stopped = 'disk_low'; break; }
        status.failed++;
      }
      status.doneItems++;
    }
  } finally {
    status.running = false;
    status.finishedAt = new Date();
  }
}

/** Starts the run over the images already there, of one collection or all, unless one is going. */
export function startExistingImageDownload(onlyCollection?: any): boolean {
  if (status.running) return false;
  // Marked at once, so a second click before the item list is read is refused too.
  status.running = true;
  run('existing', onlyCollection).catch(err => { console.error('[IMAGE DOWNLOAD] Run failed:', err); status.running = false; });
  return true;
}

/** The automatic pass, every few hours, for what came in by other ways (imports). */
export function scheduleImageDownloads(): void {
  const tick = () => {
    if (status.running) return;
    run('auto').catch(err => console.error('[IMAGE DOWNLOAD] Automatic pass failed:', err));
  };
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, AUTO_SWEEP_EVERY_MS).unref?.();
}

/** Turns copies on or off for the whole instance; turning them on dates the automatic pass. */
export async function setInstanceImageDownload(enabled: boolean): Promise<void> {
  const current = await instanceChoice();
  const set: Record<string, any> = { 'imageDownload.enabled': enabled };
  if (enabled && !current.enabled) set['imageDownload.since'] = new Date();
  await db.instanceSettings.updateOne(eq('key', 'instance'), { set }, { upsert: true });
}

/** A collection's own choice; switching to "always" dates its automatic pass. */
export async function setCollectionImageDownload(collectionId: any, mode: CollectionImageMode, previous: any): Promise<void> {
  const set: Record<string, any> = { imageDownload: mode };
  if (mode === 'download' && previous !== 'download') set.imageDownloadSince = new Date();
  await db.settings.updateOne(eq('collection', idOf(collectionId)), { set });
}

export async function instanceImageDownload(): Promise<{ enabled: boolean; since: Date | null }> {
  return instanceChoice();
}
