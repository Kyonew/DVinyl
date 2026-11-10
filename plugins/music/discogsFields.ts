import { PluginDefinition } from '../../core/types';
import { ExtraFieldConfig, MAX_EXTRA_FIELDS_PER_PLUGIN, sanitizeExtraFields } from '../../core/pluginExtraFields';

/**
 * The fields a Discogs user fills in on the records of their collection (#224).
 *
 * Discogs answers with their definitions on one route and, on each release of the
 * collection, a `notes` list of { field_id, value } holding only what was filled in.
 * Two of its stock fields have a home in DVinyl already; every other one becomes a field
 * added to the music plugin, created the first time a record actually holds a value, so
 * a field nobody uses does not clutter the forms.
 */

export interface DiscogsField {
  id: number;
  name: string;
  type: string;
  options?: string[];
}

export interface DiscogsNote {
  field_id: number;
  value: unknown;
}

// Stable ids of the stock fields: the names can be changed by their owner.
const SLEEVE_CONDITION_ID = 2;
const NOTES_ID = 3;

const SLEEVE_GRADES: Record<string, string> = {
  'Mint (M)': 'M',
  'Near Mint (NM or M-)': 'NM',
  'Very Good Plus (VG+)': 'VG+',
  'Very Good (VG)': 'VG',
  'Good Plus (G+)': 'G+',
  'Good (G)': 'G',
  'Fair (F)': 'F',
  'Poor (P)': 'P',
  Generic: 'Generic'
};

const importKeyOf = (id: number): string => `discogs:${id}`;
const LINKABLE_TYPES = new Set(['text', 'textarea', 'select']);

/** Reads one collection's Discogs values into the fields they belong to. */
export class DiscogsFieldMapper {
  /** True once `defs` holds something the collection's settings do not have yet. */
  changed = false;
  /** Names of the fields that did not fit under the limit of added fields. */
  readonly leftOut = new Set<string>();
  defs: ExtraFieldConfig[];

  private readonly byId: Map<number, DiscogsField>;

  constructor(private readonly plugin: PluginDefinition, existing: ExtraFieldConfig[], fields: DiscogsField[]) {
    this.defs = [...existing];
    this.byId = new Map(fields.map(field => [field.id, field]));
  }

  /** The added field a Discogs field fills: found by its link, then by its name, else created. */
  private fieldFor(source: DiscogsField): ExtraFieldConfig | null {
    const key = importKeyOf(source.id);
    const linked = this.defs.find(def => def.importKey === key);
    if (linked) return linked;

    const wanted = source.name.trim().toLowerCase();
    const sameName = this.defs.find(def => !def.importKey && LINKABLE_TYPES.has(def.type) && def.label.trim().toLowerCase() === wanted);
    if (sameName) {
      this.defs = this.defs.map(def => (def === sameName ? { ...def, importKey: key } : def));
      this.changed = true;
      return this.defs.find(def => def.importKey === key)!;
    }

    if (this.defs.length >= MAX_EXTRA_FIELDS_PER_PLUGIN) {
      this.leftOut.add(source.name);
      return null;
    }
    const isList = source.type === 'dropdown' && (source.options || []).length > 0;
    return this.create(source, isList ? 'select' : 'textarea') || (isList ? this.create(source, 'textarea') : null);
  }

  private create(source: DiscogsField, type: 'select' | 'textarea'): ExtraFieldConfig | null {
    const draft = { label: source.name, type, group: 'metadata', ...(type === 'select' ? { options: source.options } : {}) };
    const { fields } = sanitizeExtraFields([...this.defs, draft], this.plugin, this.defs);
    if (fields.length !== this.defs.length + 1) return null;
    const added = { ...fields[fields.length - 1]!, importKey: importKeyOf(source.id) };
    this.defs = [...fields.slice(0, -1), added];
    this.changed = true;
    return added;
  }

  /** What one release's notes say, as item paths and the values to store there. */
  valuesFor(notes: DiscogsNote[] | undefined): Record<string, any> {
    const values: Record<string, any> = {};
    for (const note of notes || []) {
      const value = typeof note?.value === 'string' ? note.value.trim() : '';
      if (!value) continue;
      if (note.field_id === SLEEVE_CONDITION_ID) {
        // A grade DVinyl has no entry for ("No Cover") is kept as written: the form shows it.
        values.sleeve_condition = SLEEVE_GRADES[value] || value;
      } else if (note.field_id === NOTES_ID) {
        values.comments = value;
      } else {
        const source = this.byId.get(note.field_id);
        const field = source && this.fieldFor(source);
        if (!field) continue;
        const option = (field.options || []).find(o => o.label === value);
        values[`extra.${field.name}`] = option ? option.value : value;
      }
    }
    return values;
  }
}

/** What a release says beyond its custom fields: Discogs writes 0 for a record nobody rated. */
export function ratingValues(rating: unknown): Record<string, any> {
  const stars = Number(rating);
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? { user_rating: stars } : {};
}

/** When a record entered the collection on Discogs, or now when it does not say. */
export function addedDate(dateAdded: unknown): Date {
  const date = typeof dateAdded === 'string' ? new Date(dateAdded) : null;
  return date && !Number.isNaN(date.getTime()) ? date : new Date();
}

/**
 * The values to write on an item already in DVinyl, whichever way it got there: what
 * someone wrote is never replaced, and what an earlier import already brought is not
 * brought again, so a value emptied on purpose stays empty.
 */
export function missingValues(item: any, values: Record<string, any>): Record<string, any> {
  const filled = new Set<string>(Array.isArray(item?.import_filled) ? item.import_filled : []);
  const missing: Record<string, any> = {};
  for (const [path, value] of Object.entries(values)) {
    if (filled.has(path)) continue;
    const current = path.startsWith('extra.') ? item?.extra?.[path.slice('extra.'.length)] : item?.[path];
    if (current === undefined || current === null || current === '' || current === 0) missing[path] = value;
  }
  if (Object.keys(missing).length > 0) missing.import_filled = [...filled, ...Object.keys(missing)];
  return missing;
}

/** The same values in the shape a new item is created with. */
export function asNewItemFields(values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const extra: Record<string, any> = {};
  for (const [path, value] of Object.entries(values)) {
    if (path.startsWith('extra.')) extra[path.slice('extra.'.length)] = value;
    else out[path] = value;
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  if (Object.keys(values).length > 0) out.import_filled = Object.keys(values);
  return out;
}
