import crypto from 'crypto';

/**
 * The home page as a grid of widgets, arranged per collection by its admin
 * (settings.dashboard.widgets) and edited in place on the page itself.
 *
 * Same idea as the view registry: the page knows no widget in particular. It walks the
 * collection's list, asks each widget's type for its data, and renders the type's
 * partial (views/partials/dashboard/widgets/<type>.ejs) inside a common frame. A new
 * widget is one declaration in core/dashboardWidgets.ts plus one partial.
 */

// How much of the row a widget takes: a quarter, half, three quarters or all of it on
// large screens; half or all of it on a phone (see partials/dashboard/frame).
export const WIDGET_SIZES = ['s', 'm', 'l', 'full'] as const;
export type WidgetSize = typeof WIDGET_SIZES[number];

// Where a widget shows: everywhere, or only on one side of the md breakpoint.
export const WIDGET_SHOW = ['all', 'desktop', 'phone'] as const;
export type WidgetShow = typeof WIDGET_SHOW[number];

export const MAX_WIDGETS = 40;

export interface WidgetInstance {
  id: string;
  type: string;
  size: WidgetSize;
  show: WidgetShow;
  options: Record<string, any>;
}

/** What option choices and availability are computed from. */
export interface WidgetEnv {
  settings: any;
  // The per-request registry (res.locals.registry), carrying the collection's cosmetics.
  registry: any;
  t: (key: string, options?: any) => string;
  // The viewer's currency, for figures kept per currency (the value history).
  currency?: string;
}

export interface WidgetChoice {
  value: string;
  label: string;
}

export interface WidgetOption {
  key: string;
  type: 'select' | 'number' | 'boolean' | 'text' | 'textarea';
  label: string; // i18n key
  default: any;
  choices?: (env: WidgetEnv) => WidgetChoice[]; // select
  min?: number; // number
  max?: number; // number
  maxLength?: number; // text, textarea
}

export interface DashboardWidgetType {
  type: string;
  label: string; // i18n key
  description: string; // i18n key
  icon: string; // FontAwesome icon (e.g. 'fa-chart-simple')
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  options?: WidgetOption[];
  // Offered in the catalogue for this collection (a value widget needs a module that
  // can estimate prices). Widgets already placed keep rendering either way.
  isAvailable?: (env: WidgetEnv) => boolean;
  // Data for one instance; the partial receives it as `data`. The context memoises
  // what several widgets share (the collection's items, its counters).
  load?: (context: any, options: Record<string, any>, env: WidgetEnv) => Promise<any> | any;
  // Nothing to show right now (an empty info page): the widget is left out of the page,
  // and only drawn as a placeholder while the page is being arranged.
  isEmpty?: (data: any, options: Record<string, any>, locals: any) => boolean;
}

class DashboardWidgetRegistry {
  private types: Map<string, DashboardWidgetType> = new Map();

  register(type: DashboardWidgetType): void {
    this.types.set(type.type, type);
  }

  get(type: string): DashboardWidgetType | undefined {
    return this.types.get(type);
  }

  getAll(): DashboardWidgetType[] {
    return Array.from(this.types.values());
  }
}

export const dashboardWidgets = new DashboardWidgetRegistry();

const newWidgetId = () => crypto.randomBytes(5).toString('hex');
const WIDGET_ID = /^[a-z0-9-]{1,40}$/;

function normalizeOption(option: WidgetOption, raw: any, env: WidgetEnv): any {
  switch (option.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'on') return true;
      if (raw === 'false') return false;
      return option.default;
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
      if (!Number.isFinite(n)) return option.default;
      return Math.min(option.max ?? n, Math.max(option.min ?? n, Math.round(n)));
    }
    case 'select': {
      const values = (option.choices ? option.choices(env) : []).map(c => c.value);
      return values.includes(String(raw)) ? String(raw) : option.default;
    }
    case 'text':
    case 'textarea':
      return typeof raw === 'string' ? raw.slice(0, option.maxLength ?? 200) : option.default;
  }
}

