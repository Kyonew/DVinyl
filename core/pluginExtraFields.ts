import { PluginDefinition, FieldDefinition } from './types';
import { CustomFieldConfig } from './customPlugin';
import { RESERVED_FIELD_NAMES, FIELD_NAME_RE, FIELD_TYPES, cleanText, slugify } from './customPluginStore';

/**
 * Per-collection user-defined fields added on top of a plugin's own fields, for
 * native (music, lego...) and custom plugins alike. Definitions live in
 * settings.pluginExtraFields[pluginId]; values live in item.extra[name].
 *
 * Why a schemaless bag rather than real schema paths: the definitions are scoped to
 * a collection, while Mongoose discriminators are process-wide. A typed path could
 * not express "Music has a loaned_to field in collection A but not in collection B",
 * and re-registering a discriminator whenever someone edits a field is the riskiest
 * operation in the codebase. The bag decouples the two entirely.
 *
 * Backups need no special handling: values ride inside the item documents (dumped
 * raw) and definitions ride inside the Settings documents.
 */

export type ExtraFieldConfig = CustomFieldConfig;

export const MAX_EXTRA_FIELDS_PER_PLUGIN = 15;

export type ExtraFieldMap = Record<string, ExtraFieldConfig[]>;

/** Definitions declared for a plugin in the active collection's settings. */
export function getExtraFields(settings: any, pluginId: string): ExtraFieldConfig[] {
  const list = settings?.pluginExtraFields?.[pluginId];
  return Array.isArray(list) ? list : [];
}

/**
 * Names a plugin already uses. An extra field may not shadow one of them: values are
 * flattened onto the view model, so a duplicate would hide the real path.
 */
export function reservedNamesFor(plugin: PluginDefinition): Set<string> {
  const taken = new Set<string>(RESERVED_FIELD_NAMES);
  for (const key of Object.keys(plugin.schemaDefinition || {})) taken.add(key);
  for (const f of plugin.formFields || []) taken.add(f.name);
  if (plugin.creatorField) taken.add(plugin.creatorField);
  if (plugin.externalIdField) taken.add(plugin.externalIdField);
  return taken;
}

/** Turns stored definitions into form fields the generic views already know how to render. */
export function toFieldDefinitions(defs: ExtraFieldConfig[]): FieldDefinition[] {
  return defs.map(f => {
    const field: FieldDefinition = {
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required === true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: (f.group || 'metadata') === 'main' ? 'main' : 'metadata',
      extraField: true
    };
    if (f.placeholder) field.placeholder = f.placeholder;
    if (f.type === 'select') field.options = f.options || [];
    return field;
  });
}

/** Definitions + ready-to-render form fields for a plugin, in one call. */
export function extraFieldsFor(settings: any, plugin: PluginDefinition): {
  defs: ExtraFieldConfig[];
  fields: FieldDefinition[];
} {
  const defs = getExtraFields(settings, plugin.id);
  return { defs, fields: toFieldDefinitions(defs) };
}

// Textareas are excluded from filtering: a free-form paragraph is never a useful
// filter criterion and would only clutter the panel.
const FILTERABLE_TYPES = new Set(['text', 'number', 'select', 'boolean', 'tags', 'date']);

// Filters rendered as a value picker rather than a range
const PICKER_TYPES = new Set(['text', 'select', 'tags']);

// Sentinels offered on top of the stored values of a picker filter. Prefixed and
// suffixed so they cannot collide with a real value a user typed in.
export const EXTRA_ANY = '__any__';
export const EXTRA_NONE = '__none__';

export function isFilterable(field: ExtraFieldConfig): boolean {
  return FILTERABLE_TYPES.has(field.type);
}

export function isRangeFilter(field: ExtraFieldConfig): boolean {
  return field.type === 'date' || field.type === 'number';
}

export function isPickerFilter(field: ExtraFieldConfig): boolean {
  return PICKER_TYPES.has(field.type);
}

/** Query param carrying this field's filter value. */
export function filterParam(field: ExtraFieldConfig, bound?: 'from' | 'to'): string {
  return bound ? `xf_${field.name}_${bound}` : `xf_${field.name}`;
}

