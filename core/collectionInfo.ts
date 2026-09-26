import { managedItemImageFile } from './itemImageStorage';

/**
 * The collection info page: a free-text presentation of the collection, written in
 * Markdown by a collection admin and read by its members and, when it is shared, by
 * whoever holds a share link.
 *
 * This file holds what the model, the admin form and the views all have to agree on:
 * the limits, what a stored page looks like once cleaned, and who gets to see it.
 * The page itself is rendered by core/routes/collectionInfoRoute.ts.
 */

export const MAX_COLLECTION_INFO_TITLE = 120;
export const MAX_COLLECTION_INFO_BODY = 20000;
export const MAX_COLLECTION_INFO_IMAGES = 6;

export interface CollectionInfo {
  enabled: boolean;
  shareVisible: boolean;
  title: string;
  body: string;
  images: string[];
  updated_at: Date | null;
}

export const EMPTY_COLLECTION_INFO: CollectionInfo = {
  enabled: false,
  shareVisible: true,
  title: '',
  body: '',
  images: [],
  updated_at: null
};

/** The info of a collection document, with every field present whatever it holds. */
export function collectionInfoOf(collection: any): CollectionInfo {
  const info = collection?.info || {};
  return {
    enabled: info.enabled === true,
    shareVisible: info.shareVisible !== false,
    title: typeof info.title === 'string' ? info.title : '',
    body: typeof info.body === 'string' ? info.body : '',
    images: normalizeInfoImages(info.images),
    updated_at: info.updated_at || null
  };
}

/**
 * Keeps the images this page may display: the instance's own uploads, and remote
 * addresses. Anything else (a data URL, a javascript: address, a path outside the
 * upload folder) is dropped rather than stored and handed to an <img> later.
 */
export function normalizeInfoImages(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const images: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const image = value.trim();
    if (!image || images.includes(image)) continue;
    if (!managedItemImageFile(image) && !/^https?:\/\/[^/\s]/i.test(image)) continue;
    images.push(image);
    if (images.length >= MAX_COLLECTION_INFO_IMAGES) break;
  }

  return images;
}

/** Reads the admin form into the shape stored on the collection. */
export function collectionInfoFromForm(body: any): Omit<CollectionInfo, 'updated_at'> {
  let images: unknown = [];
  try {
    images = JSON.parse(body?.images_json || '[]');
  } catch {
    // A malformed field leaves the page without images rather than failing the save.
  }

  return {
    enabled: body?.enabled === 'on' || body?.enabled === 'true',
    shareVisible: body?.shareVisible === 'on' || body?.shareVisible === 'true',
    title: String(body?.title || '').trim().slice(0, MAX_COLLECTION_INFO_TITLE),
    body: String(body?.body || '').slice(0, MAX_COLLECTION_INFO_BODY),
    images: normalizeInfoImages(images)
  };
}

/**
 * Reads an info page out of a backup dump, clamped to what the editor could have
 * written. A dump is a file somebody can hand us, so nothing in it is trusted further
 * than a form post would be.
 */
export function collectionInfoFromBackup(value: unknown): CollectionInfo {
  const info = collectionInfoOf({ info: value });
  const updated = info.updated_at ? new Date(info.updated_at) : null;
  return {
    ...info,
    title: info.title.trim().slice(0, MAX_COLLECTION_INFO_TITLE),
    body: info.body.slice(0, MAX_COLLECTION_INFO_BODY),
    updated_at: updated && !Number.isNaN(updated.getTime()) ? updated : null
  };
}

/** True once the page has something on it, whether words or pictures. */
export function hasCollectionInfoContent(info: CollectionInfo): boolean {
  return Boolean(info.title.trim() || info.body.trim() || info.images.length > 0);
}

/**
 * Whether this viewer should be offered the page at all. Used by the route that serves
 * it and by every entry point that links to it, so a hidden page is never linked to.
 */
export function isCollectionInfoVisible(collection: any, isShareView: boolean): boolean {
  const info = collectionInfoOf(collection);
  if (!info.enabled || !hasCollectionInfoContent(info)) return false;
  return isShareView ? info.shareVisible : true;
}
