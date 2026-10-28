import dns from 'dns/promises';
import net from 'net';
import webpush from 'web-push';
import { db } from './db';
import { all, and, eq, idOf, isId, isIn } from './db/query';
import { decryptSecret, encryptSecret } from './ai/secret';

/**
 * Web Push: notifications that reach a member's devices while DVinyl is closed. Each
 * browser that turns them on hands over a subscription (an endpoint on its vendor's push
 * service and two keys); the instance signs what it sends with its own VAPID keys, made
 * on first use, so there is no outside service to set up.
 *
 * Sends go through a small in-memory queue with a few spaced retries: the inbox line is
 * already written by then (core/notify.ts), so a restart costs at most a push.
 */

export const MAX_SUBSCRIPTIONS_PER_USER = 10;
const MAX_ENDPOINT = 1000;
const MAX_KEY = 200;
const MAX_LABEL = 60;
// Wait before each new try of a send that failed for a passing reason.
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
// A device that keeps failing without being reported gone is dropped after this many.
const MAX_FAILURES = 10;
const SEND_TIMEOUT_MS = 15_000;

// Set to anything but 'false' to prepare pushes without sending them (the test sandbox).
const dryRun = () => !!process.env.PUSH_DRY_RUN && process.env.PUSH_DRY_RUN !== 'false';

// ---------------------------------------------------------------------------------------
// The instance's keys
// ---------------------------------------------------------------------------------------

let vapid: { publicKey: string; privateKey: string; subject: string } | null = null;

/** Forgets the keys read earlier, after a restore replaced the instance settings. */
export function invalidateVapidCache(): void {
  vapid = null;
}

/** The instance's VAPID keys, made and stored the first time they are asked for. */
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string; subject: string }> {
  if (vapid) return vapid;
  const settings: any = await db.instanceSettings.updateAndGet(
    eq('key', 'instance'), { setOnInsert: { key: 'instance' } }, { upsert: true }
  );
  const publicKey = settings?.push?.publicKey || '';
  const privateKey = decryptSecret(settings?.push?.privateKeyEncrypted || '');
  const subject = settings?.push?.subject || '';
  if (publicKey && privateKey) {
    vapid = { publicKey, privateKey, subject };
    return vapid;
  }
  // None yet, or one that no longer decrypts (a restore from an instance with another
  // SESSION_SECRET): the devices subscribed under the old key cannot be reached anyway.
  const made = webpush.generateVAPIDKeys();
  await db.instanceSettings.updateOne(eq('key', 'instance'), {
    set: { push: { publicKey: made.publicKey, privateKeyEncrypted: encryptSecret(made.privateKey), subject } }
  }, { upsert: true });
  if (publicKey) await db.pushSubscriptions.deleteMany(all());
  vapid = { ...made, subject };
  return vapid;
}

/**
 * Keeps the HTTPS address the instance is reached at as the contact its pushes are
 * signed with. Called from the push routes, which a member only reaches through the
 * address they use; a plain HTTP or local address is never kept.
 */
export async function rememberPushOrigin(origin: string): Promise<void> {
  let url: URL;
  try { url = new URL(origin); } catch { return; }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) return;
  const keys = await vapidKeys();
  if (keys.subject === url.origin) return;
  await db.instanceSettings.updateOne(eq('key', 'instance'), { set: { 'push.subject': url.origin } });
  vapid = { ...keys, subject: url.origin };
}

// ---------------------------------------------------------------------------------------
// Where a push may be sent
// ---------------------------------------------------------------------------------------

// The push services of the browsers people use. An endpoint on one of them is taken as
// it is; any other host must resolve to public addresses only.
const KNOWN_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com'
];

function isKnownPushHost(host: string): boolean {
  return KNOWN_PUSH_HOSTS.some(known => host === known || host.endsWith('.' + known));
}

/** Whether an address is one of the public internet's, not this machine's or a local network's. */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff')) return false;
    return true;
  }
  return false;
}

