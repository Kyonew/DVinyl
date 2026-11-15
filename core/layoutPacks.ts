import { LayoutSettings, normalizeLayout } from './layout';
import { normalizeWidgets, WidgetEnv } from './dashboard';
import { CARD_ASPECT_RATIOS } from './customPlugin';
import {
  INHERIT_PRESET, PALETTE_PREFIX, MAX_PALETTES, CustomPalette, ThemeColors,
  normalizeCustomTheme, normalizePalettes, paletteOf, paletteRef, isThemeName
} from './theme';
import { CardLook, normalizeCardLook } from './cardStyle';
import { Ambience, shareableAmbience } from './ambience';
// The widget types a pack's home page is checked against.
import './dashboardWidgets';

/**
 * Packs: a collection's look written to a JSON file that another collection or instance
 * can load.
 *
 * A pack is data only, never code: every value it carries is one the Personnalisation
 * page itself offers (a layout option, a colour preset by name or a palette of #rrggbb
 * colours, a card shape and look, an ambience without its pictures, widgets of known
 * types with their declared options), and anything else is dropped on the way in. No
 * CSS, no markup, no URL travels in one.
 */

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
  // Colour preset by item type ('home' for the pages that belong to no type): a preset,
  // 'inherit' for an item type wearing the home page's, or 'custom:<id>' naming one of
  // the palettes below. A pack of old named its single palette (customTheme) 'custom'.
  colors?: Record<string, string>;
  palettes?: CustomPalette[];
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
  // The palettes the colours use travel with them, under their current names.
  const palettes: CustomPalette[] = [];
  for (const [key, value] of Object.entries(colors)) {
    const palette = isThemeName(value) ? paletteOf(settings, value) : undefined;
    if (!palette) continue;
    colors[key] = paletteRef(palette.id);
    if (!palettes.some(p => p.id === palette.id)) palettes.push(palette);
  }
  if (palettes.length > 0) pack.palettes = palettes;
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
    layout?: LayoutSettings; colors?: Record<string, string>; palettes?: CustomPalette[];
    cards?: string; cardLook?: CardLook; ambience?: Ambience; home?: any[];
  } = {};
  if (raw.layout && typeof raw.layout === 'object') parts.layout = normalizeLayout(raw.layout);
  // A palette only stands for something when the pack carries it; a pack of old carries
  // its single palette apart, named 'custom'.
  const carried = {
    customThemes: Array.isArray(raw.palettes) ? raw.palettes
      : raw.customTheme && typeof raw.customTheme === 'object' ? [{ ...raw.customTheme, id: 'mine', name: '' }] : []
  };
  if (raw.colors && typeof raw.colors === 'object') {
    const colors: Record<string, string> = {};
    const palettes: CustomPalette[] = [];
    for (const [key, value] of Object.entries(raw.colors)) {
      if ((key !== 'home' && !itemTypes.includes(key)) || typeof value !== 'string') continue;
      if (colorPresets.includes(value) || (value === INHERIT_PRESET && key !== 'home')) {
        colors[key] = value;
        continue;
      }
      const palette = isThemeName(value) ? paletteOf(carried, value) : undefined;
      if (!palette) continue;
      colors[key] = paletteRef(palette.id);
      if (!palettes.some(p => p.id === palette.id)) palettes.push(palette);
    }
    if (Object.keys(colors).length > 0) parts.colors = colors;
    if (palettes.length > 0) parts.palettes = palettes;
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

const sameColors = (a: ThemeColors, b: ThemeColors): boolean =>
  JSON.stringify(normalizeCustomTheme(a)) === JSON.stringify(normalizeCustomTheme(b));

/**
 * The settings update applying the chosen parts of a pack read by readPack() to a
 * collection with these settings. The pack's palettes join the collection's own: one
 * with the very same colours is reused, the others get a new id (another instance's
 * ids mean nothing here) as long as there is room.
 */
export function packUpdate(parts: ReturnType<typeof readPack>['parts'], sections: string[], settings: any): Record<string, any> {
  const update: Record<string, any> = {};
  if (sections.includes('layout') && parts.layout) update.layout = parts.layout;
  if (sections.includes('colors') && parts.colors) {
    const own = normalizePalettes(settings);
    const renamed = new Map<string, string>();
    let added = false;
    for (const palette of parts.palettes || []) {
      const same = own.find(p => sameColors(p, palette));
      if (same) renamed.set(palette.id, same.id);
      else if (own.length < MAX_PALETTES) {
        let id = '';
        do { id = Math.random().toString(36).slice(2, 10); } while (!id || own.some(p => p.id === id));
        own.push({ ...palette, id });
        renamed.set(palette.id, id);
        added = true;
      }
    }
    for (const [key, value] of Object.entries(parts.colors)) {
      if (!value.startsWith(PALETTE_PREFIX)) update[`theme.${key}.preset`] = value;
      else if (renamed.has(value.slice(PALETTE_PREFIX.length))) update[`theme.${key}.preset`] = paletteRef(renamed.get(value.slice(PALETTE_PREFIX.length))!);
    }
    if (added) update.customThemes = own;
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
