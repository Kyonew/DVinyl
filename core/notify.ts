import jwt from 'jsonwebtoken';
import i18next from 'i18next';
import { db } from './db';
import { and, desc, eq, idOf, isId, isIn, range } from './db/query';
import { BASE_URL } from '../config/constants';
import { pushToUser, wantsPush } from './push';
import { itemImageUrl } from './itemImageStorage';

/**
 * The one way the core tells a member something happened: notify() writes a line to the
 * inbox of each recipient, sends the new unread count to their open pages, then pushes it
 * to the devices they turned push on for (core/push.ts). The rest of the core calls it
 * without knowing which channels exist.
 */

/**
 * What each event looks like in the inbox. Its text is notifications.events.<event>, and
 * the settings page lists it under notifications.groups.<group>. An event marked
 * `instanceAdmin` only ever reaches the instance's admins, so nobody else is offered it.
 */
export type NotificationEvent = { icon: string; group: string; instanceAdmin?: boolean };
export const NOTIFICATION_EVENTS: Record<string, NotificationEvent> = {
  'request.received': { icon: 'inbox', group: 'requests' },
  'request.accepted': { icon: 'circle-check', group: 'requests' },
  'request.declined': { icon: 'circle-xmark', group: 'requests' },
  'request.cancelled': { icon: 'ban', group: 'requests' },
  'request.step': { icon: 'forward-step', group: 'requests' },
  'request.overdue': { icon: 'clock', group: 'requests' },
  'request.item_removed': { icon: 'trash-can', group: 'requests' },
  'wishlist.added': { icon: 'star', group: 'collection' },
  'account.new_login': { icon: 'right-to-bracket', group: 'account' },
  'account.locked': { icon: 'lock', group: 'account' },
  'instance.update_available': { icon: 'rocket', group: 'instance', instanceAdmin: true }
};

/** The events this member can receive, for the settings page. */
export function eventsFor(user: any): [string, NotificationEvent][] {
  return Object.entries(NOTIFICATION_EVENTS).filter(([, info]) => !info.instanceAdmin || user?.isAdmin);
}

// How long a line still unread can take in what follows it under the same `group`.
const GROUP_WINDOW_MS = 3600 * 1000;

// Read notifications older than this go; unread ones stay until they are read.
export const NOTIFICATION_RETENTION_DAYS = 90;
export const NOTIFICATIONS_PAGE_SIZE = 100;

let sockets: any = null;

const roomOf = (userId: any) => `user:${idOf(userId)}`;

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Lets a signed-in page follow its own unread count: the socket is put in its account's
 * room on the same cookie the pages are served on, and anything else is left out of it.
 */
export function attachNotificationSockets(io: any): void {
  sockets = io;
  io.on('connection', (socket: any) => {
    const token = cookieValue(socket.handshake?.headers?.cookie, 'jwt');
    const secret = process.env.PASSJWT;
    if (!token || !secret) return;
    jwt.verify(token, secret, async (err: any, decoded: any) => {
      if (err || !decoded?.id) return;
      try {
        const user = await db.users.findById(decoded.id, { fields: ['lastChange'] });
        if (!user || (user.lastChange && decoded.iat * 1000 < new Date(user.lastChange).getTime())) return;
        socket.join(roomOf(user._id));
      } catch { /* no room: the page simply does not update live */ }
    });
  });
}

export async function unreadCount(userId: any): Promise<number> {
  if (!userId) return 0;
  return db.notifications.count(and(eq('user', idOf(userId)), eq('readAt', null)));
}

async function pushCount(userId: any): Promise<void> {
  if (!sockets) return;
  sockets.to(roomOf(userId)).emit('notifications', { unread: await unreadCount(userId) });
}

/**
 * Tells `to` that `event` happened. Whoever did it (`actor`) is never told about their own
 * action, and an account listed twice gets one line.
 *
 * With a `group`, a recipient who has not yet read the last line of that group, written
 * within the hour, gets it counted up instead of a new one: `payload.count` says how many
 * it stands for, and `groupLink` is where it then leads. Ten wishes added in a row are one
 * line and one notification on the phone, not ten.
 */
