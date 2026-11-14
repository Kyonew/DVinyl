/**
 * Where each field of a type sits on the item page: shown in the page itself, folded into
 * the "More details" block under it, or hidden.
 *
 * A type grows fields over time, and every one of them on the page at once makes it hard
 * to read. Its plugin names the ones that interest few people (PluginDefinition.detailFolded),
 * folded by default; each collection then moves any field, its own fields included, from
 * the plugin customization workshop. Only what differs from that default is stored, so a
 * field folded by a later version folds for everyone who never chose otherwise.
 */

import type { FieldDefinition, PluginDefinition } from './types';

export type DetailPlacement = 'shown' | 'more' | 'hidden';
export const DETAIL_PLACEMENTS: readonly DetailPlacement[] = ['shown', 'more', 'hidden'];

/**
 * Drawn by a block of their own on the item page (the quantity and the condition also as
 * badges under the title), so a place chosen for them would not hold everywhere.
 */
const RENDERED_ELSEWHERE = new Set(['comments', 'genres', 'styles', 'location', 'quantity', 'sleeve_condition']);

/** The fields the item page lays out in its grid, in the type's order: what a choice can move. */
export function detailCandidates(plugin: PluginDefinition): FieldDefinition[] {
  const seen = new Set<string>();
  return (plugin.formFields || []).filter(field => {
    if (seen.has(field.name)) return false;
    seen.add(field.name);
    return field.showIn.includes('detail')
      && field.type !== 'custom'
      && !['title', plugin.creatorField].includes(field.name)
      && !RENDERED_ELSEWHERE.has(field.name);
  });
}

export function defaultPlacement(plugin: PluginDefinition, name: string): DetailPlacement {
  return plugin.detailFolded?.includes(name) ? 'more' : 'shown';
}

/** Where the field sits for this collection: its own choice, or the type's default. */
export function placementOf(plugin: PluginDefinition, name: string): DetailPlacement {
  const chosen = plugin.detailPlacement?.[name];
  return chosen && DETAIL_PLACEMENTS.includes(chosen) ? chosen : defaultPlacement(plugin, name);
}

/**
 * A submitted set of choices, kept to known fields and known places, and to what differs
 * from the default. Null when nothing differs, which stores nothing.
 */
export function sanitizeDetailPlacement(plugin: PluginDefinition, raw: unknown): Record<string, DetailPlacement> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, DetailPlacement> = {};
  for (const field of detailCandidates(plugin)) {
    const value = (raw as Record<string, unknown>)[field.name];
    if (typeof value !== 'string' || !DETAIL_PLACEMENTS.includes(value as DetailPlacement)) continue;
    if (value !== defaultPlacement(plugin, field.name)) out[field.name] = value as DetailPlacement;
  }
  return Object.keys(out).length > 0 ? out : null;
}
