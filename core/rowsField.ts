import { FieldDefinition } from './types';

/**
 * A field that repeats: a list of rows sharing the same columns, such as a record's
 * runout inscriptions, one row per side ("A", "781 768-1 A Alsdorf", "Sterling").
 *
 * Every column holds text. The field is declared by a plugin with `columns`, or by a
 * collection as a custom field whose options are the column names. Values are stored as
 * a list of plain objects keyed by column name, and posted by the form as JSON under
 * `<name>_json`, the way the tracklist editor posts its own.
 */

export interface RowColumn {
  name: string;
  label: string;
}

export const MAX_ROWS = 100;
export const MAX_COLUMNS = 8;
const MAX_CELL = 500;

/** The columns of a rows field, whichever way it was declared. */
export function rowColumns(field: Pick<FieldDefinition, 'columns' | 'options'>): RowColumn[] {
  if (Array.isArray(field.columns) && field.columns.length > 0) return field.columns.slice(0, MAX_COLUMNS);
  return (field.options || [])
    .filter(o => o.value !== '')
    .slice(0, MAX_COLUMNS)
    .map(o => ({ name: o.value, label: o.label }));
}

/**
 * What a form posted, reduced to the declared columns: text only, trimmed and bounded,
 * rows left entirely empty dropped. Anything unreadable is no rows rather than an error,
 * so a broken script never costs the rest of the save.
 */
export function parseRows(raw: unknown, columns: RowColumn[]): Record<string, string>[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const rows: Record<string, string>[] = [];
  for (const entry of list.slice(0, MAX_ROWS)) {
    if (!entry || typeof entry !== 'object') continue;
    const row: Record<string, string> = {};
    let filled = false;
    for (const column of columns) {
      const value = String((entry as any)[column.name] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_CELL);
      row[column.name] = value;
      if (value) filled = true;
    }
    if (filled) rows.push(row);
  }
  return rows;
}

/** Whether a value holds at least one row worth showing. */
export function hasRows(value: unknown): boolean {
  return Array.isArray(value) && value.some(row => row && typeof row === 'object' && Object.values(row).some(v => String(v ?? '').trim()));
}