export async function notify(params: {
  event: string;
  to: any[];
  actor?: any;
  collection?: any;
  payload?: Record<string, any>;
  link?: string;
  group?: string;
  groupLink?: string;
}): Promise<void> {
  const actor = params.actor ? idOf(params.actor) : null;
  const recipients = [...new Set(params.to.filter(Boolean).map(idOf))].filter(id => isId(id) && id !== actor);
  if (recipients.length === 0) return;
  try {
    const rows: any[] = [];
    for (const user of recipients) {
      const earlier = params.group ? await db.notifications.findOne(and(
        eq('user', user), eq('event', params.event), eq('payload.group', params.group), eq('readAt', null),
        range('created_at', { gte: new Date(Date.now() - GROUP_WINDOW_MS) })
      ), { sort: [desc('created_at')] }) : null;
      if (earlier) {
        const payload = { ...params.payload, group: params.group, count: (Number(earlier.payload?.count) || 1) + 1 };
        const link = params.groupLink || params.link || '';
        await db.notifications.updateOne(eq('_id', idOf(earlier._id)), { set: { payload, link } });
        rows.push({ ...earlier, payload, link });
        continue;
      }
      const row = {
        _id: db.newId(),
        user,
        collection: params.collection ? idOf(params.collection) : null,
        event: params.event,
        payload: params.group ? { ...params.payload, group: params.group, count: 1 } : (params.payload || {}),
        link: params.link || '',
        readAt: null
      };
      await db.notifications.insertMany([row]);
      rows.push(row);
    }
    await Promise.all(recipients.map(pushCount));
    await pushRows(rows, params.collection);
  } catch (err: any) {
    // Telling someone is never worth failing what they are being told about.
    console.error('[NOTIFY]', params.event, err.message);
  }
}

/**
 * Each line pushed to its recipient's devices, worded in the recipient's own language and
 * titled with the collection it is about. Tapping it opens the line, which marks it read.
 */
async function pushRows(rows: any[], collectionId: any): Promise<void> {
  const users = await db.users.find(isIn('_id', rows.map(r => r.user)), { fields: ['language', 'notificationPrefs'] });
  const byId = new Map(users.map((u: any) => [idOf(u._id), u]));
  const collection = collectionId ? await db.collections.findById(idOf(collectionId), { fields: ['name'] }) : null;
  for (const row of rows) {
    const user = byId.get(idOf(row.user));
    if (!user || !wantsPush(user, row.event)) continue;
    const t = i18next.getFixedT(user.language || 'en') as any;
    pushToUser(row.user, {
      ...pushWording(row, t, collection?.name || ''),
      url: `${BASE_URL}/notifications/${idOf(row._id)}/open`,
      // One notification per request, or per group, replaced as it moves on.
      tag: row.payload?.request ? `request-${row.payload.request}` : row.payload?.group || idOf(row._id),
      icon: pushIcon(row.payload?.cover),
      unread: await unreadCount(row.user)
    });
  }
}

// The longest quote of a message a push carries; the rest is on the request's page.
const PUSH_QUOTE = 140;

/**
 * A push reads like a message: whoever did something as the title, what they did and
 * about which item as the body, with their own words quoted when there are some. What
 * nobody did (a due date passing, an item removed) is titled with the item instead, or
 * with the event's own title when it has one. The browser already says which site it
 * comes from, so the title never repeats it.
 */
export function pushWording(row: any, t: (key: string, options?: any) => string, collectionName = ''): { title: string; body: string } {
  const payload = row.payload || {};
  const key = eventKey(row);
  const params = { ...wordingParams(payload, t), interpolation: { escapeValue: false } };
  const title = t(`notifications.push.titles.${prefKeyOf(row.event)}`, { ...params, defaultValue: '' })
    || payload.actor || payload.item || collectionName || 'DVinyl';
  let body = t(`notifications.push.text.${key}`, { ...params, defaultValue: '' })
    || t(`notifications.push.text.${prefKeyOf(row.event)}`, { ...params, defaultValue: '' })
    || describeNotification(row, t).text;
  const quote = String(payload.quote || '').replace(/\s+/g, ' ').trim();
  if (quote) body += '\n' + t('notifications.push.quote', { text: quote.length > PUSH_QUOTE ? quote.slice(0, PUSH_QUOTE - 1) + '…' : quote, interpolation: { escapeValue: false } });
  return { title, body };
}

