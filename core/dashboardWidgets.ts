import { registry } from './registry';
import { db } from './db';
import { and, asc, desc, eq, idOf } from './db/query';
import { shelfFilter } from '../utils/visibilityHelper';
import { resolveShelfItems } from '../utils/itemHelpers';
import { dashboardWidgets, WidgetChoice, WidgetEnv, WidgetOption } from './dashboard';
import { renderMarkdown } from './markdown';
import { isCollectionInfoVisible } from './collectionInfo';

/**
 * The built-in home page widgets, and the per-request context their data comes from.
 * Each type renders views/partials/dashboard/widgets/<type>.ejs with the `data` its
 * load() returns. See core/dashboard.ts for the contract.
 */

/**
 * What several widgets share, fetched at most once per request whatever the number of
 * widgets asking for it: the collection's items, its counters, the stats.
 */
export function createDashboardContext(res: any) {
  const settings = res.locals.settings;
  const collectionId = res.locals.activeCollectionId;
  const shelf = (inWishlist: boolean) => shelfFilter({
    collectionId,
    inWishlist,
    isAdmin: res.locals.isCollectionAdmin,
    settings
  });
  const owned = shelf(false);
  const wished = shelf(true);
  const memo = new Map<string, Promise<any>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!memo.has(key)) memo.set(key, load());
    return memo.get(key) as Promise<T>;
  };

  const ownedItems = () => once('owned', () => db.items.find(owned) as Promise<any[]>);

  return {
    settings,
    collectionId,
    ownedItems,
    // Same figures as the stats the dashboard always showed: the total, then whatever
    // each enabled plugin computes over its own items.
    stats: () => once('stats', async () => {
      const items = await ownedItems();
      const stats: Record<string, any> = { total: items.reduce((acc, i) => acc + (i.quantity || 1), 0) };
      for (const plugin of registry.getEnabled(settings)) {
        Object.assign(stats, plugin.getStats(items.filter(i => i.kind === plugin.kind)));
      }
      return stats;
    }),
    wishlistCount: () => once('wishlistCount', () => db.items.count(wished)),
    listsCount: () => once('listsCount', () => db.lists.count(eq('collection', idOf(collectionId)))),
    // The newest items of the shelf or the wishlist, ready for the card partials.
    latest: (inWishlist: boolean, limit: number, kind: string) =>
      once(`latest:${inWishlist}:${limit}:${kind}`, async () => {
        const filter = and(inWishlist ? wished : owned, kind ? eq('kind', kind) : null);
        return forView(await db.items.find(filter, { sort: [desc('added_at')], limit }), res);
      }),
    forView: (items: any[]) => forView(items, res)
  };
}

async function forView(items: any[], res: any): Promise<any[]> {
  const resolved = await resolveShelfItems(items, res) as any[];
  return resolved.map(item => {
    const plugin = registry.getByKind(item.kind as any);
    return plugin ? plugin.formatForView(item) : item;
  });
}

// ---- Shared option declarations ----------------------------------------------

const typeChoices = (env: WidgetEnv): WidgetChoice[] => [
  { value: '', label: env.t('dashboard.option_type_all') },
  ...env.registry.getEnabled(env.settings).map((p: any) => ({ value: p.kind, label: env.t(p.label) }))
];

const typeOption: WidgetOption = { key: 'type', type: 'select', label: 'dashboard.option_type', default: '', choices: typeChoices };

const countOption = (fallback: number, max = 24): WidgetOption =>
  ({ key: 'count', type: 'number', label: 'dashboard.option_count', default: fallback, min: 1, max });

const quantityOf = (item: any) => item.quantity || 1;

// ---- The widgets --------------------------------------------------------------

dashboardWidgets.register({
  type: 'welcome',
  label: 'dashboard.w_welcome',
  description: 'dashboard.w_welcome_desc',
  icon: 'fa-hand',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full',
  options: [
    { key: 'search', type: 'boolean', label: 'dashboard.option_search', default: true },
    { key: 'actions', type: 'boolean', label: 'dashboard.option_actions', default: true }
  ]
});

dashboardWidgets.register({
  type: 'summary',
  label: 'dashboard.w_summary',
  description: 'dashboard.w_summary_desc',
  icon: 'fa-table-cells-large',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full',
  load: async (context) => {
    const [stats, wishlistCount, listsCount] = await Promise.all([context.stats(), context.wishlistCount(), context.listsCount()]);
    return { total: stats.total, wishlistCount, listsCount };
  }
});

