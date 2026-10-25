import { isJpegBuffer, managedItemImageFile, storeItemImage, MAX_ITEM_IMAGE_UPLOAD_BYTES } from '../../core/itemImageStorage';

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
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) return remoteUrl;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ITEM_IMAGE_UPLOAD_BYTES || !isJpegBuffer(buffer)) return remoteUrl;
    return await storeItemImage(buffer);
  } catch (err: any) {
    console.error('[ERR] Yu-Gi-Oh image copy:', err.message);
    return remoteUrl;
  }
}

/**
 * The cover a refresh should keep: one already copied locally is the same artwork, so it
 * is not downloaded again into a second file.
 */
export async function refreshedYugiohImage(current: string, remoteUrl: string): Promise<string> {
  if (managedItemImageFile(current)) return current;
  return cacheYugiohImage(remoteUrl);
}
