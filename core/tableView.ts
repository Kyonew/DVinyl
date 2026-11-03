import { CollectionView, PluginDefinition } from './types';

/**
 * The collection read as rows instead of covers.
 *
 * Deliberately the plainest view in the registry: no cover art, no per-item measuring,
 * only stored fields. That is what makes it the cheapest one to draw on a large
 * collection or a slow connection, which is the whole reason someone reaches for it.
 * With a type selected, each field its collection chose is a column of its own (see
 * core/cardFields.ts); showing every type, the rows fall back to one column of card lines.
 */
export const TABLE_VIEW: CollectionView = {
  id: 'table',
  label: 'collection.view_table',
  icon: 'fa-table-list',
  order: 15,
  partial: 'partials/albums-table',
  paginates: 'items',
  liveRedraw: true,

  // Decorated, since the columns are per collection.
  buildData: async ({ res }, base) => ({
    tablePlugin: res.locals.registry.getEnabled(base.settings).find((p: PluginDefinition) => p.id === base.currentType)
  })
};
