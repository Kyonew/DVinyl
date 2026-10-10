/**
 * Photos sent to a vision model arrive as data URIs the browser has already downscaled
 * (a few hundred kB). The cap only stops a hand-made request from posting a huge one.
 */
const MAX_IMAGE_CHARS = 4_000_000;

export function isAcceptedImage(entry: unknown): entry is string {
  return typeof entry === 'string'
    && /^data:image\/(jpeg|png|webp);base64,/.test(entry)
    && entry.length <= MAX_IMAGE_CHARS;
}
