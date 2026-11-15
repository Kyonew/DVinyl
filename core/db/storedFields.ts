/**
 * What a plugin's items store on top of the fields every item has, declared without
 * reference to any database. The storage layer turns this into whatever it needs
 * (a schema, casts, defaults, validation); plugins and the core only ever read it.
 */

/**
 * - `text`, `number`, `boolean`, `date`: one value.
 * - `texts`: a list of texts (genres, tags).
 * - `records`: a list of small records with fields of their own (a tracklist, the
 *   episodes of a season). Each record gets an id of its own, which is what a list
 *   entry or a personal note attaches to.
 */
export type StoredFieldType = 'text' | 'number' | 'boolean' | 'date' | 'texts' | 'records';

export interface StoredField {
  type: StoredFieldType;
  /** An item cannot be saved without it. */
  required?: boolean;
  /** What an item reads as when it holds no value of its own. */
  default?: string | number | boolean | string[];
  /** The only values a `text` field accepts. */
  values?: string[];
  /** Bounds of a `number` field. */
  min?: number;
  max?: number;
  /** The fields of each record of a `records` field. */
  fields?: StoredFields;
}

export type StoredFields = Record<string, StoredField>;

export function storedField(plugin: { storedFields?: StoredFields }, name: string): StoredField | undefined {
  return Object.prototype.hasOwnProperty.call(plugin.storedFields || {}, name)
    ? plugin.storedFields![name]
    : undefined;
}

export function storedFieldNames(plugin: { storedFields?: StoredFields }): string[] {
  return Object.keys(plugin.storedFields || {});
}
