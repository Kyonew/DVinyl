import { db } from './db';
import { all, eq, idOf } from './db/query';
import { buildSortTitle } from './helpers';
import { forgetAllSortArticles, rememberSortArticles, sortArticlesFor } from './sortArticles';

/** Reads every collection's choice of articles into memory, replacing what was there. */
export async function loadSortArticles(): Promise<void> {
  const settings = await db.settings.find(all(), { fields: ['collection', 'sortArticles'] });
  forgetAllSortArticles();
  for (const doc of settings as any[]) rememberSortArticles(doc.collection, doc.sortArticles);
}

/**
 * Brings every stored sort key in line with its collection's articles, and returns how
 * many it rewrote. Run at boot, after a restore and when a collection changes its list:
 * the key is only derived on a write, so the items already there would otherwise keep
 * sorting the old way.
 */
export async function reconcileSortTitles(collectionId?: unknown): Promise<number> {
  await loadSortArticles();

  const filter = collectionId == null ? all() : eq('collection', idOf(collectionId));
  const items = await db.items.find(filter, { fields: ['title', 'sort_title', 'collection'] });

  const changes: { id: any; patch: any }[] = [];
  for (const item of items as any[]) {
    const wanted = buildSortTitle(item.title, sortArticlesFor(item.collection));
    if (item.sort_title !== wanted) changes.push({ id: item._id, patch: { set: { sort_title: wanted } } });
  }
  if (changes.length > 0) await db.items.updateEach(changes);
  return changes.length;
}
