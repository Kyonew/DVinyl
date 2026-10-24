/**
 * Record ids as the core handles them: 24 hexadecimal characters, the format every
 * existing backup, link and list entry already carries. Any storage keeps that format so
 * those keep pointing at the same records.
 */

const ID_RE = /^[0-9a-f]{24}$/i;

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

/** The id of a record or of a reference, as text, whatever object the storage hands back. */
export function idOf(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value._id ?? value);
}
