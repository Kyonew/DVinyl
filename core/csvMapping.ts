import { PluginDefinition, FieldDefinition } from './types';
import { getExtraFields, toFieldDefinitions } from './pluginExtraFields';
import { CsvRow } from './csvImport';

/**
 * User-driven CSV mapping: what the generic importer needs to turn an arbitrary export
 * into items of a given plugin, without a line of plugin-specific code.
 *
 * The plugin importers (Libib, Goodreads...) know their source format and hardcode the
 * mapping. Here the source format is unknown, so the two halves are split: this module
 * lists the destination fields a plugin exposes and coerces raw cells into their type,
 * while the user says which column feeds which field. The result is a mapRow function
 * of exactly the same shape as the hand-written ones, so runCsvImport is unchanged.
 */

/** One destination offered in the mapping screen. */
export interface ImportTargetField {
  name: string;
  label: string;
  /** Drives coercion and how the "fixed value" input renders. */
  type: FieldDefinition['type'];
  /** Values stored under item.extra[name] rather than on a schema path. */
  extraField?: boolean;
  /** The import refuses to run without it (title only, for now). */
  required?: boolean;
  /** For select-like fields: the accepted values, matched against the CSV cell. */
  options?: { value: string; label: string }[];
  /** Grouping in the mapping screen. */
  group: 'base' | 'plugin' | 'extra';
}

/** How one destination field is fed. */
export type FieldMapping =
  | { source: 'column'; column: string }
  | { source: 'const'; value: string };

export type ImportMapping = Record<string, FieldMapping>;

/** i18n namespace of the field labels the core owns (base fields and schema paths). */
const FIELD_KEY_PREFIX = 'admin.csv_import.field.';

/**
 * Fields every item carries whatever its plugin, in the order they read best in the
 * mapping screen. `in_wishlist` is deliberately absent: the destination list is picked
 * once for the whole file, not per row.
 */
const BASE_TARGET_FIELDS: ImportTargetField[] = [
  { name: 'title', label: `${FIELD_KEY_PREFIX}title`, type: 'text', required: true, group: 'base' },
  { name: 'cover_image', label: `${FIELD_KEY_PREFIX}cover_image`, type: 'text', group: 'base' },
  { name: 'year', label: `${FIELD_KEY_PREFIX}year`, type: 'text', group: 'base' },
  { name: 'genre', label: `${FIELD_KEY_PREFIX}genre`, type: 'text', group: 'base' },
  { name: 'genres', label: `${FIELD_KEY_PREFIX}genres`, type: 'tags', group: 'base' },
  { name: 'styles', label: `${FIELD_KEY_PREFIX}styles`, type: 'tags', group: 'base' },
  { name: 'barcode', label: `${FIELD_KEY_PREFIX}barcode`, type: 'text', group: 'base' },
  { name: 'location', label: `${FIELD_KEY_PREFIX}location`, type: 'text', group: 'base' },
  { name: 'quantity', label: `${FIELD_KEY_PREFIX}quantity`, type: 'number', group: 'base' },
  { name: 'comments', label: `${FIELD_KEY_PREFIX}comments`, type: 'textarea', group: 'base' },
  { name: 'added_at', label: `${FIELD_KEY_PREFIX}added_at`, type: 'date', group: 'base' }
];

// Editors backed by a dedicated widget (a tracklist, an image picker...) hold a
// structure no single CSV cell can express, so they are not offered as destinations.
const UNMAPPABLE_TYPES = new Set<FieldDefinition['type']>(['custom']);

/**
 * The import type of a schema path, or null when no single CSV cell can fill it.
 *
 * Structured paths (a tracklist, a list of objects) are the ones left out: they hold a
 * shape a spreadsheet cell cannot carry.
 */
function scalarType(def: any): FieldDefinition['type'] | null {
  const spec = def && typeof def === 'object' && !Array.isArray(def) && def.type !== undefined ? def.type : def;
  if (Array.isArray(spec)) return spec[0] === String ? 'tags' : null;
  if (spec === String) return 'text';
  if (spec === Number) return 'number';
  if (spec === Boolean) return 'boolean';
  if (spec === Date) return 'date';
  return null;
}

/**
 * Schema paths the plugin declares as required (books need an author, every custom
 * plugin needs a creator). Leaving one unmapped is not a detail the user can discover
 * on their own: Mongo rejects every single row and the import ends on "0 imported".
 */
function requiredPaths(plugin: PluginDefinition): Set<string> {
  const required = new Set<string>();
  for (const [name, def] of Object.entries(plugin.schemaDefinition || {})) {
    const spec: any = Array.isArray(def) ? def[0] : def;
    if (spec && typeof spec === 'object' && spec.required === true) required.add(name);
  }
  return required;
}

/** Resolver for the i18n keys carried by the field and option labels. */
export type Translate = (key: string, options?: any) => string;

/**
 * Every field of a plugin a CSV column may be mapped onto, for the active collection.
 *
 * Labels come out translated when a resolver is given (the mapping screen shows them,
 * and the select matching compares cells against them), and as raw keys otherwise.
 *
 * Accepts a raw plugin as well as one already decorated with its extra fields (the
 * views read the registry through that facade), hence the dedupe by name: a field seen
 * twice would render twice and let two columns fight over the same destination.
 */
