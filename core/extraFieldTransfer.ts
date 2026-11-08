/**
 * Moving the values of a collection's own field into the plugin's field that now does
 * the same job (#151): a "Playtime" added by hand before the plugin shipped its own.
 *
 * Nothing is overwritten. An item whose plugin field is empty takes the value; one that
 * already holds the same value only loses the duplicate; one that holds another value,
 * or a value the plugin field cannot take (a word in a number field, an option it does
 * not offer), keeps both untouched and is counted, so the admin sees what is left. The
 * collection's field goes away only once nothing is left in it.
 */
import { db } from './db';
import { and, eq, filled } from './db/filter';
import { idOf } from './db/ids';
import type { FieldDefinition, PluginDefinition } from './types';
import { getExtraFields, type ExtraFieldConfig } from './pluginExtraFields';

const isEmpty = (value: any) => value === undefined || value === null || value === ''
  || (Array.isArray(value) && value.length === 0);

const words = (value: any): string[] => (Array.isArray(value) ? value : String(value ?? '').split(','))
  .map(v => String(v ?? '').trim())
  .filter(Boolean);

/** An option of `options` named by its value or by its label, whatever the case. */
function optionFor(options: { value: string; label: string }[] | undefined, text: string): string | null {
  const wanted = text.trim().toLowerCase();
  const hit = (options || []).find(o => String(o.value).toLowerCase() === wanted || String(o.label).toLowerCase() === wanted);
  return hit ? hit.value : null;
}

/**
 * The custom value as the plugin field stores it, or `ok: false` when it cannot take
 * it. A select of the collection's field is read through its label, since the two
 * lists were never meant to share values.
 */
export function convertForNative(value: any, def: ExtraFieldConfig, native: FieldDefinition, t: (key: string) => string = k => k): { ok: boolean; value?: any } {
  if (isEmpty(value)) return { ok: false };
  const asText = def.type === 'select'
    ? (def.options || []).find(o => o.value === value)?.label ?? String(value)
    : value;

  switch (native.type) {
    case 'number':
    case 'rating': {
      const n = typeof asText === 'number' ? asText : Number(String(asText).replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'boolean':
      return typeof asText === 'boolean' ? { ok: true, value: asText } : { ok: false };
    case 'date': {
      const d = asText instanceof Date ? asText : new Date(String(asText));
      return isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d };
    }
    case 'tags': {
      const list = words(asText);
      return list.length > 0 ? { ok: true, value: list } : { ok: false };
    }
    case 'select':
    case 'radio-cards': {
      // Matched on the option's value or on how it reads, in any language offered.
      const hit = optionFor((native.options || []).filter(o => o.value !== '').map(o => ({ value: o.value, label: t(o.label) })), String(asText))
        ?? optionFor(native.options, String(asText));
      return hit ? { ok: true, value: hit } : { ok: false };
    }
    case 'text':
    case 'textarea':
      if (Array.isArray(asText)) return { ok: true, value: asText.join(', ') };
      if (typeof asText === 'boolean' || asText instanceof Date || typeof asText === 'object') return { ok: false };
      return { ok: true, value: String(asText) };
    default:
      return { ok: false };
  }
}

function sameValue(a: any, b: any): boolean {
  const norm = (v: any) => Array.isArray(v) ? v.map(x => String(x).trim().toLowerCase()).sort().join('|')
    : v instanceof Date ? v.toISOString().slice(0, 10)
      : String(v ?? '').trim().toLowerCase();
  return norm(a) === norm(b);
}

export interface TransferPlan {
  /** Items holding a value in the collection's field. */
  withValue: number;
  /** The plugin field is empty: the value moves. */
  move: { id: any; value: any }[];
  /** The plugin field already says the same: only the duplicate goes. */
  same: any[];
  /** The plugin field says something else: both stay. */
  conflict: number;
  /** The plugin field cannot hold this value: it stays where it is. */
  incompatible: number;
}

/** What a transfer would do, without doing it. */
export async function planTransfer(
  collectionId: any,
  plugin: PluginDefinition,
  def: ExtraFieldConfig,
  native: FieldDefinition,
  t?: (key: string) => string
): Promise<TransferPlan> {
  const path = `extra.${def.name}`;
  const items = await db.items.find(and(
    eq('collection', idOf(collectionId)),
    eq('kind', plugin.kind),
    filled(path)
  ), { fields: ['extra', native.name] });

  const plan: TransferPlan = { withValue: 0, move: [], same: [], conflict: 0, incompatible: 0 };
  for (const item of items as any[]) {
    const raw = item.extra?.[def.name];
    if (isEmpty(raw)) continue;
    plan.withValue++;
    const converted = convertForNative(raw, def, native, t);
    if (!converted.ok) { plan.incompatible++; continue; }
    const current = item[native.name];
    if (isEmpty(current)) plan.move.push({ id: item._id, value: converted.value });
    else if (sameValue(current, converted.value)) plan.same.push(item._id);
    else plan.conflict++;
  }
  return plan;
}

/**
 * Carries the plan out: the plugin field filled where it was empty, the duplicate taken
 * off the items that no longer need it, and the collection's field removed once no item
 * holds anything in it. Returns what was done and whether the field is gone.
 */
export async function runTransfer(
  collectionId: any,
  plugin: PluginDefinition,
  def: ExtraFieldConfig,
  native: FieldDefinition,
  t?: (key: string) => string
): Promise<{ moved: number; cleared: number; left: number; removed: boolean }> {
  const plan = await planTransfer(collectionId, plugin, def, native, t);
  const path = `extra.${def.name}`;

  // The plugin field first, one item at a time and cast by its type: the duplicate is
  // only taken off an item once its value is safely where it belongs.
  let moved = 0;
  for (const entry of plan.move) {
    await db.items.updateOne(eq('_id', idOf(entry.id)), { set: { [native.name]: entry.value } }, { kind: plugin.kind });
    await db.items.updateOne(eq('_id', idOf(entry.id)), { unset: [path] }, { kind: plugin.kind });
    moved++;
  }
  for (const id of plan.same) {
    await db.items.updateOne(eq('_id', idOf(id)), { unset: [path] }, { kind: plugin.kind });
  }

  const left = plan.conflict + plan.incompatible;
  let removed = false;
  if (left === 0) {
    const settings = await db.settings.findOne(eq('collection', idOf(collectionId)));
    const remaining = getExtraFields(settings, plugin.id).filter(f => f.name !== def.name);
    const settingsPath = `pluginExtraFields.${plugin.id}`;
    await db.settings.updateOne(eq('collection', idOf(collectionId)),
      remaining.length > 0 ? { set: { [settingsPath]: remaining } } : { unset: [settingsPath] });
    removed = true;
  }
  return { moved, cleared: plan.same.length, left, removed };
}
