/**
 * Collections name their members by account id. These put the accounts themselves in
 * place, for the pages that show who is in a collection.
 */

import { db } from './db';
import { idOf, isIn } from './db/query';

/**
 * Replaces each member's account id with the account (only `fields`, plus its id), on
 * every given collection. A member whose account is gone gets null, which the admin
 * pages filter out.
 */
export async function withMemberAccounts<T extends { members?: any[] }>(collections: T[], fields: string[]): Promise<T[]> {
  const ids = [...new Set(collections.flatMap(c => (c.members || []).map(m => idOf(m.user))).filter(Boolean))];
  const accounts = ids.length > 0 ? await db.users.find(isIn('_id', ids), { fields }) : [];
  const byId = new Map(accounts.map((a: any) => [idOf(a._id), a]));
  for (const collection of collections) {
    collection.members = (collection.members || []).map(m => ({ ...m, user: byId.get(idOf(m.user)) ?? null }));
  }
  return collections;
}