export function importableFields(plugin: PluginDefinition, settings: any, t?: Translate): ImportTargetField[] {
  const fields: ImportTargetField[] = [];
  const seen = new Set<string>();

  // User-defined fields carry a label the user typed, not a key; defaultValue keeps it
  // as-is instead of echoing a miss. An untranslated schema path falls back to its bare
  // name rather than to the whole dotted key nobody wants to read.
  const label = (key: string) => {
    const fallback = key.startsWith(FIELD_KEY_PREFIX) ? key.slice(FIELD_KEY_PREFIX.length) : key;
    return t ? t(key, { defaultValue: fallback }) : fallback;
  };

  const push = (field: ImportTargetField) => {
    if (seen.has(field.name)) return;
    seen.add(field.name);
    const resolved: ImportTargetField = { ...field, label: label(field.label) };
    if (field.options) resolved.options = field.options.map(o => ({ value: o.value, label: label(o.label) }));
    fields.push(resolved);
  };

  for (const field of BASE_TARGET_FIELDS) push(field);

  const extraDefs = toFieldDefinitions(getExtraFields(settings, plugin.id));
  const extraNames = new Set(extraDefs.map(f => f.name));
  const required = requiredPaths(plugin);

  for (const field of [...(plugin.formFields || []), ...extraDefs]) {
    if (UNMAPPABLE_TYPES.has(field.type)) continue;
    // `manual-only` fields (a "did I lend it" checkbox) belong in an import too; only
    // the ones the API alone can fill are meaningless here.
    if (field.showCondition === 'api-only') continue;

    const isExtra = field.extraField === true || extraNames.has(field.name);
    const target: ImportTargetField = {
      name: field.name,
      label: field.label,
      type: field.type,
      extraField: isExtra,
      // A user-defined field lives in a schemaless bag, so nothing can reject a row
      // over it: only the plugin's own required paths block an import.
      required: !isExtra && required.has(field.name),
      group: isExtra ? 'extra' : 'plugin'
    };
    if (field.options) target.options = field.options.map(o => ({ value: o.value, label: o.label }));
    push(target);
  }

  // Schema paths with no form field of their own: a synopsis, an external id, a rating
  // the interface never asks for. An export routinely carries them, and leaving them out
  // would make the destination list depend on what the plugin chose to draw a form for
  // rather than on what it can actually store.
  for (const [name, def] of Object.entries(plugin.schemaDefinition || {})) {
    const type = scalarType(def);
    if (!type) continue;
    // Those paths have no label of their own. The common ones (a description, a source)
    // are translated like the base fields; anything else shows its raw path name, which
    // beats inventing a title for a field only the plugin author knows about.
    push({ name, label: `${FIELD_KEY_PREFIX}${name}`, type, required: required.has(name), group: 'plugin' });
  }

  return fields;
}

