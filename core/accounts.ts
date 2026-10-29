/**
 * Signing in with a local account.
 */

import bcrypt from 'bcrypt';
import { db } from './db';
import { ci, eq } from './db/query';

/**
 * The account a sign-in identifier names: its email or its username. Emails are stored
 * lowercased, so the typed address is too; an email match wins over a username spelled
 * like an address. A username is matched as typed first, then ignoring case, since a
 * phone keyboard capitalises its first letter; ignoring case only counts when it names
 * a single account, two of them spelled apart by case keep needing the exact spelling.
 * Null when it names none.
 */
export async function findByLoginIdentifier(identifier: unknown): Promise<any | null> {
  const id = String(identifier || '').trim();
  if (!id) return null;
  const exact = await db.users.findOne(eq('email', id.toLowerCase()), { defaults: true })
    || await db.users.findOne(eq('username', id), { defaults: true });
  if (exact) return exact;
  const loose = await db.users.find(ci('username', id), { defaults: true, limit: 2 });
  return loose.length === 1 ? loose[0] : null;
}

/**
 * The account behind an identifier (email or username) and its password. Throws
 * 'incorrect email' when no account matches and 'incorrect password' otherwise, which
 * the login controller turns into its messages.
 */
export async function login(identifier: unknown, password: string): Promise<any> {
  const user = await findByLoginIdentifier(identifier);
  if (!user) throw Error('incorrect email');
  // SSO-only accounts have no local password: reject the password path cleanly instead
  // of letting bcrypt.compare throw on an undefined hash. These users must authenticate
  // through their identity provider.
  if (!user.password || !(await bcrypt.compare(password, user.password))) {
    throw Error('incorrect password');
  }
  return user;
}
