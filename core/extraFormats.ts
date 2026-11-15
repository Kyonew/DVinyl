/**
 * The other formats one edition holds besides its own: a 4K UHD that comes with the
 * Blu-ray, a vinyl sold with the CD. The item keeps its format as it always did, and
 * `extra_formats` lists the others, taken from the type's own format list.
 *
 * A type opts in with `multipleFormats` on its definition, since not every list of
 * formats describes discs that can share a box (a Lego set is sealed or built, never
 * both). Everything that reads a format then reads both: the format filter, the counts
 * per format and the badge on the card. The total stays one per copy.
 */
import type { PluginDefinition, FieldDefinition } from './types';

export const EXTRA_FORMATS_FIELD = 'extra_formats';

/** Whether the type lets an edition hold more than one of its formats. */
export function allowsExtraFormats(plugin: PluginDefinition | null | undefined): boolean {
  return !!plugin?.multipleFormats && (plugin.formats || []).length > 1;
}

/** The item's own format, as the views have always read it. */
export function mainFormatOf(item: any): string {
  return String(item?.format || item?.media_type || '').toLowerCase();
}

/** The other formats the item holds, without its own and without repeats. */
export function extraFormatsOf(item: any): string[] {
  const main = mainFormatOf(item);
  const list = Array.isArray(item?.extra_formats) ? item.extra_formats : [];
  const seen = new Set<string>();
  for (const raw of list) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (value && value !== main) seen.add(value);
  }
  return [...seen];
}

/** Whether the item holds `format`, as its own or as one of the others. */
export function holdsFormat(item: any, format: string): boolean {
  const wanted = String(format || '').toLowerCase();
  if (!wanted) return false;
  return mainFormatOf(item) === wanted || extraFormatsOf(item).includes(wanted);
}

/**
 * What a form posted for the field, made a clean list: the boxes come as one value, a
 * list of them or a comma-separated text, and only the type's own formats other than the
 * main one are kept.
 */
export function parseExtraFormats(raw: unknown, plugin: PluginDefinition, main: unknown): string[] {
  const posted = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const known = new Set((plugin.formats || []).map(f => String(f.value).toLowerCase()));
  const own = String(main ?? '').trim().toLowerCase();
  const out: string[] = [];
  for (const entry of posted) {
    const value = String(entry ?? '').trim().toLowerCase();
    if (value && value !== own && known.has(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

/** The form field, placed right after the type's format select. */
export function extraFormatsField(): FieldDefinition {
  return {
    name: EXTRA_FORMATS_FIELD,
    label: 'common.extra_formats',
    type: 'tags',
    showIn: ['edit', 'confirm', 'manual'],
    group: 'main'
  };
}

/** Adds the field to a type that allows it and does not carry it yet. */
export function addExtraFormatsField(plugin: PluginDefinition): void {
  if (!allowsExtraFormats(plugin)) return;
  const fields = plugin.formFields || (plugin.formFields = []);
  if (fields.some(f => f.name === EXTRA_FORMATS_FIELD)) return;
  let at = fields.findIndex(f => f.name === 'format');
  if (at < 0) at = fields.findIndex(f => f.name === 'media_type');
  if (at >= 0) fields.splice(at + 1, 0, extraFormatsField());
  else fields.push(extraFormatsField());
}
