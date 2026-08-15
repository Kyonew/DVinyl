import { PluginDefinition, FieldDefinition } from './types';
import { dateLocaleFor } from '../config/constants';

/**
 * Content of a card body (collection grid, wishlist, dashboard).
 *
 * Every grid used to inline its own markup, which is how music-only fields ended up in a
 * generic view and how three different creator fallbacks drifted apart. The lines are
 * resolved here instead, from what the plugin declares, so the views only lay them out.
 *
 * A plugin declares `defaultCardFields`; a collection may override the selection in
 * settings.pluginCustomization (see pluginCustomization.ts). Labels are returned as
 * declared, i18n keys included, and translated by the view.
 */

/** Cards are a fifth of a row wide on desktop: past this they stop being readable. */
export const MAX_CARD_LINES = 3;

/** Field types that still mean something squeezed under a cover. */
const DISPLAYABLE_TYPES = new Set([
  'text', 'number', 'select', 'rating', 'tags', 'date', 'boolean', 'radio-cards'
]);

export interface CardLine {
  name: string;
  label: string;
  value: string;
  showLabel: boolean;
  style: 'text' | 'pill' | 'dot';
}

/** Fields a collection may pick from when choosing what its cards show. */
export function cardFieldCandidates(plugin: PluginDefinition): FieldDefinition[] {
  return (plugin.formFields || []).filter(f =>
    DISPLAYABLE_TYPES.has(f.type) && f.group !== 'hidden' && f.name !== 'title'
  );
}

function stringifyValue(field: FieldDefinition | undefined, raw: any, lang?: string): string {
  if (raw === undefined || raw === null || raw === '') return '';

  if (Array.isArray(raw)) return raw.filter(Boolean).map(String).join(', ');
  // Date-only values are stored as UTC midnight, so they are formatted in UTC too:
  // the local reading of a server east of Greenwich would show the day before.
  // Same rule as the item page, which is where the user checks the date.
  if (raw instanceof Date) return raw.toLocaleDateString(dateLocaleFor(lang), { timeZone: 'UTC' });

  if (typeof raw === 'boolean') {
    // A true flag shows as its own label ("Signed"); a false one is simply not a line
    return raw && field ? field.label : '';
  }

  if (field?.type === 'select') {
    const option = (field.options || []).find(o => String(o.value) === String(raw));
    return option ? option.label : String(raw);
  }

  return String(raw);
}

/**
 * Lines to render under the cover, title excluded (the views own it).
 * Capped at MAX_CARD_LINES, empty values dropped.
 */
export function getCardLines(
  plugin: PluginDefinition | undefined,
  item: any,
  options: { lang?: string } = {}
): CardLine[] {
  if (!plugin || !item) return [];

  // Presence, not length: a collection that deselected everything gets a title-only card,
  // which an "empty means default" rule would silently undo.
  const names = plugin.defaultCardFields || [plugin.creatorField];

  const lines: CardLine[] = [];
  for (const name of names) {
    if (lines.length >= MAX_CARD_LINES) break;

    const field = (plugin.formFields || []).find(f => f.name === name);
    const style = plugin.cardFieldStyles?.[name] || 'text';

    // A plugin may rewrite its own value for the card (e.g. music trimming the noise
    // words out of format_type); anything else falls back to the generic reading.
    const override = plugin.cardFieldValue?.(name, item);
    const value = override !== undefined && override !== null
      ? override
      : stringifyValue(field, item[name] ?? item.extra?.[name], options.lang);

    if (!value) continue;

    lines.push({
      name,
      label: field?.label || name,
      value,
      // The creator reads naturally on its own, and the decorated styles are too
      // small to carry a label. A true boolean already renders as its own label,
      // so keeping it here would print the name twice.
      showLabel: style === 'text' && name !== plugin.creatorField && field?.type !== 'boolean',
      style
    });
  }

  return lines;
}