function parseDateBound(raw: any, endOfDay: boolean): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const value = new Date(`${raw.trim()}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return isNaN(value.getTime()) ? null : value;
}

/**
 * Mongo conditions for the user-defined filters present in a query string. Field
 * names come from the settings and were validated against FIELD_NAME_RE on the way
 * in, so interpolating them into a dotted path is safe.
 */
export function buildExtraFieldConditions(defs: ExtraFieldConfig[], query: any): any[] {
  const conditions: any[] = [];

  for (const field of defs) {
    if (!isFilterable(field)) continue;
    const path = `extra.${field.name}`;

    if (isRangeFilter(field)) {
      const rawFrom = query[filterParam(field, 'from')];
      const rawTo = query[filterParam(field, 'to')];
      const range: any = {};

      if (field.type === 'date') {
        // The upper bound covers the whole day, so "until the 15th" includes the 15th
        const from = parseDateBound(rawFrom, false);
        const to = parseDateBound(rawTo, true);
        if (from) range.$gte = from;
        if (to) range.$lte = to;
      } else {
        const from = Number(rawFrom);
        const to = Number(rawTo);
        if (rawFrom !== undefined && rawFrom !== '' && !isNaN(from)) range.$gte = from;
        if (rawTo !== undefined && rawTo !== '' && !isNaN(to)) range.$lte = to;
      }

      if (Object.keys(range).length > 0) conditions.push({ [path]: range });
      continue;
    }

    const raw = query[filterParam(field)];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;

    if (value === EXTRA_ANY) {
      // "Filled in". A missing key matches null in Mongo, so $nin covers both the
      // items predating the field and the empty strings an emptied input leaves behind.
      conditions.push({ [path]: { $nin: [null, '', []] } });
      continue;
    }
    if (value === EXTRA_NONE) {
      conditions.push({ [path]: { $in: [null, '', []] } });
      continue;
    }

    if (field.type === 'boolean') {
      // Items predating the field have no key at all, so "no" is "not true" rather
      // than an equality test on false.
      conditions.push(value === 'true' ? { [path]: true } : { [path]: { $ne: true } });
    } else {
      // text, select and tags alike: the values offered are the ones actually stored,
      // and an equality test on an array path matches "contains" for tags.
      conditions.push({ [path]: value });
    }
  }

  return conditions;
}

// Sort keys for user-defined fields are namespaced so they can never collide with a
// built-in key (added, title, year, artist) or with each other.
const SORT_PREFIX = 'xf:';

export function extraSortKey(field: ExtraFieldConfig): string {
  return `${SORT_PREFIX}${field.name}`;
}

/** Mongo sort object when `sort` targets a user-defined field, null otherwise. */
export function parseExtraSort(sort: string | undefined, defs: ExtraFieldConfig[]): Record<string, 1 | -1> | null {
  if (typeof sort !== 'string' || !sort.startsWith(SORT_PREFIX)) return null;
  const match = sort.match(/^(.*)_(asc|desc)$/);
  if (!match) return null;
  const name = match[1]!.slice(SORT_PREFIX.length);
  if (!defs.some(f => f.name === name)) return null;
  return { [`extra.${name}`]: match[2] === 'asc' ? 1 : -1 };
}

/**
 * Names declared as a date field somewhere in the given Settings documents, minus any
 * name that is declared with another type elsewhere. Used by the backup restore: JSON
 * has no date type, and item.extra is a Mixed path, so nothing casts those values back
 * on the way in and they would land as strings while fresh saves store real Dates.
 * Mixed types on one path break range queries, so the restore revives them.
 */
export function collectExtraDateFields(settingsDocs: any[]): Set<string> {
  const dates = new Set<string>();
  const others = new Set<string>();
  for (const doc of settingsDocs || []) {
    const map: ExtraFieldMap = doc?.pluginExtraFields || {};
    for (const list of Object.values(map)) {
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (!f?.name) continue;
        (f.type === 'date' ? dates : others).add(f.name);
      }
    }
  }
  for (const name of others) dates.delete(name);
  return dates;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** In-place revival of the date-typed values of one item's extra bag. */
export function reviveExtraDates(item: any, dateFields: Set<string>): void {
  const extra = item?.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra) || dateFields.size === 0) return;
  for (const name of dateFields) {
    const value = extra[name];
    if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) continue;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) extra[name] = parsed;
  }
}

/**
 * Validates a builder submission for one plugin. Returns the fields to persist, or
 * the i18n keys of what went wrong. Mirrors the custom-plugin field rules so both
 * editors accept exactly the same shapes.
 */
export function sanitizeExtraFields(raw: any, plugin: PluginDefinition): { fields: ExtraFieldConfig[]; errors: string[] } {
  const errors: string[] = [];
  const fields: ExtraFieldConfig[] = [];
  const taken = reservedNamesFor(plugin);
  const seen = new Set<string>();

  for (const item of Array.isArray(raw) ? raw.slice(0, MAX_EXTRA_FIELDS_PER_PLUGIN) : []) {
    const label = cleanText(item?.label, 40);
    if (!label) continue; // ignore empty builder rows

    // An existing field keeps its stored name so renaming its label never orphans
    // the values already saved under the old key.
    const submitted = cleanText(item?.name, 30);
    const name = FIELD_NAME_RE.test(submitted) ? submitted : slugify(label).replace(/-/g, '_');
    if (!FIELD_NAME_RE.test(name)) { errors.push('create_plugin.err_bad_field_name'); continue; }
    if (taken.has(name)) { errors.push('create_plugin.err_reserved_field'); continue; }
    if (seen.has(name)) { errors.push('create_plugin.err_duplicate_field'); continue; }
    seen.add(name);

    const type = FIELD_TYPES.has(item?.type) ? item.type : 'text';
    const field: ExtraFieldConfig = {
      name,
      label,
      type,
      required: item?.required === true || item?.required === 'true',
      group: item?.group === 'main' ? 'main' : 'metadata'
    };

    const placeholder = cleanText(item?.placeholder, 60);
    if (placeholder) field.placeholder = placeholder;

    if (type === 'select') {
      const options = (Array.isArray(item?.options) ? item.options.slice(0, 20) : [])
        .map((o: any) => {
          const optLabel = cleanText(typeof o === 'string' ? o : o?.label, 40);
          const optValue = slugify(cleanText(typeof o === 'string' ? o : (o?.value || o?.label), 40)).replace(/-/g, '_');
          return optLabel && optValue ? { value: optValue, label: optLabel } : null;
        })
        .filter(Boolean) as { value: string; label: string }[];
      if (options.length === 0) { errors.push('create_plugin.err_select_needs_options'); continue; }
      field.options = options;
    }

    fields.push(field);
  }

  return { fields, errors: [...new Set(errors)] };
}
