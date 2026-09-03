export const MAX_ITEM_IMAGES = 50;

// New local uploads are stored as files, but this limit still protects MongoDB from
// legacy data URLs and custom clients. Remote URLs and managed paths barely contribute.
export const MAX_ITEM_IMAGE_BYTES = 8 * 1024 * 1024;

export type ItemImageValidationCode = 'too_many' | 'too_large';

export class ItemImageValidationError extends Error {
  constructor(public readonly code: ItemImageValidationCode) {
    super(code);
    this.name = 'ItemImageValidationError';
  }
}

function cleanImageList(values: unknown[]): string[] {
  const seen = new Set<string>();
  const images: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const image = value.trim();
    if (!image || seen.has(image)) continue;
    seen.add(image);
    images.push(image);
    if (images.length >= MAX_ITEM_IMAGES) break;
  }

  return images;
}

function submittedImageList(values: unknown[]): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  let storedBytes = 0;

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const image = value.trim();
    if (!image || seen.has(image)) continue;

    if (images.length >= MAX_ITEM_IMAGES) {
      throw new ItemImageValidationError('too_many');
    }

    storedBytes += Buffer.byteLength(image, 'utf8');
    if (storedBytes > MAX_ITEM_IMAGE_BYTES) {
      throw new ItemImageValidationError('too_large');
    }

    seen.add(image);
    images.push(image);
  }

  return images;
}

/**
 * Returns the ordered image list for both new and legacy items. `cover_image` remains
 * the compatibility alias for the first image, so an importer or metadata refresh that
 * only knows the historical field still updates the image shown first everywhere.
 */
export function imagesForItem(item: any): string[] {
  return cleanImageList([
    item?.cover_image,
    ...(Array.isArray(item?.images) ? item.images : []),
    item?.user_image
  ]);
}

/**
 * Keeps the gallery in step when a metadata refresh replaces the main image.
 *
 * A refresh only ever writes `cover_image`, and imagesForItem() reads that before the
 * stored array, so without this the cover it replaced would slide into the gallery as a
 * second entry and be written there by the next save - one stale provider URL per
 * refresh, accumulating for as long as the item is refreshed. Substituting it in place
 * leaves the order, the length and every other image the owner chose untouched.
 *
 * Returns the value that was replaced, so a caller can release the file behind it when
 * it was a local upload nothing references any more.
 */
export function alignImagesAfterRefresh(item: any, update: Record<string, any>): string | null {
  const nextCover = update?.cover_image;
  if (typeof nextCover !== 'string' || !nextCover) return null;

  const previousCover = typeof item?.cover_image === 'string' ? item.cover_image.trim() : '';
  if (!previousCover || previousCover === nextCover) return null;

  // A legacy item carries no array to realign: its gallery is derived from cover_image
  // alone, so the refresh already says everything there is to say.
  const stored = Array.isArray(item?.images) ? item.images : null;
  if (!stored || !stored.includes(previousCover)) return null;

  update.images = stored.map((image: any) => (image === previousCover ? nextCover : image));
  return previousCover;
}

/** Parses the ordered list posted by the image manager, falling back to legacy fields. */
export function imagesFromForm(body: any): string[] {
  if (Object.prototype.hasOwnProperty.call(body || {}, 'images_json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.images_json || '[]');
    } catch {
      // A stale/custom client can still submit the two historical fields below.
    }
    if (Array.isArray(parsed)) return submittedImageList(parsed);
  }

  return submittedImageList([body?.cover_image, body?.user_image]);
}
