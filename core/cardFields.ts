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
  translateValue: boolean;
  showLabel: boolean;
  style: 'text' | 'pill' | 'dot';
}

interface StringifiedValue {
  value: string;
  translate: boolean;
}

/**
 * Fields a public share link never shows, whatever the collection chose to display.
 *
 * Where something is kept says nothing about the collection and everything about the home
 * around it: a link handed to strangers, or printed as a QR code on a shelf, has no
 * business naming the room, the cupboard or the safe. The choice stays available to the
 * members, who are the ones it was written for.
 */
export const SHARE_HIDDEN_FIELDS = new Set(['location']);

/**
 * Whether a string is one of the catalogue's own keys, which all read "namespace.key".
 *
 * Labels and option labels are keys when they come from a plugin's code, and plain words
 * when a collection typed them itself in the Customize panel. Handing the second kind to
 * t() is how a field named "media" ends up printing i18next's "returned an object instead
 * of string" on every card: the word happens to be a whole section of the catalogue.
 */
export function isTranslationKey(value: string): boolean {
  return /^[a-z0-9_]+\.[a-z0-9_.]+$/.test(value);
}

/** Fields a collection may pick from when choosing what its cards show. */
export function cardFieldCandidates(plugin: PluginDefinition): FieldDefinition[] {
  return (plugin.formFields || []).filter(f =>
    DISPLAYABLE_TYPES.has(f.type) && f.group !== 'hidden' && f.name !== 'title'
  );
}

function stringifyValue(field: FieldDefinition | undefined, raw: any, lang?: string): StringifiedValue {
  if (raw === undefined || raw === null || raw === '') return { value: '', translate: false };

  if (Array.isArray(raw)) return { value: raw.filter(Boolean).map(String).join(', '), translate: false };
  // Date-only values are stored as UTC midnight, so they are formatted in UTC too:
  // the local reading of a server east of Greenwich would show the day before.
  // Same rule as the item page, which is where the user checks the date.
  if (raw instanceof Date) {
    return { value: raw.toLocaleDateString(dateLocaleFor(lang), { timeZone: 'UTC' }), translate: false };
  }

  if (typeof raw === 'boolean') {
    // A true flag shows as its own label ("Signed"); a false one is simply not a line
    return { value: raw && field ? field.label : '', translate: raw && !!field };
  }

  if (field?.type === 'select' || field?.type === 'radio-cards') {
    const option = (field.options || []).find(o => String(o.value) === String(raw));
    return option
      ? { value: option.label, translate: true }
      : { value: String(raw), translate: false };
  }

  return { value: String(raw), translate: false };
}

// A plugin may rewrite its own value for display (e.g. music trimming the noise words out
// of format_type); anything else falls back to the generic reading.
function readField(plugin: PluginDefinition, field: FieldDefinition | undefined, name: string, item: any, lang?: string): StringifiedValue {
  const override = plugin.cardFieldValue?.(name, item);
  return override !== undefined && override !== null
    ? { value: override, translate: false }
    : stringifyValue(field, item[name] ?? item.extra?.[name], lang);
}

/**
 * Where the chosen field may sit on a cover. Top-right is absent on purpose: the format
 * badge lives there in every grid, and two pills in one corner would overlap.
 *
 * Which corner is the free one depends on the artwork, not on us. A film poster carries
 * its title at the bottom, a square sleeve often has a logo top-left, so the choice
 * belongs to whoever is looking at their own shelf.
 */
export const CORNER_POSITIONS: Record<string, { normal: string; compact: string }> = {
  'bottom-left': {
    normal: 'bottom-2 left-2',
    compact: 'bottom-1.5 left-1.5 md:bottom-2 md:left-2'
  },
  'bottom-right': {
    normal: 'bottom-2 right-2',
    compact: 'bottom-1.5 right-1.5 md:bottom-2 md:right-2'
  },
  'top-left': {
    normal: 'top-2 left-2',
    compact: 'top-1.5 left-1.5 md:top-2 md:left-2'
  }
};

export const DEFAULT_CORNER_POSITION = 'bottom-left';

/**
 * What to put in the free corner of a cover, or '' when there is nothing to put there.
 * The field is chosen per module and per collection in the Customize panel.
 *
 * Deliberately not routed through stringifyValue: a select resolves to its full option
 * label there, and the corner is a few characters wide. A sleeve condition stored as "VG+"
 * has to read "VG+" from across a grid, not "Very Good Plus (VG+)". Everything else keeps
 * the shared rules, dates and lists included, and a boolean still returns its field label
 * since a bare "true" would say nothing.
 *
 * The result may be a translation key (that is what a boolean's label is), so views render
 * it through t() with the value itself as the fallback.
 */
