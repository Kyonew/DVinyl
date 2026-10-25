/**
 * Layout of the app shell, chosen per collection by its admin (settings.layout).
 *
 * A layout only moves and restyles the shell (partials/header.ejs and partials/shell/*):
 * where the navigation sits on a large screen, how dense, round, large and wide the
 * interface is, and which font it uses. Pages never read it. Everything below md keeps
 * the phone shell (tab bar), whatever is chosen here.
 *
 * Values travel to the page as CSS variables and data attributes on <html>, and the
 * Tailwind runtime config in header.ejs maps its padding, gap, radius, font and content
 * width scales onto those variables, so no page template needs to know about them.
 */

export const NAV_POSITIONS = ['top', 'left', 'right', 'bottom'] as const;
export const TOP_STYLES = ['bar', 'floating'] as const;
export const SIDEBAR_STYLES = ['expanded', 'rail'] as const;
export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export const RADII = ['square', 'soft', 'rounded', 'round'] as const;
export const SCALES = ['small', 'normal', 'large'] as const;
export const CONTENT_WIDTHS = ['narrow', 'normal', 'wide', 'full'] as const;
export const FONTS = ['system', 'jakarta', 'poppins', 'serif', 'mono'] as const;

export type NavPosition = typeof NAV_POSITIONS[number];

export interface LayoutSettings {
  nav: NavPosition;
  // Top navigation only: a full-width bar, or a rounded bar floating off the edges.
  topStyle: typeof TOP_STYLES[number];
  // Top navigation only: the bar stays on screen while the page scrolls. Sidebars and
  // the dock always do.
  sticky: boolean;
  // Side navigation only: icons with their labels, or a narrow rail of icons. Each
  // viewer can still fold or unfold it for themselves (see SIDEBAR_COOKIE).
  sidebar: typeof SIDEBAR_STYLES[number];
  // Bottom dock only: a caption under each icon.
  dockLabels: boolean;
  density: typeof DENSITIES[number];
  radius: typeof RADII[number];
  scale: typeof SCALES[number];
  width: typeof CONTENT_WIDTHS[number];
  font: typeof FONTS[number];
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  nav: 'top',
  topStyle: 'bar',
  sticky: false,
  sidebar: 'expanded',
  dockLabels: false,
  density: 'comfortable',
  radius: 'rounded',
  scale: 'normal',
  width: 'normal',
  font: 'system'
};

// A viewer's own fold of the sidebar, remembered in the browser and read back on the
// server so the page is drawn at the right width from the first paint.
export const SIDEBAR_COOKIE = 'dvSidebar';

const DENSITY_FACTOR: Record<LayoutSettings['density'], number> = { compact: 0.8, comfortable: 1, spacious: 1.2 };
const RADIUS_FACTOR: Record<LayoutSettings['radius'], number> = { square: 0, soft: 0.5, rounded: 1, round: 1.5 };
const SCALE_PERCENT: Record<LayoutSettings['scale'], string> = { small: '93.75%', normal: '100%', large: '106.25%' };
const CONTENT_MAX: Record<LayoutSettings['width'], string> = { narrow: '64rem', normal: '80rem', wide: '96rem', full: 'none' };

const SYSTEM_SANS = 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
// stylesheet: a vendored @font-face file under public/vendor/fonts, loaded only when picked.
const FONT_STACKS: Record<LayoutSettings['font'], { stack: string; stylesheet?: string }> = {
  system: { stack: SYSTEM_SANS },
  jakarta: { stack: `"Plus Jakarta Sans", ${SYSTEM_SANS}`, stylesheet: 'plus-jakarta-sans.css' },
  poppins: { stack: `"Poppins", ${SYSTEM_SANS}`, stylesheet: 'poppins.css' },
  serif: { stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' },
  mono: { stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace' }
};

const pick = <T extends readonly string[]>(allowed: T, value: unknown, fallback: T[number]): T[number] =>
  (allowed as readonly string[]).includes(value as string) ? (value as T[number]) : fallback;

const toBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'on' || value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0' || value === '') return false;
  return fallback;
};

/**
 * Only the offered values pass, whatever is stored or posted: every one of them ends up
 * in a class, a data attribute or a CSS variable on every page.
 */
export function normalizeLayout(raw: any): LayoutSettings {
  const src = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_LAYOUT;
  return {
    nav: pick(NAV_POSITIONS, src.nav, d.nav),
    topStyle: pick(TOP_STYLES, src.topStyle, d.topStyle),
    sticky: toBool(src.sticky, d.sticky),
    sidebar: pick(SIDEBAR_STYLES, src.sidebar, d.sidebar),
    dockLabels: toBool(src.dockLabels, d.dockLabels),
    density: pick(DENSITIES, src.density, d.density),
    radius: pick(RADII, src.radius, d.radius),
    scale: pick(SCALES, src.scale, d.scale),
    width: pick(CONTENT_WIDTHS, src.width, d.width),
    font: pick(FONTS, src.font, d.font)
  };
}

/**
 * Reads a posted form whose layout fields are named layout_<key>. Checkboxes that were
 * left unticked are not posted at all, hence the explicit false for them.
 */
export function layoutFromForm(body: any): LayoutSettings {
  const src = body && typeof body === 'object' ? body : {};
  return normalizeLayout({
    nav: src.layout_nav,
    topStyle: src.layout_topStyle,
    sticky: src.layout_sticky === 'on',
    sidebar: src.layout_sidebar,
    dockLabels: src.layout_dockLabels === 'on',
    density: src.layout_density,
    radius: src.layout_radius,
    scale: src.layout_scale,
    width: src.layout_width,
    font: src.layout_font
  });
}

export interface ResolvedLayout extends LayoutSettings {
  // What the shell actually draws for this viewer: the collection's sidebar style, or
  // the fold they chose for themselves.
  sidebarState: 'expanded' | 'rail';
  cssVars: Record<string, string>;
  fontStylesheet: string | null;
}

export function resolveLayout(settings: any, cookies?: Record<string, string>): ResolvedLayout {
  const layout = normalizeLayout(settings?.layout);
  const ownFold = cookies?.[SIDEBAR_COOKIE];
  const sidebarState = ownFold === 'rail' || ownFold === 'expanded' ? ownFold : layout.sidebar;
  const font = FONT_STACKS[layout.font];
  return {
    ...layout,
    sidebarState,
    cssVars: {
      '--dv-space': String(DENSITY_FACTOR[layout.density]),
      '--dv-radius': String(RADIUS_FACTOR[layout.radius]),
      '--dv-content-max': CONTENT_MAX[layout.width],
      '--dv-font': font.stack
    },
    fontStylesheet: font.stylesheet || null
  };
}

export function layoutRootFontSize(layout: LayoutSettings): string {
  return SCALE_PERCENT[layout.scale];
}

// Option lists for the Personnalisation page, in display order.
export const LAYOUT_OPTIONS = {
  defaults: DEFAULT_LAYOUT,
  nav: NAV_POSITIONS,
  topStyle: TOP_STYLES,
  sidebar: SIDEBAR_STYLES,
  density: DENSITIES,
  radius: RADII,
  scale: SCALES,
  width: CONTENT_WIDTHS,
  font: FONTS,
  fontStacks: Object.fromEntries(Object.entries(FONT_STACKS).map(([k, v]) => [k, v.stack])) as Record<string, string>,
  radiusFactor: RADIUS_FACTOR,
  densityFactor: DENSITY_FACTOR,
  scalePercent: SCALE_PERCENT,
  contentMax: CONTENT_MAX
};
