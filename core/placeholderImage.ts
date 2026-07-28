import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BASE_URL } from '../config/constants';

/**
 * Per-plugin default cover, shown wherever an item carries no image of its own.
 *
 * A plugin config accepts two shapes:
 *   - a remote URL (http/https), stored and served verbatim,
 *   - an uploaded image, stored as a base64 data URI.
 *
 * The config is the only source of truth: plugins/<id>/ is a regenerable cache and an
 * instance backup only dumps Mongo, so an uploaded image has to travel inside the config
 * to survive a container rebuild or a restore. Inlining that data URI in the pages would
 * repeat it on every card of a grid, so it is materialized into the plugin folder under a
 * content-hashed name and served by pluginAssetRoutes.
 */

/** Fallback used by every plugin that declares no default cover of its own. */
export const DEFAULT_PLACEHOLDER_IMAGE = '/ressources/logo.png';

/** Decoded size cap: the image rides along in the DB doc and in every backup. */
export const MAX_PLACEHOLDER_BYTES = 512 * 1024;

export const PLACEHOLDER_FILE_RE = /^placeholder-[a-f0-9]{12}\.(?:png|jpg|webp)$/;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

const DATA_URI_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const REMOTE_URL_RE = /^https?:\/\/\S+$/i;

export interface DecodedPlaceholder {
  buffer: Buffer;
  fileName: string;
}

export function isRemotePlaceholder(value: string): boolean {
  return REMOTE_URL_RE.test(value.trim());
}

/** Decodes an uploaded placeholder, or returns null when malformed, empty or oversized. */
export function decodePlaceholder(value: string): DecodedPlaceholder | null {
  const match = DATA_URI_RE.exec(value.trim());
  if (!match) return null;
  const ext = MIME_EXT[match[1]!];
  if (!ext) return null;

  const buffer = Buffer.from(match[2]!, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_PLACEHOLDER_BYTES) return null;

  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  return { buffer, fileName: `placeholder-${hash}.${ext}` };
}

/**
 * Normalizes a builder submission: returns the value to store, or '' when the image is
 * absent or unusable (the caller then simply omits the key and keeps the generic logo).
 */
export function sanitizePlaceholder(value: any): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (isRemotePlaceholder(raw)) return raw.slice(0, 2048);
  return decodePlaceholder(raw) ? raw : '';
}

/** Public URL for an <img src>, or '' when the plugin declares no usable default cover. */
export function placeholderUrl(pluginId: string, defaultCover?: string): string {
  if (!defaultCover) return '';
  if (isRemotePlaceholder(defaultCover)) return defaultCover.trim();
  const decoded = decodePlaceholder(defaultCover);
  return decoded ? `${BASE_URL}/plugin-assets/${pluginId}/${decoded.fileName}` : '';
}

/**
 * Writes the uploaded placeholder into the plugin folder and drops any previous one.
 * Beyond that cleanup it is a no-op for a remote URL or an unusable value.
 */
export function materializePlaceholder(dir: string, defaultCover?: string): void {
  const decoded = defaultCover && !isRemotePlaceholder(defaultCover) ? decodePlaceholder(defaultCover) : null;

  for (const entry of fs.readdirSync(dir)) {
    if (PLACEHOLDER_FILE_RE.test(entry) && entry !== decoded?.fileName) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }

  if (decoded) fs.writeFileSync(path.join(dir, decoded.fileName), decoded.buffer);
}
