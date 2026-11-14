import { db } from './db';
import { all, and, eq, idOf } from './db/query';
import { buildSortTitle } from './helpers';
import { forgetAllSortArticles, rememberSortArticles, sortArticlesFor } from './sortArticles';
import { allCreatorFields, sortCreatorOf } from './sortCreators';

/** Reads every collection's choice of articles into memory, replacing what was there. */
export async function loadSortArticles(): Promise<void> {
  const settings = await db.settings.find(all(), { fields: ['collection', 'sortArticles'] });
  forgetAllSortArticles();
  for (const doc of settings as any[]) rememberSortArticles(doc.collection, doc.sortArticles);
}

/**
 * Brings every stored sort key (title and creator) in line with its collection's articles
 * and its type's creator field, and returns how many items it rewrote. Run at boot, after
 * a restore, when a collection changes its list and when a type is registered while the
 * app runs: the keys are only derived on a write, so the items already there would
 * otherwise keep sorting the old way.
 */
export async function reconcileSortTitles(collectionId?: unknown, kind?: string): Promise<number> {
  await loadSortArticles();

  const scope = [
    ...(collectionId == null ? [] : [eq('collection', idOf(collectionId))]),
    ...(kind ? [eq('kind', kind)] : [])
  ];
  const filter = scope.length === 0 ? all() : scope.length === 1 ? scope[0]! : and(...scope);
  const fields = ['title', 'sort_title', 'sort_creator', 'collection', 'kind', ...allCreatorFields()];
  const items = await db.items.find(filter, { fields });

  const changes: { id: any; patch: any }[] = [];
  for (const item of items as any[]) {
    const articles = sortArticlesFor(item.collection);
    const set: Record<string, string> = {};
    const title = buildSortTitle(item.title, articles);
    if (item.sort_title !== title) set.sort_title = title;
    const creator = sortCreatorOf(item, articles);
    if ((item.sort_creator ?? '') !== creator) set.sort_creator = creator;
    if (Object.keys(set).length > 0) changes.push({ id: item._id, patch: { set } });
  }
  if (changes.length > 0) await db.items.updateEach(changes);
  return changes.length;
}
