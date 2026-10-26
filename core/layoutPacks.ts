import { LayoutSettings, normalizeLayout, DEFAULT_LAYOUT } from './layout';
import { normalizeWidgets, WidgetEnv } from './dashboard';
import { CARD_ASPECT_RATIOS } from './customPlugin';
import { CUSTOM_PRESET, normalizeCustomTheme, ThemeColors } from './theme';
import { CardLook, normalizeCardLook } from './cardStyle';
import { Ambience, shareableAmbience } from './ambience';
// The widget types a pack's home page is checked against.
import './dashboardWidgets';

/**
 * Ready-made layouts, and packs: a collection's look written to a JSON file that
 * another collection or instance can load.
 *
 * A pack is data only, never code: every value it carries is one the Personnalisation
 * page itself offers (a layout option, a colour preset by name or a palette of #rrggbb
 * colours, a card shape and look, an ambience without its pictures, widgets of known
 * types with their declared options), and anything else is dropped on the way in. No
 * CSS, no markup, no URL travels in one.
 */

export interface LayoutPreset {
  id: string;
  label: string; // i18n key
  description: string; // i18n key
  icon: string; // FontAwesome icon
  layout: LayoutSettings;
}

const preset = (id: string, icon: string, layout: Partial<LayoutSettings>): LayoutPreset => ({
  id,
  icon,
  label: `layout.preset_${id}`,
  description: `layout.preset_${id}_desc`,
  layout: { ...DEFAULT_LAYOUT, ...layout }
});

export const LAYOUT_PRESETS: LayoutPreset[] = [
  preset('classic', 'fa-window-maximize', {}),
  preset('sidebar', 'fa-table-columns', { nav: 'left', sidebar: 'expanded', width: 'wide' }),
  preset('dock', 'fa-grip', { nav: 'bottom', radius: 'round', font: 'jakarta' }),
  preset('minimal', 'fa-feather', { nav: 'top', topStyle: 'floating', sticky: true, density: 'spacious', radius: 'soft', width: 'narrow' }),
  preset('dense', 'fa-table-cells', { nav: 'left', sidebar: 'rail', density: 'compact', radius: 'soft', scale: 'small', width: 'full' }),
  preset('editorial', 'fa-newspaper', { nav: 'top', density: 'spacious', radius: 'square', width: 'narrow', font: 'serif' })
];

export const PACK_FORMAT = 'dvinyl-look';
export const PACK_VERSION = 1;
export const PACK_SECTIONS = ['layout', 'colors', 'cards', 'ambience', 'home'] as const;
export type PackSection = typeof PACK_SECTIONS[number];
// Far above any real pack (a full home page with long notes stays under 200 KB).
export const MAX_PACK_BYTES = 512 * 1024;

export interface LookPack {
  format: typeof PACK_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  layout?: LayoutSettings;
  // Colour preset by item type ('home' for the pages that belong to no type), 'custom'
  // naming the palette in customTheme.
  colors?: Record<string, string>;
  customTheme?: ThemeColors;
  // The cover shape, and the rest of the card's look.
  cards?: string;
  cardLook?: CardLook;
  // The background, glass and cover accent; the background picture and the logo stay home.
  ambience?: Ambience;
  home?: { widgets: any[] };
}

const presetOf = (entry: any): string | undefined =>
  entry && typeof entry === 'object' ? entry.preset : undefined;

/** The collection's current look, as saved. */
export function buildPack(settings: any, name: string): LookPack {
  const colors: Record<string, string> = {};
  const theme = settings?.theme instanceof Map ? Object.fromEntries(settings.theme) : (settings?.theme || {});
  for (const [key, entry] of Object.entries(theme)) {
    const value = presetOf(entry);
    if (typeof value === 'string') colors[key] = value;
  }
  const pack: LookPack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    name: String(name || '').slice(0, 80),
    exportedAt: new Date().toISOString(),
    layout: normalizeLayout(settings?.layout),
    colors,
    cards: settings?.aspectRatioClass || 'aspect-square',
    cardLook: normalizeCardLook(settings?.cards),
    ambience: shareableAmbience(settings?.ambience)
  };
  if (Object.values(colors).includes(CUSTOM_PRESET)) pack.customTheme = normalizeCustomTheme(settings?.customTheme);
  // Only a home page someone arranged travels: the default one is rebuilt anywhere.
  if (Array.isArray(settings?.dashboard?.widgets)) pack.home = { widgets: settings.dashboard.widgets };
  return pack;
}

