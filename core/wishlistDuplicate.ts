import { PluginDefinition } from './types';
import { db } from './db';
import { and, ci, eq, idOf } from './db/query';

/**
 * Duplicate check for an add or an import targeting the wishlist.
 *
 * The plugins' own findDuplicate answers "do I already own this?": it looks at owned
 * items only. Reusing it here would let a copy sitting in the collection cancel its
 * wishlist entry, when the two are deliberately separate lists. The generic rule below
 * mirrors what the plugin declares: same title, same creator, same distinguishing
 * fields, among wishlist items.
 */
export async function findWishlistDuplicate(plugin: PluginDefinition, collectionId: any, data: Record<string, any>): Promise<any | null> {
  const creator = String(data[plugin.creatorField] || '').trim();
  return db.items.findOne(and(
    eq('collection', idOf(collectionId)),
    eq('kind', plugin.kind),
    eq('in_wishlist', true),
    ci('title', String(data.title || '').trim()),
    creator ? ci(plugin.creatorField, creator) : null,
    ...(plugin.duplicateCheckFields || []).map(field => {
      const value = data[field];
      return typeof value === 'string' && value.trim() ? ci(field, value.trim()) : null;
    })
  ), { defaults: true });
}