/**
 * One widget as stored or posted, reduced to what its type declares: an unknown type is
 * dropped (null), and every size, placement and option outside what is offered falls
 * back to the type's default. Whatever passes ends up in classes and partial locals.
 */
export function normalizeWidget(raw: any, env: WidgetEnv): WidgetInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = dashboardWidgets.get(String(raw.type));
  if (!type) return null;
  const rawOptions = raw.options && typeof raw.options === 'object' ? raw.options : {};
  const options: Record<string, any> = {};
  for (const option of type.options || []) {
    options[option.key] = normalizeOption(option, rawOptions[option.key], env);
  }
  return {
    id: typeof raw.id === 'string' && WIDGET_ID.test(raw.id) ? raw.id : newWidgetId(),
    type: type.type,
    size: type.sizes.includes(raw.size) ? raw.size : type.defaultSize,
    show: (WIDGET_SHOW as readonly string[]).includes(raw.show) ? raw.show : 'all',
    options
  };
}

export function normalizeWidgets(raw: any, env: WidgetEnv): WidgetInstance[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_WIDGETS) : [];
  const seen = new Set<string>();
  const widgets: WidgetInstance[] = [];
  for (const entry of list) {
    const widget = normalizeWidget(entry, env);
    if (!widget) continue;
    if (seen.has(widget.id)) widget.id = newWidgetId();
    seen.add(widget.id);
    widgets.push(widget);
  }
  return widgets;
}

/**
 * The home page of a collection nobody has arranged yet: what the page always showed,
 * the stats being the ones picked in settings.statsWidgets. Ids are stable so a widget
 * can be fetched again on its own (the random pick's "another one") before anything
 * was saved.
 */
export function defaultWidgets(env: WidgetEnv): WidgetInstance[] {
  const topStats = new Set<string>();
  for (const plugin of env.registry.getAll()) {
    for (const stat of plugin.statsWidgets || []) if (stat.kind === 'top') topStats.add(stat.id);
  }
  const statIds: string[] = Array.isArray(env.settings?.statsWidgets) ? env.settings.statsWidgets : [];
  const raw: any[] = [
    { type: 'welcome', size: 'full' },
    { type: 'summary', size: 'full', show: 'phone' },
    { type: 'shortcuts', size: 'full', show: 'phone' },
    { type: 'info', size: 'full' },
    { type: 'latest', size: 'full' },
    { type: 'wishlist', size: 'full' },
    { type: 'heading', size: 'full' },
    ...statIds.map(stat => ({
      type: 'stat',
      // The total was a wide tile, and phones already open on it in the summary tiles.
      size: stat === 'total' ? 'm' : (topStats.has(stat) ? 'full' : 's'),
      show: stat === 'total' ? 'desktop' : 'all',
      options: { stat }
    }))
  ];
  return normalizeWidgets(raw.map((w, i) => ({ ...w, id: `${w.type}-${i}` })), env);
}

/** The collection's widgets: the arranged list when there is one, the defaults otherwise. */
export function resolveWidgets(env: WidgetEnv): WidgetInstance[] {
  const stored = env.settings?.dashboard?.widgets;
  return Array.isArray(stored) ? normalizeWidgets(stored, env) : defaultWidgets(env);
}

/** The catalogue the editor offers, with labels and choices resolved for this request. */
export function widgetCatalogue(env: WidgetEnv) {
  return dashboardWidgets.getAll()
    .filter(type => !type.isAvailable || type.isAvailable(env))
    .map(type => ({
      type: type.type,
      label: env.t(type.label),
      description: env.t(type.description),
      icon: type.icon,
      sizes: type.sizes,
      defaultSize: type.defaultSize,
      options: (type.options || []).map(option => ({
        key: option.key,
        type: option.type,
        label: env.t(option.label),
        default: option.default,
        min: option.min,
        max: option.max,
        maxLength: option.maxLength,
        choices: option.choices ? option.choices(env) : undefined
      }))
    }));
}
