import { db } from './db';
import { and, eq, idOf, isIn, or } from './db/query';
import { buildSortTitle } from './helpers';
import { legacySource, legacyIdFieldFor } from './sources';
import { PluginDefinition } from './types';
import { registry } from './registry';
import { pluginKindFilter, shelfFilter } from '../utils/visibilityHelper';

/** Someone who wishes for a record found in a search, and in which collection. */
export interface MemberWish {
  /** Display name of whoever added the wish, or null when it is the reader's own. */
  member: string | null;
  collection: string;
  /** True for the very release; false for the same title by the same creator. */
  exact: boolean;
}

// The creator as two spellings of one name compare: no case, no accents, no leading
// "The" ("The Beatles" and "Beatles"), no spacing differences.
const foldCreator = (value: unknown): string => buildSortTitle(Array.isArray(value) ? value.join(', ') : String(value ?? ''));

/**
 * For each candidate (a search result, the release on a confirm page), the wishes for it
 * held in the wishlists of every collection the reader belongs to.
 *
 * Only those collections, and in each only what its wishlist page shows this reader (its
 * visibility rules for their role, its types switched on): a search shows nothing the
 * wishlist page itself would not.
 * A wish that names a release (it came from a source, so it carries that source's id)
 * matches that release only: whoever picked one pressing wants that one, and marking
 * every other pressing of the album would bury it. A wish entered by hand, which names
 * no release, matches the same title by the same creator, flagged as a near match.
 */
export async function memberWishesFor(
  plugin: PluginDefinition,
  userId: any,
  candidates: Record<string, any>[]
): Promise<MemberWish[][]> {
  const empty = candidates.map(() => [] as MemberWish[]);
  if (!userId || candidates.length === 0) return empty;

  const collections = await db.collections.find(eq('members.user', idOf(userId)), { fields: ['name', 'members'] });
  if (collections.length === 0) return empty;
  const collectionName = new Map(collections.map((c: any) => [String(c._id), String(c.name || '')]));
  const reader: any = await db.users.findById(idOf(userId), { fields: ['isAdmin'] });
  const settingsDocs = await db.settings.find(isIn('collection', collections.map((c: any) => idOf(c._id))));
  const settingsOf = new Map(settingsDocs.map((s: any) => [String(s.collection), s]));
  // Each collection's wishlist as its page shows it to this reader. A collection nobody
  // has opened yet has no settings record; the defaults apply, as on the search page.
  const visibleWishlists = collections.map((c: any) => {
    const role = (c.members || []).find((m: any) => String(m.user) === String(userId))?.role;
    return shelfFilter({
      collectionId: c._id,
      inWishlist: true,
      isAdmin: !!reader?.isAdmin || role === 'admin',
      settings: settingsOf.get(String(c._id)) || { modules: registry.getDefaultModules() },
      // A wish kept in a box is still wished for, as the search finds it too.
      keepInside: true
    });
  });

  const fallback = legacySource(plugin);
  const legacyField = legacyIdFieldFor(plugin, fallback);
  const wishes = await db.items.find(and(
    or(...visibleWishlists),
    pluginKindFilter(plugin)
  ), { fields: ['title', 'sort_title', plugin.creatorField, 'source', 'source_id', 'owner', 'collection', ...(legacyField ? [legacyField] : [])] });
  if (wishes.length === 0) return empty;

  const ownerIds = [...new Set(wishes.map((w: any) => String(w.owner)).filter(id => id && id !== String(userId)))];
  const owners = ownerIds.length > 0 ? await db.users.find(isIn('_id', ownerIds.map(idOf)), { fields: ['username'] }) : [];
  const ownerName = new Map(owners.map((u: any) => [String(u._id), String(u.username || '')]));

  const sourceKey = (source: unknown, id: unknown) => (source && id !== undefined && id !== null && id !== '' ? `${source}\u0000${id}` : '');
  const wishKeys = wishes.map((wish: any) => ({
    wish,
    exact: new Set([
      sourceKey(wish.source, wish.source_id),
      // An item from before the source pair still carries its plugin's own id.
      legacyField && fallback ? sourceKey(fallback.id, wish[legacyField]) : ''
    ].filter(Boolean)),
    near: `${wish.sort_title || buildSortTitle(wish.title)}\u0000${foldCreator(wish[plugin.creatorField])}`
  }));

  return candidates.map(candidate => {
    const id = candidate.source_id ?? candidate.id;
    const exactKey = sourceKey(candidate.source, id);
    const creator = foldCreator(candidate[plugin.creatorField] ?? candidate.creator);
    const nearKey = creator ? `${buildSortTitle(candidate.title)}\u0000${creator}` : '';

    const hits: MemberWish[] = [];
    const seen = new Set<string>();
    for (const { wish, exact, near } of wishKeys) {
      const isExact = !!exactKey && exact.has(exactKey);
      const namesRelease = exact.size > 0;
      if (!isExact && (namesRelease || !nearKey || near !== nearKey)) continue;
      const owner = String(wish.owner);
      const member = owner === String(userId) ? null : (ownerName.get(owner) || null);
      const collection = collectionName.get(String(wish.collection)) || '';
      const key = `${owner}\u0000${collection}`;
      if (seen.has(key)) {
        // One person, one collection: the exact match wins over a near one.
        if (isExact) hits.forEach(h => { if (h.collection === collection && (h.member ?? '') === (member ?? '')) h.exact = true; });
        continue;
      }
      seen.add(key);
      hits.push({ member, collection, exact: isExact });
    }
    // The very release first, then the reader's own wishes last.
    return hits.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(a.member === null) - Number(b.member === null));
  });
}