dashboardWidgets.register({
  type: 'stat',
  label: 'dashboard.w_stat',
  description: 'dashboard.w_stat_desc',
  icon: 'fa-chart-simple',
  sizes: ['s', 'm', 'l', 'full'],
  defaultSize: 's',
  options: [{
    key: 'stat',
    type: 'select',
    label: 'dashboard.option_stat',
    default: 'total',
    choices: (env) => [
      { value: 'total', label: env.t('stats.total_label') },
      ...env.registry.getEnabled(env.settings).flatMap((p: any) =>
        (p.statsWidgets || []).map((w: any) => ({ value: w.id, label: `${env.t(p.label)} · ${env.t(w.label)}` })))
    ]
  }],
  load: async (context, options) => {
    const stats = await context.stats();
    if (options.stat === 'total') {
      return { kind: 'count', label: 'stats.total_label', icon: 'fa-database', color: 'bg-primary-theme/20', text: '', value: stats.total, unit: true };
    }
    const declared = registry.getAll().flatMap(p => p.statsWidgets || []).find(w => w.id === options.stat);
    if (!declared) return null;
    return { ...declared, value: stats[declared.id] };
  }
});

dashboardWidgets.register({
  type: 'latest',
  label: 'dashboard.w_latest',
  description: 'dashboard.w_latest_desc',
  icon: 'fa-clock-rotate-left',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full',
  options: [countOption(4), typeOption],
  // A phone shows them as a sideways row, which only reads as one past a screen's width.
  load: async (context, options) => context.latest(false, Math.max(options.count, 10), options.type)
});

dashboardWidgets.register({
  type: 'wishlist',
  label: 'dashboard.w_wishlist',
  description: 'dashboard.w_wishlist_desc',
  icon: 'fa-heart',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full',
  options: [countOption(4), typeOption],
  load: async (context, options) => context.latest(true, options.count, options.type)
});

dashboardWidgets.register({
  type: 'shortcuts',
  label: 'dashboard.w_shortcuts',
  description: 'dashboard.w_shortcuts_desc',
  icon: 'fa-link',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full'
});

dashboardWidgets.register({
  type: 'info',
  label: 'dashboard.w_info',
  description: 'dashboard.w_info_desc',
  icon: 'fa-circle-info',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full',
  isEmpty: (_data, _options, locals) => !isCollectionInfoVisible(locals.activeCollection, locals.isShareView)
});

dashboardWidgets.register({
  type: 'heading',
  label: 'dashboard.w_heading',
  description: 'dashboard.w_heading_desc',
  icon: 'fa-heading',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'full',
  // Left empty, it reads the stats section's usual title in the viewer's language.
  options: [{ key: 'text', type: 'text', label: 'dashboard.option_title', default: '', maxLength: 80 }]
});

dashboardWidgets.register({
  type: 'breakdown',
  label: 'dashboard.w_breakdown',
  description: 'dashboard.w_breakdown_desc',
  icon: 'fa-chart-bar',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'm',
  options: [
    {
      key: 'by', type: 'select', label: 'dashboard.option_by', default: 'type',
      choices: (env) => [
        { value: 'type', label: env.t('dashboard.by_type') },
        { value: 'format', label: env.t('dashboard.by_format') }
      ]
    },
    typeOption,
    { key: 'rows', type: 'number', label: 'dashboard.option_rows', default: 6, min: 3, max: 12 }
  ],
  // Copies held, not entries: a record owned twice weighs twice, as in the total.
  load: async (context, options, env) => {
    const items = (await context.ownedItems()).filter((i: any) => !options.type || i.kind === options.type);
    const groups = new Map<string, number>();
    for (const item of items) {
      const plugin = registry.getByKind(item.kind);
      let key = plugin ? env.t(plugin.label) : String(item.kind || '?');
      if (options.by === 'format') {
        const value = item.format || item.media_type || '';
        const format = plugin && (plugin.formats || []).find(f => String(f.value) === String(value));
        key = format ? env.t(format.label, { defaultValue: format.label }) : (value || key);
      }
      groups.set(key, (groups.get(key) || 0) + quantityOf(item));
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
    const rows = sorted.slice(0, options.rows).map(([label, count]) => ({ label, count }));
    const rest = sorted.slice(options.rows).reduce((acc, [, count]) => acc + count, 0);
    if (rest > 0) rows.push({ label: env.t('dashboard.other'), count: rest });
    return { rows, total: sorted.reduce((acc, [, count]) => acc + count, 0) };
  }
});

dashboardWidgets.register({
  type: 'timeline',
  label: 'dashboard.w_timeline',
  description: 'dashboard.w_timeline_desc',
  icon: 'fa-chart-column',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'l',
  options: [
    {
      key: 'months', type: 'select', label: 'dashboard.option_months', default: '12',
      choices: (env) => ['6', '12', '24'].map(value => ({ value, label: env.t('dashboard.months_n', { count: Number(value) }) }))
    },
    typeOption
  ],
  // Entries added per month, oldest first, months with nothing included so the gaps show.
  load: async (context, options) => {
    const months = Number(options.months);
    const now = new Date();
    const buckets: { year: number; month: number; count: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ year: d.getFullYear(), month: d.getMonth(), count: 0 });
    }
    const first = buckets[0]!;
    for (const item of await context.ownedItems()) {
      if (options.type && item.kind !== options.type) continue;
      const added = item.added_at ? new Date(item.added_at) : null;
      if (!added || Number.isNaN(added.getTime())) continue;
      const index = (added.getFullYear() - first.year) * 12 + added.getMonth() - first.month;
      if (index >= 0 && index < buckets.length) buckets[index]!.count++;
    }
    return { buckets, total: buckets.reduce((acc, b) => acc + b.count, 0) };
  }
});

