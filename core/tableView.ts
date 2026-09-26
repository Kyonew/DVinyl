import { CollectionView } from './types';

/**
 * The collection read as rows instead of covers.
 *
 * Deliberately the plainest view in the registry: no cover art, no per-item
 * measuring, nothing beyond the fields the grid card body already resolves through
 * getCardLines. That is what makes it the cheapest one to draw on a large
 * collection or a slow connection, which is the whole reason someone reaches for it.
 */
export const TABLE_VIEW: CollectionView = {
  id: 'table',
  label: 'collection.view_table',
  icon: 'fa-table-list',
  order: 15,
  partial: 'partials/albums-table',
  paginates: 'items',
  liveRedraw: true
};
