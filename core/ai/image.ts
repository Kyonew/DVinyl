/**
 * Shared validation for an image the browser has already downscaled and re-encoded into a
 * data URL before sending it to the server (see downscaleImage() in ai-review.ejs and
 * add.ejs) — used by every AI-assist path that accepts a photo (bulk photo import,
 * card-scan).
 */

/** A downscaled photo comes back as a few hundred kB; this is a generous ceiling against
 * a caller sending something unexpectedly large, not a target size. */
export const MAX_IMAGE_CHARS = 4_000_000;

const IMAGE_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,/;

export function isValidImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_DATA_URL_RE.test(value) && value.length <= MAX_IMAGE_CHARS;
}
