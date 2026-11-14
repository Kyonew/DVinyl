import crypto from 'crypto';
import fs from 'fs/promises';
import { isJpegBuffer, managedItemImageFile, ITEM_IMAGES_DIR, ITEM_IMAGES_URL_PREFIX, MAX_ITEM_IMAGE_UPLOAD_BYTES } from '../../core/itemImageStorage';

const DOWNLOAD_TIMEOUT_MS = 15000;

/**
 * YGOPRODeck's usage policy forbids hotlinking card images ("download and re-host, or
 * risk an IP blacklist", which would hit every install behind the same address). So a
 * cover this plugin saves is copied into the instance's own item images, like an upload:
 * it travels with ZIP backups, is released with the item, and a copy the user ends up
 * not saving is swept with the other abandoned uploads.
 *
 * Falls back to the remote URL when the download fails, rather than failing the add.
 */
export async function cacheYugiohImage(remoteUrl: string): Promise<string> {
  if (!remoteUrl) return '';
  try {
    // One file per card image, named after its address: every search shows a dozen of
    // them, and searching the same cards again must not write the same files again.
    const stored = yugiohImagePath(remoteUrl);
    const file = managedItemImageFile(stored)!;
    try {
      // Touched, so the sweep of abandoned uploads gives a copy just shown again a day.
      const now = new Date();
      await fs.utimes(file, now, now);
      return stored;
    } catch { /* not copied yet */ }
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) return remoteUrl;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ITEM_IMAGE_UPLOAD_BYTES || !isJpegBuffer(buffer)) return remoteUrl;
    await fs.mkdir(ITEM_IMAGES_DIR, { recursive: true });
    try {
      await fs.writeFile(file, buffer, { flag: 'wx' });
    } catch (err: any) {
      // Two searches copying the same card at once: the first one's file serves both.
      if (err.code !== 'EEXIST') throw err;
    }
    return stored;
  } catch (err: any) {
    console.error('[ERR] Yu-Gi-Oh image copy:', err.message);
    return remoteUrl;
  }
}

/** The stored path of a card image, the same for one address every time. */
export function yugiohImagePath(remoteUrl: string): string {
  const hex = crypto.createHash('sha256').update(remoteUrl).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return `${ITEM_IMAGES_URL_PREFIX}item-${id}.jpg`;
}

/**
 * The cover a refresh should keep: one already copied locally is the same artwork, so it
 * is not downloaded again into a second file.
 */
export async function refreshedYugiohImage(current: string, remoteUrl: string): Promise<string> {
  if (managedItemImageFile(current)) return current;
  return cacheYugiohImage(remoteUrl);
}