/**
 * Whether the instance may send to this endpoint: HTTPS, and a host on the public
 * internet. A subscription is something a browser sends, so a forged one must not turn
 * the instance into a client of its own local network. Checked when a device subscribes
 * and again before each send, since a name can start resolving elsewhere.
 */
export async function isAllowedEndpoint(endpoint: string, resolve: (host: string) => Promise<string[]> = defaultResolve): Promise<boolean> {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host)) return isPublicAddress(host);
  if (isKnownPushHost(host)) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) return false;
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every(isPublicAddress);
  } catch {
    return false;
  }
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await dns.lookup(host, { all: true })).map(entry => entry.address);
}

// ---------------------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------------------

/** "Chrome · Android": enough to tell one's devices apart, nothing more. */
export function deviceLabel(userAgent: string): string {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const system = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return [browser, system].filter(Boolean).join(' · ').slice(0, MAX_LABEL);
}

/** A subscription as a browser sent it, checked and put in shape, or null. */
export function cleanSubscription(raw: any): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const endpoint = typeof raw?.endpoint === 'string' ? raw.endpoint.trim() : '';
  const p256dh = typeof raw?.keys?.p256dh === 'string' ? raw.keys.p256dh.trim() : '';
  const auth = typeof raw?.keys?.auth === 'string' ? raw.keys.auth.trim() : '';
  const base64url = /^[A-Za-z0-9_=-]+$/;
  if (!endpoint || endpoint.length > MAX_ENDPOINT) return null;
  if (!p256dh || !auth || p256dh.length > MAX_KEY || auth.length > MAX_KEY) return null;
  if (!base64url.test(p256dh) || !base64url.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export type SaveOutcome = { ok: true; id: string } | { ok: false; error: string };

/** Keeps a device's subscription for this member, taking it over from whoever had it. */
export async function saveSubscription(userId: any, raw: any, userAgent: string): Promise<SaveOutcome> {
  const subscription = cleanSubscription(raw);
  if (!subscription) return { ok: false, error: 'notifications.push.err_invalid' };
  if (!(await isAllowedEndpoint(subscription.endpoint))) return { ok: false, error: 'notifications.push.err_endpoint' };

  const me = idOf(userId);
  // One row per device: whoever subscribed it before on this browser lets it go.
  await db.pushSubscriptions.deleteMany(and(eq('endpoint', subscription.endpoint), eq('user', me)));
  const others = await db.pushSubscriptions.find(eq('endpoint', subscription.endpoint), { fields: ['_id'] });
  if (others.length) await db.pushSubscriptions.deleteMany(isIn('_id', others.map((s: any) => idOf(s._id))));

  if ((await db.pushSubscriptions.count(eq('user', me))) >= MAX_SUBSCRIPTIONS_PER_USER) {
    return { ok: false, error: 'notifications.push.err_too_many' };
  }
  const saved = await db.pushSubscriptions.create({ user: me, ...subscription, label: deviceLabel(userAgent) });
  return { ok: true, id: idOf(saved._id) };
}

export async function subscriptionsOf(userId: any): Promise<any[]> {
  return db.pushSubscriptions.find(eq('user', idOf(userId)), { defaults: true });
}

export async function ownSubscription(userId: any, id: unknown): Promise<any | null> {
  const subscriptionId = idOf(id);
  if (!isId(subscriptionId)) return null;
  return db.pushSubscriptions.findOne(and(eq('_id', subscriptionId), eq('user', idOf(userId))), { defaults: true });
}

export async function removeSubscription(userId: any, id: unknown): Promise<void> {
  const own = await ownSubscription(userId, id);
  if (own) await db.pushSubscriptions.deleteOne(eq('_id', idOf(own._id)));
}

export async function deleteSubscriptionsOf(userId: any): Promise<void> {
  await db.pushSubscriptions.deleteMany(eq('user', idOf(userId)));
}

// ---------------------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------------------

export const prefKey = (event: string) => String(event).replace(/\./g, '_');

/** Whether this member wants `event` on their devices. On unless switched off. */
export function wantsPush(user: any, event: string): boolean {
  return user?.notificationPrefs?.push?.[prefKey(event)] !== false;
}

// ---------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------

export type PushMessage = { title: string; body: string; url: string; tag?: string; icon?: string; unread?: number };

type Transport = (subscription: any, payload: string, options: any) => Promise<{ statusCode: number }>;
let transport: Transport = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);

