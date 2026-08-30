import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import Item from '../models/Item';
import { BASE_URL } from '../config/constants';

export const ITEM_IMAGES_URL_PREFIX = '/uploads/items/';
export const ITEM_IMAGES_DIR = path.join(__dirname, '../public/uploads/items');
export const MAX_ITEM_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const STALE_ITEM_IMAGE_GRACE_MS = 24 * 60 * 60 * 1000;

const MANAGED_ITEM_IMAGE = /^\/uploads\/items\/(item-[0-9a-f-]{36}\.jpg)$/i;

export function isJpegBuffer(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function managedItemImageFile(image: unknown): string | null {
  if (typeof image !== 'string') return null;
  const match = MANAGED_ITEM_IMAGE.exec(image.trim());
  const filename = match?.[1];
  return filename ? path.join(ITEM_IMAGES_DIR, filename) : null;
}

/** Resolves a portable stored path to the URL exposed by this deployment. */
export function itemImageUrl(image: unknown): string {
  if (typeof image !== 'string') return '';
  const value = image.trim();
  const deploymentBaseUrl = BASE_URL.replace(/\/+$/, '');
  return managedItemImageFile(value) ? `${deploymentBaseUrl}${value}` : value;
}

export function managedItemImagesFrom(item: any): string[] {
  const values = [
    item?.cover_image,
    ...(Array.isArray(item?.images) ? item.images : []),
    item?.user_image
  ];
  return [...new Set(values.filter(value => managedItemImageFile(value)) as string[])];
}

export async function storeItemImage(buffer: Buffer): Promise<string> {
  if (!isJpegBuffer(buffer)) throw new Error('invalid_image');
  if (buffer.length > MAX_ITEM_IMAGE_UPLOAD_BYTES) throw new Error('image_too_large');

  await fs.mkdir(ITEM_IMAGES_DIR, { recursive: true });
  const filename = `item-${crypto.randomUUID()}.jpg`;
  await fs.writeFile(path.join(ITEM_IMAGES_DIR, filename), buffer, { flag: 'wx' });
  return `${ITEM_IMAGES_URL_PREFIX}${filename}`;
}

/** Collects managed file paths before a destructive query removes their item documents. */
export async function managedItemImagesForQuery(query: Record<string, any>): Promise<string[]> {
  const items = await Item.find(query).select('cover_image user_image images').lean();
  return [...new Set(items.flatMap(managedItemImagesFrom))];
}

/**
 * Deletes only files no longer referenced by any item. The database check makes this safe
 * for restored backups or manually duplicated paths shared by several documents.
 */
export async function deleteUnusedManagedItemImages(candidates: unknown[]): Promise<number> {
  const managed = [...new Set(candidates.filter(value => managedItemImageFile(value)) as string[])];
  if (managed.length === 0) return 0;

  const referencedItems = await Item.find({
    $or: [
      { images: { $in: managed } },
      { cover_image: { $in: managed } },
      { user_image: { $in: managed } }
    ]
  }).select('cover_image user_image images').lean();
  const referenced = new Set(referencedItems.flatMap(managedItemImagesFrom));

  let deleted = 0;
  for (const image of managed) {
    if (referenced.has(image)) continue;
    const file = managedItemImageFile(image);
    if (!file) continue;
    try {
      await fs.unlink(file);
      deleted += 1;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  return deleted;
}

/** Removes abandoned uploads after a grace period, while preserving every DB reference. */
export async function cleanupStaleItemImageUploads(
  olderThanMs = STALE_ITEM_IMAGE_GRACE_MS
): Promise<number> {
  await fs.mkdir(ITEM_IMAGES_DIR, { recursive: true });
  const entries = await fs.readdir(ITEM_IMAGES_DIR, { withFileTypes: true });
  const cutoff = Date.now() - olderThanMs;
  const candidates: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const image = `${ITEM_IMAGES_URL_PREFIX}${entry.name}`;
    const file = managedItemImageFile(image);
    if (!file) continue;
    const stat = await fs.stat(file);
    if (stat.mtimeMs < cutoff) candidates.push(image);
  }

  return deleteUnusedManagedItemImages(candidates);
}
