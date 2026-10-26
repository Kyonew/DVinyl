/**
 * Colour themes: the presets of config/themes.ts, and the collection's own palette.
 *
 * A collection may define one palette of its own (settings.customTheme), picked like a
 * preset under the name CUSTOM_PRESET, for the home page or any item type. It holds the
 * same six colours as a preset, for light and dark mode, and nothing else: every value
 * is a #rrggbb colour that lands in a style block on every page, so anything else is
 * replaced by the default preset's colour on the way in and on the way out.
 */

import PRESETS from '../config/themes';

export const CUSTOM_PRESET = 'custom';
export const THEME_MODES = ['light', 'dark'] as const;
export const THEME_TOKENS = ['bg', 'card', 'navbar', 'text', 'subtext', 'highlight'] as const;

type Mode = typeof THEME_MODES[number];
type Token = typeof THEME_TOKENS[number];
export type Palette = Record<Token, string>;
export type ThemeColors = Record<Mode, Palette>;
// What a page is drawn with: a palette per mode, plus the text colour that reads on the
// accent, and the name of the theme it comes from.
export type ResolvedTheme = Record<Mode, Palette & { onHighlight: string }> & { name: string };

const HEX = /^#[0-9a-f]{6}$/i;

const asHex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;

/** The collection's own palette, every colour checked, the default preset filling gaps. */
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

/** Reads the studio's colour fields, named custom_<mode>_<token>. */
export function customThemeFromForm(body: any): ThemeColors {
  const src = body && typeof body === 'object' ? body : {};
  const raw: any = {};
  for (const mode of THEME_MODES) {
    raw[mode] = {};
    for (const token of THEME_TOKENS) raw[mode][token] = src[`custom_${mode}_${token}`];
  }
  return normalizeCustomTheme(raw);
}

export const isThemeName = (name: unknown): name is string =>
  typeof name === 'string' && (name === CUSTOM_PRESET || Object.prototype.hasOwnProperty.call(PRESETS, name));

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

/** The theme name chosen for a part of the app ('home' or an item type), home as fallback. */
export function themeNameFor(settings: any, key: string): string {
  const own = entryOf(settings?.theme, key)?.preset;
  if (isThemeName(own)) return own;
  const home = entryOf(settings?.theme, 'home')?.preset;
  return isThemeName(home) ? home : 'default';
}

/**
 * The colours a page of that part of the app is drawn with. The presets keep their
 * white text on the accent; the collection's own palette gets whichever reads.
 */
export function resolveTheme(settings: any, key: string): ResolvedTheme {
  const name = themeNameFor(settings, key);
  const custom = name === CUSTOM_PRESET;
  const colors = custom ? normalizeCustomTheme(settings?.customTheme) : normalizeCustomTheme(PRESETS[name]);
  const out = { name } as ResolvedTheme;
  for (const mode of THEME_MODES) {
    out[mode] = { ...colors[mode], onHighlight: custom ? textOn(colors[mode].highlight) : LIGHT_TEXT };
  }
  return out;
}
