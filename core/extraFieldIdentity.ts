import { createHash, randomBytes } from 'crypto';

/**
 * Technical namespace reserved for per-collection fields.
 *
 * Labels remain user-facing and editable. These keys are deliberately opaque so a
 * future plugin field derived from ordinary vocabulary cannot accidentally claim one.
 */
export const EXTRA_FIELD_PREFIX = 'custom_';
export const EXTRA_FIELD_KEY_VERSION = 1 as const;
export const EXTRA_FIELD_KEY_RE = /^custom_[a-f0-9]{12}$/;

export function isManagedExtraFieldKey(name: unknown, version: unknown): boolean {
  return version === EXTRA_FIELD_KEY_VERSION
    && typeof name === 'string'
    && EXTRA_FIELD_KEY_RE.test(name);
}

/** New fields get an unpredictable identity which never depends on their label. */
export function createExtraFieldKey(unavailable: Set<string> = new Set()): string {
  let key: string;
  do {
    key = `${EXTRA_FIELD_PREFIX}${randomBytes(6).toString('hex')}`;
  } while (unavailable.has(key));
  return key;
}

/**
 * Legacy migrations need a repeatable identity: if a process stops after copying
 * values but before updating Settings, the next run must choose the same target.
 */
export function migratedExtraFieldKey(
  settingsId: string,
  pluginId: string,
  oldName: string,
  ordinal: number,
  attempt = 0
): string {
  const digest = createHash('sha256')
    .update(`${settingsId}\0${pluginId}\0${oldName}\0${ordinal}\0${attempt}`)
    .digest('hex')
    .slice(0, 12);
  return `${EXTRA_FIELD_PREFIX}${digest}`;
}
