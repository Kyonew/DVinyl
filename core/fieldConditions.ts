/**
 * Fields shown only for some values of another field (FieldDefinition.showWhen): a
 * console has a manufacturer and a serial number, a game a developer and a play status.
 * Read the same way by the forms, which follow the field as it changes, and by the
 * item page, which shows what applies to the item as it is.
 */
import type { FieldDefinition } from './types';

/** Whether `field` applies to `item` as it stands. A field with no condition always does. */
export function fieldShownFor(field: Pick<FieldDefinition, 'showWhen'>, item: any): boolean {
  const when = field.showWhen;
  if (!when || !when.field || !Array.isArray(when.values)) return true;
  const raw = item?.[when.field];
  const value = raw === undefined || raw === null ? '' : String(raw);
  return when.values.includes(value);
}