/** Replaces what sends a push, for the tests. */
export function setPushTransport(next: Transport | null): void {
  transport = next || ((subscription, payload, options) => webpush.sendNotification(subscription, payload, options));
}

/**
 * Sends one push to one device. The device is dropped when its push service says it is
 * gone (404, 410), or after failing too many times in a row.
 */
export async function sendToDevice(subscription: any, message: PushMessage, attempt = 0): Promise<'sent' | 'gone' | 'failed' | 'dry'> {
  if (dryRun()) return 'dry';
  if (!(await isAllowedEndpoint(subscription.endpoint))) {
    await db.pushSubscriptions.deleteOne(eq('_id', idOf(subscription._id)));
    return 'gone';
  }
  const keys = await vapidKeys();
  try {
    await transport(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(message),
      {
        TTL: 24 * 3600,
        timeout: SEND_TIMEOUT_MS,
        urgency: 'normal',
        topic: message.tag ? message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : undefined,
        vapidDetails: { subject: vapidSubject(keys.subject), publicKey: keys.publicKey, privateKey: keys.privateKey }
      }
    );
    await db.pushSubscriptions.updateOne(eq('_id', idOf(subscription._id)), { set: { lastSuccessAt: new Date(), failures: 0 } });
    return 'sent';
  } catch (err: any) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) {
      await db.pushSubscriptions.deleteOne(eq('_id', idOf(subscription._id)));
      return 'gone';
    }
    const failures = (subscription.failures || 0) + 1;
    if (failures >= MAX_FAILURES) {
      await db.pushSubscriptions.deleteOne(eq('_id', idOf(subscription._id)));
      return 'gone';
    }
    await db.pushSubscriptions.updateOne(eq('_id', idOf(subscription._id)), { set: { failures } });
    // A refused payload will be refused again; only a passing failure is worth a retry.
    const passing = !status || status === 429 || status >= 500;
    const delay = RETRY_DELAYS_MS[attempt];
    if (passing && delay !== undefined) {
      setTimeout(() => {
        db.pushSubscriptions.findOne(eq('_id', idOf(subscription._id)), { defaults: true })
          .then(fresh => fresh ? sendToDevice(fresh, message, attempt + 1) : null)
          .catch(() => {});
      }, delay).unref();
    } else {
      let host = '';
      try { host = new URL(subscription.endpoint).host; } catch { /* kept empty */ }
      const reason = String(err?.body || err?.message || '').replace(/\s+/g, ' ').slice(0, 200);
      console.warn(`[PUSH] Send to ${host} failed (${status || 'no answer'}): ${reason || 'no reason given'}. Not retried.`);
    }
    return 'failed';
  }
}

/**
 * Who the push services can reach about this instance: PUSH_CONTACT when set (a mailto:
 * or https: address), otherwise the HTTPS address members turned push on from. The last
 * resort only ever serves a browser on this very machine, the one place push works
 * without HTTPS.
 */
export function vapidSubject(remembered = ''): string {
  const configured = (process.env.PUSH_CONTACT || '').trim();
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configured) || /^https:\/\/[^\s]+\.[^\s]+/.test(configured)) return configured;
  if (/^https:\/\//.test(remembered)) return remembered;
  const origin = (process.env.PUBLIC_URL || '').trim();
  return /^https:\/\//.test(origin) ? origin.replace(/\/+$/, '') : 'mailto:admin@localhost.localdomain';
}

/** Sends `message` to every device of a member, without waiting for the push services. */
export function pushToUser(userId: any, message: PushMessage): void {
  subscriptionsOf(userId)
    .then(devices => Promise.all(devices.map(device => sendToDevice(device, message))))
    .catch((err: any) => console.error('[PUSH]', err.message));
}
