/**
 * Colour themes: the presets of config/themes.ts, and the collection's own palettes.
 *
 * A collection may keep palettes of its own (settings.customThemes, up to MAX_PALETTES),
 * each picked like a preset under the name 'custom:<id>', for the home page or any item
 * type. A palette holds the same six colours as a preset, for light and dark mode, and a
 * name: every colour is a #rrggbb value that lands in a style block on every page, so
 * anything else is replaced by the default preset's colour on the way in and on the way
 * out.
 *
 * An item type picks a theme of its own, or INHERIT_PRESET to wear the home page's.
 *
 * Before there could be several, a collection had one palette (settings.customTheme),
 * picked as 'custom'. Until the studio saves the list, that palette reads as the first
 * of the list and 'custom' as its name.
 */

import PRESETS from '../config/themes';

export const CUSTOM_PRESET = 'custom';
export const PALETTE_PREFIX = 'custom:';
export const INHERIT_PRESET = 'inherit';
export const MAX_PALETTES = 12;
export const THEME_MODES = ['light', 'dark'] as const;
export const THEME_TOKENS = ['bg', 'card', 'navbar', 'text', 'subtext', 'highlight'] as const;

type Mode = typeof THEME_MODES[number];
type Token = typeof THEME_TOKENS[number];
export type Palette = Record<Token, string>;
export type ThemeColors = Record<Mode, Palette>;
export type CustomPalette = ThemeColors & { id: string; name: string };
// What a page is drawn with: a palette per mode, plus the text colour that reads on the
// accent, and the name of the theme it comes from.
export type ResolvedTheme = Record<Mode, Palette & { onHighlight: string }> & { name: string };

const HEX = /^#[0-9a-f]{6}$/i;
const PALETTE_ID = /^[a-z0-9]{1,16}$/;
// The id the single palette of old takes in the list.
const LEGACY_PALETTE_ID = 'mine';
const MAX_PALETTE_NAME = 40;

const asHex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;

/** A palette's colours, every one checked, the default preset filling gaps. */
export function normalizeCustomTheme(raw: any): ThemeColors {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = PRESETS.default;
  const out = {} as ThemeColors;
  for (const mode of THEME_MODES) {
    const given = src[mode] && typeof src[mode] === 'object' ? src[mode] : {};
    out[mode] = {} as Palette;
    for (const token of THEME_TOKENS) out[mode][token] = asHex(given[token], base[mode][token]);
  }
  return out;
}

export const paletteRef = (id: string): string => PALETTE_PREFIX + id;

function normalizePaletteList(list: any[]): CustomPalette[] {
  const seen = new Set<string>();
  const out: CustomPalette[] = [];
  for (const raw of list) {
    if (out.length >= MAX_PALETTES) break;
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !PALETTE_ID.test(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, MAX_PALETTE_NAME) : '';
    out.push({ id: raw.id, name, ...normalizeCustomTheme(raw) });
  }
  return out;
}

/**
 * The collection's palettes, in the order its admin keeps them. The single palette of
 * old only joins them while some part of the app still wears it: the studio used to
 * save one whether it was used or not.
 */
export function normalizePalettes(settings: any): CustomPalette[] {
  if (Array.isArray(settings?.customThemes)) return normalizePaletteList(settings.customThemes);
  const legacy = settings?.customTheme;
  const theme = settings?.theme instanceof Map ? Object.fromEntries(settings.theme) : (settings?.theme || {});
  const worn = Object.values<any>(theme).some(entry => entry?.preset === CUSTOM_PRESET);
  if (worn && legacy && typeof legacy === 'object') {
    return [{ id: LEGACY_PALETTE_ID, name: '', ...normalizeCustomTheme(legacy) }];
  }
  return [];
}

/** Reads the studio's list of palettes, posted as JSON in the field customThemes. */
export function palettesFromForm(body: any): CustomPalette[] {
  const raw = typeof body?.customThemes === 'string' ? body.customThemes : '';
  if (raw.length > 64 * 1024) return [];
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? normalizePaletteList(list) : [];
  } catch (e) {
    return [];
  }
}

const isPreset = (name: unknown): name is string =>
  typeof name === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, name);

/** A name a theme could go by: a preset, a palette's, or the single palette's of old. */
export const isThemeName = (name: unknown): name is string =>
  isPreset(name) || name === CUSTOM_PRESET
  || (typeof name === 'string' && name.startsWith(PALETTE_PREFIX) && PALETTE_ID.test(name.slice(PALETTE_PREFIX.length)));

/** What a part of the app may be set to: a theme, or the home page's. */
export const isThemeChoice = (name: unknown): name is string => name === INHERIT_PRESET || isThemeName(name);

/** The palette a theme name points at, if it is one of this collection's. */
export function paletteOf(settings: any, name: string): CustomPalette | undefined {
  const palettes = normalizePalettes(settings);
  if (name === CUSTOM_PRESET) return palettes.find(p => p.id === LEGACY_PALETTE_ID) || palettes[0];
  if (!name.startsWith(PALETTE_PREFIX)) return undefined;
  const id = name.slice(PALETTE_PREFIX.length);
  return palettes.find(p => p.id === id);
}

// ---- Contrast (WCAG 2) ------------------------------------------------------------

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#111111';

/**
 * Text on an accent background. White, as every preset draws it, as long as it reads
 * at the large-text level (3:1); past that, whichever of white and near black reads best.
 */
export function textOn(accent: string): string {
  const white = contrastRatio(accent, LIGHT_TEXT);
  return white >= 3 || white >= contrastRatio(accent, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

// ---- Which theme a page gets ---------------------------------------------------------

const entryOf = (theme: any, key: string): any =>
  theme instanceof Map ? theme.get(key) : theme?.[key];

// The theme a stored name stands for, as the studio offers it: a preset, or a palette
// that still exists, under its current name.
function existingTheme(settings: any, name: unknown): string | null {
  if (isPreset(name)) return name;
  if (!isThemeName(name)) return null;
  const palette = paletteOf(settings, name);
  return palette ? paletteRef(palette.id) : null;
}

/** The theme name a part of the app ('home' or an item type) is drawn with. */
export function themeNameFor(settings: any, key: string): string {
  return existingTheme(settings, entryOf(settings?.theme, key)?.preset)
    || existingTheme(settings, entryOf(settings?.theme, 'home')?.preset)
    || 'default';
}

/**
 * What the studio shows as picked: the home page's theme, and for an item type either
 * its own or INHERIT_PRESET. A type set to the very theme the home page wears follows
 * it from then on, which changes nothing it shows.
 */
export function themeChoiceFor(settings: any, key: string): string {
  const home = existingTheme(settings, entryOf(settings?.theme, 'home')?.preset) || 'default';
  if (key === 'home') return home;
  const own = existingTheme(settings, entryOf(settings?.theme, key)?.preset);
  return own && own !== home ? own : INHERIT_PRESET;
}

/**
 * The colours a page of that part of the app is drawn with. The presets keep their
 * white text on the accent; the collection's own palettes get whichever reads.
 */
export function resolveTheme(settings: any, key: string): ResolvedTheme {
  const name = themeNameFor(settings, key);
  const palette = isPreset(name) ? undefined : paletteOf(settings, name);
  const colors = normalizeCustomTheme(palette || PRESETS[name]);
  const out = { name } as ResolvedTheme;
  for (const mode of THEME_MODES) {
    out[mode] = { ...colors[mode], onHighlight: palette ? textOn(colors[mode].highlight) : LIGHT_TEXT };
  }
  return out;
}