dashboardWidgets.register({
  type: 'random',
  label: 'dashboard.w_random',
  description: 'dashboard.w_random_desc',
  icon: 'fa-shuffle',
  sizes: ['s', 'm', 'l'],
  defaultSize: 'm',
  options: [typeOption],
  load: async (context, options) => {
    const items = (await context.ownedItems()).filter((i: any) => !options.type || i.kind === options.type);
    if (items.length === 0) return null;
    const [item] = await context.forView([items[Math.floor(Math.random() * items.length)]]);
    return item;
  }
});

dashboardWidgets.register({
  type: 'creators',
  label: 'dashboard.w_creators',
  description: 'dashboard.w_creators_desc',
  icon: 'fa-ranking-star',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'm',
  options: [typeOption, { key: 'rows', type: 'number', label: 'dashboard.option_rows', default: 5, min: 3, max: 12 }],
  load: async (context, options) => {
    const counts = new Map<string, number>();
    for (const item of await context.ownedItems()) {
      if (options.type && item.kind !== options.type) continue;
      const plugin = registry.getByKind(item.kind);
      const raw = plugin ? item[plugin.creatorField] : '';
      const name = (Array.isArray(raw) ? raw.join(', ') : String(raw || '')).trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + quantityOf(item));
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, options.rows).map(([label, count]) => ({ label, count }));
    return { rows };
  }
});

dashboardWidgets.register({
  type: 'value',
  label: 'dashboard.w_value',
  description: 'dashboard.w_value_desc',
  icon: 'fa-coins',
  sizes: ['s', 'm', 'l'],
  defaultSize: 'm',
  isAvailable: (env) => env.registry.getEnabled(env.settings).some((p: any) => p.supportsPriceEstimate),
  // The snapshots the collection's estimates left, in the viewer's own currency only:
  // nothing converts between currencies, so mixing them would draw a trend that never was.
  load: async (context, _options, env) => {
    const currency = env.currency || 'USD';
    const snapshots = await db.priceHistory.find(
      and(eq('collection', idOf(context.collectionId)), eq('currency', currency)),
      { sort: [asc('capturedAt')], fields: ['capturedAt', 'value', 'itemCount'] }
    ) as any[];
    return { currency, snapshots: snapshots.slice(-30).map(s => ({ at: s.capturedAt, value: s.value, items: s.itemCount })) };
  }
});

dashboardWidgets.register({
  type: 'lists',
  label: 'dashboard.w_lists',
  description: 'dashboard.w_lists_desc',
  icon: 'fa-list-ul',
  sizes: ['m', 'l', 'full'],
  defaultSize: 'm',
  options: [countOption(5, 12)],
  load: async (context, options) => {
    const lists = await db.lists.find(eq('collection', idOf(context.collectionId)), { sort: [desc('updated_at')], limit: options.count }) as any[];
    return lists.map(l => ({ id: String(l._id), name: l.name, kind: l.kind, count: (l.entries || []).length }));
  }
});

dashboardWidgets.register({
  type: 'note',
  label: 'dashboard.w_note',
  description: 'dashboard.w_note_desc',
  icon: 'fa-note-sticky',
  sizes: ['s', 'm', 'l', 'full'],
  defaultSize: 'm',
  options: [
    { key: 'title', type: 'text', label: 'dashboard.option_title', default: '', maxLength: 80 },
    { key: 'body', type: 'textarea', label: 'dashboard.option_body', default: '', maxLength: 4000 }
  ],
  load: (_context, options) => ({ html: renderMarkdown(options.body) }),
  isEmpty: (data, options) => !data.html && !options.title
});
