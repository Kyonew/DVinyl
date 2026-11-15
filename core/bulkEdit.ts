import { FieldDefinition, PluginDefinition } from './types';

/**
 * Setting one field to the same value on every selected item of a collection.
 *
 * Generic over types: what can be set is read off each plugin's own form fields, plus
 * the fields an admin added to it. A selection spanning several types is offered the
 * fields they all have alike. Fields with a dedicated form of their own are left out:
 * the title and creator say which item it is, the location has its own "move" action,
 * a price carries its currency, and a field drawn by a partial has a shape this generic
 * editor cannot know.
 */

export const MAX_BULK_EDIT_SELECTION = 500;

const BULK_TYPES = new Set(['text', 'textarea', 'number', 'select', 'radio-cards', 'boolean', 'tags', 'date', 'rating']);
const NOT_BULK = new Set(['title', 'barcode', 'location', 'purchase_price', 'extra_formats', 'cover_image', 'user_image']);

export type TagsMode = 'add' | 'remove' | 'replace';

/** The fields of a plugin a selection can be given one value for. */
export function bulkFieldsOf(plugin: PluginDefinition): FieldDefinition[] {
  const identity = new Set([plugin.creatorField, plugin.externalIdField].filter(Boolean) as string[]);
  const seen = new Set<string>();
  return (plugin.formFields || []).filter(field => {
    if (seen.has(field.name)) return false;
    seen.add(field.name);
    return field.showIn.includes('edit')
      && BULK_TYPES.has(field.type)
      && !field.partial
      && !NOT_BULK.has(field.name)
      && !identity.has(field.name);
  });
}

function optionKey(field: FieldDefinition): string {
  return (field.options || []).map(o => String(o.value)).sort().join('\u0000');
}

/**
 * The fields every one of `plugins` has alike: same name, same type and, for a list,
 * the same choices. In the order of the first plugin's form.
 */
export function sharedBulkFields(plugins: PluginDefinition[]): FieldDefinition[] {
  if (plugins.length === 0) return [];
  const [first, ...rest] = plugins;
  const others = rest.map(p => new Map(bulkFieldsOf(p).map(f => [f.name, f])));
  return bulkFieldsOf(first!).filter(field => others.every(map => {
    const other = map.get(field.name);
    return !!other && other.type === field.type && optionKey(other) === optionKey(field)
      && !!other.extraField === !!field.extraField;
  }));
}

/** Where a field's value is stored on an item. */
export function storedPath(field: FieldDefinition): string {
  return field.extraField ? `extra.${field.name}` : field.name;
}

function splitTags(raw: any): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return [...new Set(list.map(s => String(s).trim()).filter(Boolean))];
}

export class BulkValueError extends Error {
  constructor(public code: 'required' | 'invalid') { super(code); }
}

/**
 * What the posted value turns into for the field, the same for every item: `null`
 * means the field is emptied. Tags are returned as the list to add, remove or put in
 * place, applied per item by tagsFor. Throws a BulkValueError for a value the field
 * cannot hold.
 */
export function bulkValueFor(field: FieldDefinition, raw: any): any {
  const text = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : String(raw).trim();
  const empty = (): null => {
    if (field.required) throw new BulkValueError('required');
    return null;
  };

  switch (field.type) {
    case 'boolean':
      return raw === true || text === 'true';
    case 'number':
    case 'rating': {
      if (!text) return empty();
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n)) throw new BulkValueError('invalid');
      return field.type === 'rating' ? Math.min(5, Math.max(0, n)) : n;
    }
    case 'date': {
      if (!text) return empty();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BulkValueError('invalid');
      const date = new Date(`${text}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) throw new BulkValueError('invalid');
      return date;
    }
    case 'select':
    case 'radio-cards': {
      if (!text) return empty();
      if (!(field.options || []).some(o => String(o.value) === text)) throw new BulkValueError('invalid');
      return text;
    }
    case 'tags':
      return splitTags(raw);
    default:
      if (!text) return empty();
      return text.slice(0, field.type === 'textarea' ? 20000 : 500);
  }
}

/** An item's tags once the selection's tags are added to, removed from or put in place of them. */
export function tagsFor(current: any, tags: string[], mode: TagsMode): string[] {
  const have = splitTags(current);
  if (mode === 'replace') return tags;
  if (mode === 'remove') {
    const gone = new Set(tags.map(t => t.toLowerCase()));
    return have.filter(t => !gone.has(t.toLowerCase()));
  }
  const known = new Set(have.map(t => t.toLowerCase()));
  return [...have, ...tags.filter(t => !known.has(t.toLowerCase()))];
}
