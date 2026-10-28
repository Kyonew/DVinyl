import { db } from './db';
import { eq, idOf } from './db/query';
import { notify } from './notify';

/**
 * Whether a newer DVinyl has been released. Off by default: once an admin turns it on,
 * the instance asks GitHub for its latest release once a day, and the instance's admins
 * are told about each new one, once.
 */

const REPOSITORY = 'Kyonew/DVinyl';
// UPDATE_CHECK_URL stands in for GitHub in the tests, which never reach the network.
const latestRelease = () => process.env.UPDATE_CHECK_URL || `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 10_000;

const currentVersion = (): string => require('../package.json').version;

/** The numbers of a version, without a leading v or what follows a dash. */
function parts(version: string): number[] | null {
  const match = String(version || '').trim().replace(/^v/i, '').split('-')[0]!.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

/** Whether `candidate` is a later version than `current`. Anything unreadable is not. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}

/** A release page of this repository, or the list of them when GitHub names another. */
function releaseUrl(value: unknown): string {
  const url = String(value || '');
  return url.startsWith(`${RELEASES_PAGE}/`) ? url : RELEASES_PAGE;
}

async function stored(): Promise<any> {
  const doc = await db.instanceSettings.findOne(eq('key', 'instance'), { fields: ['updateCheck'] });
  return doc?.updateCheck || {};
}

/** What the instance admin page shows. */
export async function updateStatus() {
  const check = await stored();
  const current = currentVersion();
  return {
    enabled: check.enabled === true,
    current,
    latest: check.latest || '',
    url: releaseUrl(check.url),
    checkedAt: check.checkedAt || null,
    available: !!check.latest && isNewer(check.latest, current)
  };
}

export async function setUpdateCheck(enabled: boolean): Promise<void> {
  await db.instanceSettings.updateOne(eq('key', 'instance'), { set: { 'updateCheck.enabled': enabled } }, { upsert: true });
}

type Fetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/**
 * Asks GitHub for the latest release, when the check is on, and tells the admins about
 * it if it is newer than this instance and they have not been told yet. Never throws:
 * a release missed today is caught tomorrow.
 */
export async function checkForUpdate(fetchRelease: Fetch = fetch as any): Promise<void> {
  try {
    const check = await stored();
    if (check.enabled !== true) return;
    const current = currentVersion();
    const response = await fetchRelease(latestRelease(), {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `DVinyl/${current}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) {
      console.warn(`[UPDATE] GitHub answered ${response.status}, checked again tomorrow.`);
      return;
    }
    const release = await response.json();
    const latest = String(release?.tag_name || '').replace(/^v/i, '');
    if (!parts(latest)) return;
    const url = releaseUrl(release?.html_url);
    await db.instanceSettings.updateOne(eq('key', 'instance'), {
      set: { 'updateCheck.latest': latest, 'updateCheck.url': url, 'updateCheck.checkedAt': new Date() }
    });
    if (!isNewer(latest, current) || check.notified === latest) return;
    const admins = await db.users.find(eq('isAdmin', true), { fields: ['_id'] });
    await notify({
      event: 'instance.update_available',
      to: admins.map((u: any) => idOf(u._id)),
      payload: { version: latest, current },
      link: '/admin/instance#updates'
    });
    await db.instanceSettings.updateOne(eq('key', 'instance'), { set: { 'updateCheck.notified': latest } });
    console.log(`[UPDATE] DVinyl ${latest} is out (this instance runs ${current}).`);
  } catch (err: any) {
    console.warn('[UPDATE] Check failed:', err?.message || err);
  }
}
