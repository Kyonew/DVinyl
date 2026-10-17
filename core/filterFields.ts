import { PluginDefinition } from './types';
import { RESERVED_FIELD_NAMES } from './customPluginStore';
import { ExtraFieldConfig, FilterableField, isFilterable } from './pluginExtraFields';

/**
 * Which filters the collection page offers once a type is selected.
 *
 * Three sources feed the filter bar: the core's own controls (decade, genre, style,
 * platform, creator), the plugin's own fields that have a fixed set of values (a
 * reading status, a boxset flag), and the collection's user-defined fields. A
 * collection may switch any of them on or off per plugin in
 * settings.pluginCustomization[pluginId].filters, a map of filter id to boolean.
 *
 * Only deviations from the default are stored, so a key that is absent keeps the
 * filter where it always was: core controls and user-defined fields on, the plugin's
 * own fields off. A field declared later therefore shows up on its own, as it did
 * before this setting existed.
 *
 * The page showing every type at once is left alone: its filters span all plugins,
 * so no single plugin's choice applies to them.
 */

export type FilterSource = 'core' | 'native' | 'extra';

export interface FilterCandidate {
  id: string;
  label: string;
  source: FilterSource;
  defaultOn: boolean;
  // The field behind a native or user-defined filter, ready for the query builder.
  field?: FilterableField;
}

// Namespaced, so a plugin field that happens to be called "style" or "decade" cannot
// be mistaken for the core control.
const CORE_PREFIX = 'core:';

export const CORE_FILTER_IDS = {
  decade: `${CORE_PREFIX}decade`,
  genre: `${CORE_PREFIX}genre`,
  style: `${CORE_PREFIX}style`,
  platform: `${CORE_PREFIX}platform`,
  creator: `${CORE_PREFIX}creator`
} as const;

// Types a plugin's own field may be filtered on: those whose values are known up
// front, so the control is a short list rather than everything ever typed.
const NATIVE_FILTER_TYPES = new Set(['select', 'boolean']);

// Plugin fields already covered by a core control (the format chips, the platform
// menu), which a second control would only duplicate.
const CORE_COVERED_FIELDS = new Set(['platform']);

function nativeFilterFields(plugin: PluginDefinition): FilterableField[] {
  const schema: any = plugin.schemaDefinition || {};
  const out: FilterableField[] = [];
  for (const f of plugin.formFields || []) {
    if (f.extraField || !NATIVE_FILTER_TYPES.has(f.type)) continue;
    if (RESERVED_FIELD_NAMES.has(f.name) || CORE_COVERED_FIELDS.has(f.name)) continue;
    if (f.name === plugin.creatorField || f.name === plugin.externalIdField) continue;
    if (f.type === 'select' && !(f.options || []).some(o => o.value !== '')) continue;
    out.push({
      name: f.name,
      label: f.label,
      type: f.type as 'select' | 'boolean',
      options: (f.options || []).filter(o => o.value !== '').map(o => ({ value: o.value, label: o.label })),
      // What an item without a stored value is shown as (a book nobody marked is "to
      // read"), so the filter can count those items under it too.
      default: schema[f.name]?.default ?? f.default,
      native: true
    });
  }
  return out;
}

/**
 * Every filter a plugin could show, in the order the bar lays them out. `plugin` must
 * be the bare registry entry: the decorated one already lists the user-defined fields
 * among its own, and they come in through `extraDefs` instead.
 */
export function filterCandidates(plugin: PluginDefinition, extraDefs: ExtraFieldConfig[]): FilterCandidate[] {
  const schema: any = plugin.schemaDefinition || {};
  const creatorDef = (plugin.formFields || []).find(f => f.name === plugin.creatorField);

  const out: FilterCandidate[] = [
    { id: CORE_FILTER_IDS.decade, label: 'collection.decade_filter', source: 'core', defaultOn: true },
    { id: CORE_FILTER_IDS.genre, label: 'confirm_vinyl.field_genres', source: 'core', defaultOn: true }
  ];
  if (schema.styles) {
    out.push({ id: CORE_FILTER_IDS.style, label: 'collection.styles_filter', source: 'core', defaultOn: true });
  }
  if (schema.platform) {
    out.push({ id: CORE_FILTER_IDS.platform, label: 'collection.platform_filter', source: 'core', defaultOn: true });
  }
  out.push({
    id: CORE_FILTER_IDS.creator,
    label: creatorDef?.label || 'collection.artist_filter',
    source: 'core',
    defaultOn: true
  });

  for (const field of nativeFilterFields(plugin)) {
    out.push({ id: field.name, label: field.label, source: 'native', defaultOn: false, field });
  }
  for (const field of extraDefs.filter(isFilterable)) {
    out.push({ id: field.name, label: field.label, source: 'extra', defaultOn: true, field });
  }
  return out;
}

/** The stored on/off map for a plugin, or an empty one. */
export function filterOverrides(customization: any, pluginId: string): Record<string, boolean> {
  const map = customization?.[pluginId]?.filters;
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/** Candidates the collection keeps on for this plugin. */
export function activeFilters(candidates: FilterCandidate[], overrides: Record<string, boolean>): FilterCandidate[] {
  return candidates.filter(c => (typeof overrides[c.id] === 'boolean' ? overrides[c.id] : c.defaultOn));
}

/**
 * The map to store from a submission listing the ids left on. Checked against the
 * plugin's own candidates, so a crafted payload cannot name an arbitrary path, and
 * reduced to what differs from the default.
 */
export function sanitizeFilterSelection(candidates: FilterCandidate[], enabledIds: unknown[]): Record<string, boolean> {
  const enabled = new Set(enabledIds.filter(id => typeof id === 'string'));
  const out: Record<string, boolean> = {};
  for (const c of candidates) {
    const on = enabled.has(c.id);
    if (on !== c.defaultOn) out[c.id] = on;
  }
  return out;
}
