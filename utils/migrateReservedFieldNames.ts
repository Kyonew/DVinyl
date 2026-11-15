import { db } from '../core/db';
import { all, and, eq, exists, idOf, isId } from '../core/db/query';
import { FIELD_NAME_RE, RESERVED_FIELD_NAMES } from '../core/customPluginStore';
import type { CustomPluginConfig } from '../core/customPlugin';

// Item paths the core took after no-code plugins could already name a field after them.
// Older reserved names are left alone: a field that carries one was grandfathered on
// purpose, and its values cannot be told apart from the core's. So is a purchase price:
// a plugin declaring one keeps it as the price of the copy (see core/registry.ts).
export const LATER_CORE_PATHS = new Set([
  'parent', 'inside', 'kept_fields', 'source_values', 'import_filled', 'extra_formats',
  'image_origins', 'image_download_failed', 'sort_creator', 'purchase_currency'
]);

// Paths that point at another item. A value there that is not an item id was typed into
// a builder field of the same name, and the core would read it as a link.
const LINK_PATHS = new Set(['inside', 'parent']);
// Paths only the field itself wrote to before 4.0, whose values therefore move with it.
// The core writes the currency of a purchase price on save from then on, so a field of
// that name would otherwise see its values replaced by the editor's currency.
const FIELD_ONLY_PATHS = new Set(['purchase_currency']);

/** A free name for `name` once it is taken by the core: `<name>_field`, then numbered. */
export function freeFieldName(name: string, taken: Set<string>): string {
  for (let attempt = 1; ; attempt++) {
    const suffix = attempt === 1 ? '_field' : `_field${attempt}`;
    const candidate = name.slice(0, 30 - suffix.length) + suffix;
    if (FIELD_NAME_RE.test(candidate) && !taken.has(candidate) && !RESERVED_FIELD_NAMES.has(candidate)) return candidate;
  }
}

/**
 * The field references of one type's display settings, with every renamed field under
 * its new name: the card fields, the corner, the table columns, the filters and the
 * placement on the item page.
 */
export function renameFieldReferences(cosmetics: any, renames: Map<string, string>): { cosmetics: any; changed: boolean } {
  if (!cosmetics || typeof cosmetics !== 'object' || renames.size === 0) return { cosmetics, changed: false };
  let changed = false;
  const next = { ...cosmetics };
  const renameList = (list: any) => Array.isArray(list)
    ? list.map((name: any) => {
      const to = typeof name === 'string' ? renames.get(name) : undefined;
      if (to) changed = true;
      return to || name;
    })
    : list;
  const renameKeys = (map: any) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(map)) {
      const to = renames.get(key);
      if (to) changed = true;
      out[to || key] = value;
    }
    return out;
  };
  if ('cardFields' in next) next.cardFields = renameList(next.cardFields);
  if ('tableColumns' in next) next.tableColumns = renameList(next.tableColumns);
  if (typeof next.cornerField === 'string' && renames.has(next.cornerField)) {
    next.cornerField = renames.get(next.cornerField);
    changed = true;
  }
  if ('filters' in next) next.filters = renameKeys(next.filters);
  if ('detailFields' in next) next.detailFields = renameKeys(next.detailFields);
  return { cosmetics: changed ? next : cosmetics, changed };
}

/**
 * A no-code plugin made before a core path existed may carry a field of that very name
 * (an "Inside" field, a "Parent" one). Both would then share one path on the
 * item, and the core would read the field as its own: an item whose "Inside" holds a
 * word reads as stored in a box and leaves the collection page.
 *
 * Each such field is renamed (`inside` becomes `inside_field`), its values move with it
 * and so do the settings that name it. Runs before the plugins are registered, at boot
 * and after an instance restore. Idempotent: a renamed field no longer collides.
 */
export async function migrateReservedFieldNames(): Promise<number> {
  let renamed = 0;
  const stored = await db.customPlugins.find(all());
  for (const doc of stored) {
    const config = doc?.config as CustomPluginConfig | undefined;
    if (!config?.id || !config.kind || !Array.isArray(config.fields)) continue;
    const taken = new Set(config.fields.map(field => field.name));
    const renames = new Map<string, string>();
    const fields = config.fields.map(field => {
      if (!LATER_CORE_PATHS.has(field.name)) return field;
      const to = freeFieldName(field.name, taken);
      taken.add(to);
      renames.set(field.name, to);
      return { ...field, name: to };
    });
    if (renames.size === 0) continue;

    // The values first, so a stop halfway leaves them where the next run looks.
    for (const [from, to] of renames) {
      // Only a link can be told apart from what a builder field put there. The other
      // paths have long held the core's own bookkeeping on every item, so the field is
      // renamed and starts empty rather than taking those values with it.
      if (!LINK_PATHS.has(from) && !FIELD_ONLY_PATHS.has(from)) {
        console.log(`[RESERVED FIELDS] "${config.id}": field "${from}" renamed to "${to}".`);
        continue;
      }
      const items = await db.items.find(and(eq('kind', config.kind), exists(from)), { fields: [from, 'kept_fields'] });
      let moved = 0;
      for (const item of items) {
        const value = item[from];
        if (LINK_PATHS.has(from) && isId(String(value ?? ''))) continue;
        const patch: any = { set: { [to]: value }, unset: [from] };
        if (Array.isArray(item.kept_fields) && item.kept_fields.includes(from)) {
          patch.set.kept_fields = item.kept_fields.map((name: string) => (name === from ? to : name));
        }
        await db.items.updateOne(eq('_id', idOf(item._id)), patch, { asStored: true });
        moved++;
      }
      console.log(`[RESERVED FIELDS] "${config.id}": field "${from}" renamed to "${to}", ${moved} value(s) moved.`);
    }

    for (const settings of await db.settings.find(all())) {
      const customization = settings.pluginCustomization || {};
      const { cosmetics, changed } = renameFieldReferences(customization[config.id], renames);
      if (!changed) continue;
      await db.settings.updateOne(
        eq('_id', idOf(settings._id)),
        { set: { pluginCustomization: { ...customization, [config.id]: cosmetics } } },
        { asStored: true }
      );
    }

    await db.customPlugins.updateOne(eq('id', config.id), { set: { config: { ...config, fields } } });
    renamed += renames.size;
  }
  return renamed;
}