export class PackError extends Error {}

/**
 * Reads a pack file into the parts this instance can apply. Throws PackError for
 * something that is not a pack at all; inside a pack, values that do not fit (a colour
 * preset or item type this instance lacks, a widget type it does not know) are dropped.
 */
export function readPack(raw: any, env: WidgetEnv, colorPresets: string[], itemTypes: string[]) {
  if (!raw || typeof raw !== 'object' || raw.format !== PACK_FORMAT) throw new PackError('perso.pack_error_format');
  if (typeof raw.version !== 'number' || raw.version > PACK_VERSION) throw new PackError('perso.pack_error_version');

  const parts: {
    layout?: LayoutSettings; colors?: Record<string, string>; customTheme?: ThemeColors;
    cards?: string; cardLook?: CardLook; ambience?: Ambience; home?: any[];
  } = {};
  if (raw.layout && typeof raw.layout === 'object') parts.layout = normalizeLayout(raw.layout);
  // 'custom' only stands for something when the pack carries the palette it names.
  const hasPalette = Boolean(raw.customTheme && typeof raw.customTheme === 'object');
  const themeNames = hasPalette ? [...colorPresets, CUSTOM_PRESET] : colorPresets;
  if (raw.colors && typeof raw.colors === 'object') {
    const colors: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.colors)) {
      if ((key === 'home' || itemTypes.includes(key)) && typeof value === 'string' && themeNames.includes(value)) colors[key] = value;
    }
    if (Object.keys(colors).length > 0) parts.colors = colors;
    if (Object.values(colors).includes(CUSTOM_PRESET)) parts.customTheme = normalizeCustomTheme(raw.customTheme);
  }
  if ((CARD_ASPECT_RATIOS as readonly string[]).includes(raw.cards)) parts.cards = raw.cards;
  if (raw.cardLook && typeof raw.cardLook === 'object') parts.cardLook = normalizeCardLook(raw.cardLook);
  if (raw.ambience && typeof raw.ambience === 'object') parts.ambience = shareableAmbience(raw.ambience);
  if (raw.home && Array.isArray(raw.home.widgets)) parts.home = normalizeWidgets(raw.home.widgets, env);

  return {
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : '',
    parts
  };
}

/** The settings update applying the chosen parts of a pack read by readPack(). */
export function packUpdate(parts: ReturnType<typeof readPack>['parts'], sections: string[]): Record<string, any> {
  const update: Record<string, any> = {};
  if (sections.includes('layout') && parts.layout) update.layout = parts.layout;
  if (sections.includes('colors') && parts.colors) {
    for (const [key, value] of Object.entries(parts.colors)) update[`theme.${key}.preset`] = value;
    if (parts.customTheme) update.customTheme = parts.customTheme;
  }
  if (sections.includes('cards') && parts.cards) update.aspectRatioClass = parts.cards;
  if (sections.includes('cards') && parts.cardLook) update.cards = parts.cardLook;
  // The collection keeps its own picture and logo; a pack asking for a picture it does
  // not carry leaves the background plain until one is uploaded here.
  if (sections.includes('ambience') && parts.ambience) {
    for (const [key, value] of Object.entries(parts.ambience)) {
      if (key !== 'image' && key !== 'logo') update[`ambience.${key}`] = value;
    }
  }
  if (sections.includes('home') && parts.home) update.dashboard = { widgets: parts.home };
  return update;
}