const prefKeyOf = (event: unknown) => String(event).replace(/\./g, '_');

/** The text key of a line: its event's, with `_many` once it stands for several. */
function eventKey(row: any): string {
  return prefKeyOf(row.event) + (Number(row.payload?.count) > 1 ? '_many' : '');
}

/**
 * What the words of a line are filled with: its payload as stored, with the values
 * that read differently in each language worded in the reader's. A country is stored as
 * its code and named here, a due date as a day and written out here.
 */
function wordingParams(payload: Record<string, any>, t: (key: string, options?: any) => string): Record<string, any> {
  const locale = t('notifications.push.date_locale');
  const params: Record<string, any> = {};
  for (const [name, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
  }
  params.actor = payload.actor || t('notifications.someone');
  for (const name of ['kind', 'item', 'step']) params[name] = payload[name] || '';
  params.date = payload.due ? new Date(`${payload.due}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'long' }) : '';
  if ('country' in payload || 'city' in payload) {
    const country = countryName(payload.country, locale);
    params.place = [payload.city, country].filter(Boolean).join(', ') || t('common.unknown');
  }
  return params;
}

function countryName(code: unknown, locale: string): string {
  const value = String(code || '');
  if (!/^[A-Z]{2}$/.test(value) || value === 'XX') return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(value) || value;
  } catch {
    return value;
  }
}

/** An item's cover as a push icon: one of this instance's own images, or an HTTPS one. */
function pushIcon(cover: unknown): string {
  const url = itemImageUrl(cover);
  return url.startsWith('/') || url.startsWith('https://') ? url : '';
}

/** A member's latest notifications, newest first. */
export async function notificationsOf(userId: any, limit = NOTIFICATIONS_PAGE_SIZE): Promise<any[]> {
  return db.notifications.find(eq('user', idOf(userId)), { sort: [desc('created_at')], limit, defaults: true });
}

/** One of a member's own notifications, never someone else's. */
export async function ownNotification(userId: any, id: unknown): Promise<any | null> {
  const notificationId = idOf(id);
  if (!isId(notificationId)) return null;
  return db.notifications.findOne(and(eq('_id', notificationId), eq('user', idOf(userId))));
}

/** Marks one notification read, or all of a member's when no id is given. */
export async function markRead(userId: any, id?: any): Promise<void> {
  await db.notifications.updateMany(
    and(eq('user', idOf(userId)), eq('readAt', null), id ? eq('_id', idOf(id)) : null),
    { set: { readAt: new Date() } }
  );
  await pushCount(userId);
}

/** The words of a notification, in the reader's language. */
export function describeNotification(notification: any, t: (key: string, options?: any) => string): { icon: string; text: string } {
  const params = wordingParams(notification.payload || {}, t);
  const text = t(`notifications.events.${eventKey(notification)}`, { ...params, defaultValue: '' })
    || t(`notifications.events.${prefKeyOf(notification.event)}`, { ...params, defaultValue: notification.event });
  return { icon: NOTIFICATION_EVENTS[notification.event]?.icon || 'bell', text };
}

/** A member's read notifications, gone at their request. */
export async function clearRead(userId: any): Promise<void> {
  await db.notifications.deleteMany(and(eq('user', idOf(userId)), range('readAt', { lte: new Date() })));
}

/** Clears out what was read long ago. */
export async function purgeOldNotifications(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 3600 * 1000);
  return db.notifications.deleteMany(range('readAt', { lte: before }));
}

/** Notifications go with the account, or with the collection they were about. */
export async function deleteNotificationsOf(filter: { user?: any; collection?: any }): Promise<void> {
  if (filter.user) await db.notifications.deleteMany(eq('user', idOf(filter.user)));
  if (filter.collection) await db.notifications.deleteMany(eq('collection', idOf(filter.collection)));
}
