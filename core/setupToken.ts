import crypto from 'crypto';

/**
 * Optional guard on a fresh instance.
 *
 * Until the first account exists, /setup creates an administrator for whoever fills it in,
 * and a backup restore does the same with the accounts the backup carries. On an instance
 * reachable from the internet, that is a window anyone can use before the owner does.
 * When SETUP_TOKEN is set, both doors ask for it; when it is not, nothing changes.
 *
 * It only ever matters while the instance has no account: afterwards neither door is open.
 */

/** The token the operator chose, or '' when the guard is off. */
function configuredToken(): string {
  return String(process.env.SETUP_TOKEN || '').trim();
}

export function setupTokenRequired(): boolean {
  return configuredToken() !== '';
}

/**
 * Whether a submitted value unlocks setup. Compared through fixed-length digests so the
 * time it takes says nothing about how much of the token was right.
 */
export function setupTokenAccepted(given: unknown): boolean {
  const expected = configuredToken();
  if (!expected) return true;
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  const submitted = typeof given === 'string' ? given.trim() : '';
  return crypto.timingSafeEqual(digest(submitted), digest(expected));
}