/** Comparable form of a header or a label: no case, no accents, no punctuation. */
function normalizeKey(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Pre-fills the mapping by matching column names against field names and labels, so
 * the user arrives on a screen that is mostly right and only fixes the leftovers.
 *
 * Exact matches only: a fuzzy guess that silently sends "publisher" into "published
 * year" costs more to spot and undo than an unmapped row costs to fill in. Labels are
 * translated by the caller (they are i18n keys here), which is what makes a French
 * export line up with a French interface.
 */
export function suggestMapping(columns: string[], fields: { name: string; label: string }[]): ImportMapping {
  const byKey = new Map<string, string>();
  for (const column of columns) {
    const key = normalizeKey(column);
    // First column wins: a later duplicate would steal a destination already filled.
    if (key && !byKey.has(key)) byKey.set(key, column);
  }

  const mapping: ImportMapping = {};
  const used = new Set<string>();

  for (const field of fields) {
    for (const candidate of [field.name, field.label]) {
      const column = byKey.get(normalizeKey(candidate));
      if (column && !used.has(column)) {
        mapping[field.name] = { source: 'column', column };
        used.add(column);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Machine spellings of a boolean, the ones a spreadsheet or an export writes whatever
 * the language it was produced in (Excel emits TRUE/FALSE, an API dump emits true/1).
 *
 * Written words are deliberately absent: a list of "oui/ja/si" would only ever cover
 * the languages someone thought of, and it would drift the day a locale is added.
 * They are resolved from the interface language instead, see booleanTokens().
 */
const TRUE_TOKENS = ['1', 'true', 'y', 'yes', 'x', 'on'];
const FALSE_TOKENS = ['0', 'false', 'n', 'no', 'off'];

/** The spellings of yes and no this instance accepts, in the language it speaks. */
function booleanTokens(t?: Translate): { truthy: Set<string>; falsy: Set<string> } {
  const truthy = new Set(TRUE_TOKENS);
  const falsy = new Set(FALSE_TOKENS);
  if (t) {
    truthy.add(normalizeKey(t('common.yes')));
    falsy.add(normalizeKey(t('common.no')));
  }
  truthy.delete('');
  falsy.delete('');
  return { truthy, falsy };
}

/** Splits a multi-value cell on any of the separators exports use for lists. */
function splitTags(raw: string): string[] {
  return raw.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Parses the date formats a spreadsheet actually exports.
 *
 * A slashed date whose two first parts are both under 13 is genuinely ambiguous and
 * nothing in the file resolves it, so day-first wins: it is the reading of most of the
 * languages this app ships. Anything unambiguous (a part above 12, an ISO date) is read
 * for what it is.
 */
function parseDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  const slashed = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (slashed) {
    const [, first, second, year] = slashed;
    // A first part above 12 can only be a day, which also rescues US exports.
    const day = Number(first) > 12 ? first : (Number(second) > 12 ? second : first);
    const month = day === first ? second : first;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    const parsed = new Date(iso);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  // Bare YYYY-MM-DD is read as UTC midnight, so the stored day never shifts with the
  // server timezone (same rule as the manual form).
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Matches a cell against the accepted values of a select, on the value or the label
 * ("Vinyle", "vinyl" and "VINYL" all land on `vinyl`).
 *
 * An unrecognized value yields undefined rather than the raw cell: the stored value
 * drives badges, filters and stats, so a stray "Vinyle 33T" would create a phantom
 * format nothing can render. Leaving the field empty keeps the item importable and
 * fixable from the interface.
 */
function matchOption(raw: string, options: { value: string; label: string }[]): string | undefined {
  const key = normalizeKey(raw);
  if (!key) return undefined;
  const hit = options.find(o => normalizeKey(o.value) === key || normalizeKey(o.label) === key);
  return hit ? hit.value : undefined;
}

/**
 * Turns one raw cell into the value its destination field expects. Returns undefined
 * when the cell carries nothing usable, so the field is left to its schema default
 * instead of being written as an empty string or a NaN.
 */
export function coerceValue(raw: string, field: ImportTargetField, booleans?: { truthy: Set<string>; falsy: Set<string> }): any {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return undefined;

  if (field.options && field.options.length > 0) return matchOption(value, field.options);

  switch (field.type) {
    case 'number':
    case 'rating': {
      // Decimal commas ("7,5") and thousands separators are what a localized
      // spreadsheet writes; the digits are the only part that matters here.
      const parsed = parseFloat(value.replace(/\s/g, '').replace(',', '.'));
      return isNaN(parsed) ? undefined : parsed;
    }
    case 'boolean': {
      const { truthy, falsy } = booleans || booleanTokens();
      const key = normalizeKey(value);
      if (truthy.has(key)) return true;
      if (falsy.has(key)) return false;
      return undefined;
    }
    case 'date':
      return parseDate(value) ?? undefined;
    case 'tags':
      return splitTags(value);
    default:
      return value;
  }
}

/**
 * Drops what a mapping submission cannot honour (unknown fields, columns absent from
 * the file, empty constants) and reports the required destinations left unfed, which
 * are the ones without which the import can only produce rejected rows.
 */
export function sanitizeMapping(raw: any, fields: ImportTargetField[], columns: string[]): {
  mapping: ImportMapping;
  missingRequired: string[];
} {
  const byName = new Map(fields.map(f => [f.name, f]));
  const known = new Set(columns);
  const mapping: ImportMapping = {};

  for (const [name, entry] of Object.entries(raw || {})) {
    if (!byName.has(name) || !entry || typeof entry !== 'object') continue;
    const { source, column, value } = entry as any;

    if (source === 'const') {
      const constant = typeof value === 'string' ? value.trim() : '';
      if (constant) mapping[name] = { source: 'const', value: constant };
    } else if (source === 'column' && typeof column === 'string' && known.has(column)) {
      mapping[name] = { source: 'column', column };
    }
  }

  const missingRequired = fields.filter(f => f.required && !mapping[f.name]).map(f => f.label);
  return { mapping, missingRequired };
}

/**
 * Builds the row mapper runCsvImport expects from a validated mapping. Values landing
 * on a user-defined field are collected under `extra`, exactly as the manual form does.
 */
export function buildMapRow(fields: ImportTargetField[], mapping: ImportMapping, t?: Translate): (row: CsvRow) => Record<string, any> | null {
  const entries = Object.entries(mapping)
    .map(([name, source]) => ({ field: fields.find(f => f.name === name)!, source }))
    .filter(e => !!e.field);

  // Resolved once for the whole file rather than per cell.
  const booleans = booleanTokens(t);

  return (row: CsvRow) => {
    const data: Record<string, any> = {};
    const extra: Record<string, any> = {};

    for (const { field, source } of entries) {
      const raw = source.source === 'const' ? source.value : (row[source.column] ?? '');
      const value = coerceValue(raw, field, booleans);
      if (value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;

      if (field.extraField) extra[field.name] = value;
      else data[field.name] = value;
    }

    // A row whose title column is empty carries no identity: runCsvImport skips it.
    if (!data.title) return null;

    if (Object.keys(extra).length > 0) data.extra = extra;
    return data;
  };
}
