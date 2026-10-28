import { db } from './db';
import { and, desc, eq, idOf } from './db/query';
import { notify } from './notify';
import { deviceLabel } from './push';

/**
 * What a member is told about their own account: a sign-in from somewhere it has never
 * signed in from, and a lock after too many wrong passwords. Both lead to the settings,
 * where the password is changed.
 */

// How far back a sign-in counts as one the account has already made.
const KNOWN_LOGINS = 200;

/**
 * Whether a sign-in comes from a browser and country this account has never signed in
 * from. An account with no sign-in yet has nothing to compare with, and is not warned.
 * Asked before the sign-in itself is written down.
 */
export async function isUnfamiliarLogin(userId: any, userAgent: string, country: string): Promise<boolean> {
  const earlier = await db.loginLogs.find(
    and(eq('user', idOf(userId)), eq('status', 'success')),
    { sort: [desc('timestamp')], limit: KNOWN_LOGINS, fields: ['userAgent', 'country'] }
  );
  if (earlier.length === 0) return false;
  const device = deviceLabel(userAgent);
  return !earlier.some((log: any) => deviceLabel(log.userAgent) === device && (log.country || 'XX') === (country || 'XX'));
}

export function noticeNewLogin(userId: any, details: { userAgent: string; country: string; city: string; ip: string }): Promise<void> {
  return notify({
    event: 'account.new_login',
    to: [userId],
    payload: {
      device: deviceLabel(details.userAgent),
      country: details.country || 'XX',
      city: details.city || '',
      ip: details.ip
    },
    link: '/settings'
  });
}

export function noticeLocked(userId: any, ip: string): Promise<void> {
  return notify({ event: 'account.locked', to: [userId], payload: { ip }, link: '/settings' });
}