export function getCornerBadge(
  plugin: PluginDefinition | undefined,
  item: any,
  options: { lang?: string; isShareView?: boolean } = {}
): string {
  const name = (plugin as any)?.cornerField;
  if (!plugin || !item || !name) return '';
  if (options.isShareView && SHARE_HIDDEN_FIELDS.has(name)) return '';

  const raw = item[name] ?? item.extra?.[name];
  if (raw === undefined || raw === null || raw === '') return '';

  if (Array.isArray(raw)) return raw.filter(Boolean).map(String).join(', ');
  if (raw instanceof Date) return raw.toLocaleDateString(dateLocaleFor(options.lang), { timeZone: 'UTC' });
  if (typeof raw === 'boolean') {
    const field = (plugin.formFields || []).find(f => f.name === name);
    return raw && field ? field.label : '';
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
  options: { lang?: string; isShareView?: boolean } = {}
): CardLine[] {
  if (!plugin || !item) return [];

  // Presence, not length: a collection that deselected everything gets a title-only card,
  // which an "empty means default" rule would silently undo.
  const names = plugin.defaultCardFields || [plugin.creatorField];

  const lines: CardLine[] = [];
  for (const name of names) {
    if (lines.length >= MAX_CARD_LINES) break;
    if (options.isShareView && SHARE_HIDDEN_FIELDS.has(name)) continue;

    const field = (plugin.formFields || []).find(f => f.name === name);
    const style = plugin.cardFieldStyles?.[name] || 'text';

    const resolved = readField(plugin, field, name, item, options.lang);
    if (!resolved.value) continue;

    lines.push({
      name,
      label: field?.label || name,
      value: resolved.value,
      translateValue: resolved.translate,
      // The creator reads naturally on its own, and the decorated styles are too
      // small to carry a label. A true boolean already renders as its own label,
      // so keeping it here would print the name twice.
      showLabel: style === 'text' && name !== plugin.creatorField && field?.type !== 'boolean',
      style
    });
  }

  return lines;
}

/**
 * The table view's columns, title excluded (the view owns it), chosen per type and per
 * collection. They come from the same fields as the cards. A collection that never chose
 * gets what its cards show plus the location, each in a column of its own, and keeps
 * following its cards until it does: only a choice that differs from that is stored.
 *
 * The page showing every type at once has no columns of this kind: its rows hold different
 * fields, so no single type's choice applies to them.
 */
export interface TableColumn {
  name: string;
  label: string;
}

export interface TableCell {
  value: string;
  translate: boolean;
  // A true boolean: its column already says what it is, the row only has to tick it.
  flag: boolean;
}

/** What a type's table shows when nobody chose, in the order the type declares its fields. */
export function defaultTableColumnNames(plugin: PluginDefinition): string[] {
  const wanted = new Set([...(plugin.defaultCardFields || [plugin.creatorField]), 'location']);
  return cardFieldCandidates(plugin).map(f => f.name).filter(name => wanted.has(name));
}

/** The names of a type's columns, which `plugin.tableColumns` overrides once it is set. */
export function tableColumnNames(plugin: PluginDefinition): string[] {
  return plugin.tableColumns || defaultTableColumnNames(plugin);
}

/** The columns to draw. Anything no longer declared, such as a deleted field, is dropped. */
export function getTableColumns(plugin: PluginDefinition, options: { isShareView?: boolean } = {}): TableColumn[] {
  const candidates = cardFieldCandidates(plugin);
  return tableColumnNames(plugin).flatMap(name => {
    const field = candidates.find(f => f.name === name);
    return field && !(options.isShareView && SHARE_HIDDEN_FIELDS.has(name)) ? [{ name, label: field.label }] : [];
  });
}

export function getTableCell(plugin: PluginDefinition, column: TableColumn, item: any, options: { lang?: string } = {}): TableCell {
  const field = (plugin.formFields || []).find(f => f.name === column.name);
  const { value, translate } = readField(plugin, field, column.name, item, options.lang);
  return { value, translate, flag: field?.type === 'boolean' && !!value };
}

/**
 * What to store from a submission listing the columns left on, or undefined when nothing
 * has to be. Checked against the type's fields and put back in their order, so a crafted
 * payload cannot name an arbitrary path. `defaults` are what the table follows when nobody
 * chose, before and after the same submission changes the cards: leaving the boxes as they
 * opened is no choice, or the first save of any setting would stop the table following them.
 */
export function sanitizeTableColumns(plugin: PluginDefinition, submitted: unknown[], defaults: string[][]): string[] | undefined {
  const picked = new Set(submitted.filter(name => typeof name === 'string'));
  const names = cardFieldCandidates(plugin).map(f => f.name).filter(name => picked.has(name));
  return defaults.some(list => list.join() === names.join()) ? undefined : names;
}
