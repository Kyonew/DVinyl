/**
 * Reading the errors a store throws, whatever database is behind it.
 */

/**
 * Whether a write was refused because another record already holds a value that must be
 * unique, optionally on that field.
 */
export function isDuplicateError(err: any, field?: string): boolean {
  if (err?.code !== 11000) return false;
  return field === undefined || !!err.keyPattern?.[field];
}

/** Whether a record was refused for not meeting its type's rules (a required field...). */
export function isValidationError(err: any): boolean {
  return err?.name === 'ValidationError';
}

/** The message key each failing field carries, as declared on the record type. */
export function validationMessages(err: any): Record<string, string> {
  if (!isValidationError(err)) return {};
  return Object.fromEntries(Object.entries(err.errors || {}).map(([field, e]: [string, any]) =>
    [e?.properties?.path ?? field, e?.properties?.message ?? e?.message]));
}
