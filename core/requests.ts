import { db } from './db';
import { and, desc, eq, idOf, isId, isIn, or } from './db/query';
import { registry } from './registry';
import { notify } from './notify';
import { TypeField, TypeStep, typesOf } from './requestTypes';

/**
 * Requests: one member asks another about one item, under a type the collection's admin
 * made up (core/requestTypes.ts). The recipient accepts or declines; an accepted request
 * then goes through the type's steps, the last one closing it. A step can mark the item
 * as away, with whoever the type names, until a later step brings it back.
 *
 * Nothing here knows what a loan or a gift is: those are only types.
 */

export const ROLE_LEVEL: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };
export const hasRole = (role: string | null | undefined, min: string) =>
  (ROLE_LEVEL[role || ''] ?? 0) >= (ROLE_LEVEL[min] ?? 99);

export const OPEN_STATUSES = ['pending', 'accepted'];
export const MAX_REQUEST_MESSAGE = 500;
export const MAX_REQUEST_RESPONSE = 500;
// Requests a member may have open in one collection, all types together.
export const MAX_OPEN_REQUESTS = 30;
const MAX_TEXT = 200;
const MAX_TEXTAREA = 1000;

export type RequestContext = {
  collectionId: string;
  collection: any;
  userId: string;
  role: string | null;
  settings: any;
};

// ---------------------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------------------

export function requestsEnabled(settings: any): boolean {
  return settings?.requests?.enabled === true;
}

/** Members of the collection a request can be sent to: everyone but the sender. */
export function recipientsOf(collection: any, senderId: string): string[] {
  return (collection?.members || []).map((m: any) => idOf(m.user)).filter((id: string) => id && id !== idOf(senderId));
}

export function isMember(collection: any, userId: any): boolean {
  return (collection?.members || []).some((m: any) => idOf(m.user) === idOf(userId));
}

// ---------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());

/**
 * The answers a form sent for a type's fields (named f_<key>), checked against them.
 * Fields the type does not declare are never read.
 */
export function readRequestData(fields: TypeField[], body: any): { data: Record<string, any>; error: null | { key: string; field: TypeField } } {
  const data: Record<string, any> = {};
  for (const field of fields) {
    const raw = body?.[`f_${field.key}`];
    const text = (Array.isArray(raw) ? String(raw[raw.length - 1] ?? '') : String(raw ?? '')).trim();
    let value: any = null;
    switch (field.type) {
      case 'boolean':
        value = text === 'on' || text === 'true';
        break;
      case 'number': {
        const n = Number(text.replace(',', '.'));
        if (text !== '' && !Number.isFinite(n)) return { data, error: { key: 'requests.err_field_invalid', field } };
        value = text === '' ? null : n;
        break;
      }
      case 'date':
        if (text !== '' && !isDay(text)) return { data, error: { key: 'requests.err_field_invalid', field } };
        value = text || null;
        break;
      case 'select':
        if (text !== '' && !(field.options || []).includes(text)) return { data, error: { key: 'requests.err_field_invalid', field } };
        value = text || null;
        break;
      default:
        value = text.slice(0, field.type === 'textarea' ? MAX_TEXTAREA : MAX_TEXT) || null;
    }
    if (field.required && (value === null || value === false)) return { data, error: { key: 'requests.err_field_required', field } };
    if (value !== null) data[field.key] = value;
  }
  return { data, error: null };
}

export const cleanText = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

// ---------------------------------------------------------------------------------------
// Where a request stands
// ---------------------------------------------------------------------------------------

export function stepsOf(request: any): TypeStep[] {
  return Array.isArray(request?.snapshot?.steps) ? request.snapshot.steps : [];
}

export function currentStep(request: any): TypeStep | null {
  return request?.status === 'accepted' || request?.status === 'done' ? stepsOf(request)[request.step] || null : null;
}

/** The step an accepted request moves to next, or null once there is none. */
export function nextStep(request: any): TypeStep | null {
  if (request?.status !== 'accepted') return null;
  return stepsOf(request)[(request.step ?? -1) + 1] || null;
}

/** Whether the item is away because of this request right now. */
export function isOut(request: any): boolean {
  return request?.status === 'accepted' && currentStep(request)?.out === true && request.snapshot?.holder !== 'none';
}

/** The member who has the item while the request keeps it away. */
export function holderOf(request: any): string | null {
  const holder = request?.snapshot?.holder;
  if (holder === 'sender') return idOf(request.sender);
  if (holder === 'recipient') return idOf(request.recipient);
  return null;
}

/** The due date of a request, from the field its type marks as one. */
export function dueDateOf(request: any): string | null {
  const field = (request?.snapshot?.fields || []).find((f: TypeField) => f.deadline);
  const value = field ? request.data?.[field.key] : null;
  return typeof value === 'string' && isDay(value) ? value : null;
}

/** An ongoing request past its due date. */
export function isOverdue(request: any, now = new Date()): boolean {
  const due = dueDateOf(request);
  return request?.status === 'accepted' && !!due && due < now.toISOString().slice(0, 10);
}

/** The requests this member may read: every one meant for all members, and their own. */
export function readableBy(userId: any) {
  const me = idOf(userId);
  return or(eq('visibility', 'members'), eq('sender', me), eq('recipient', me));
}

const ofCollection = (collectionId: any) => eq('collection', idOf(collectionId));

// ---------------------------------------------------------------------------------------
// Moving a request along
// ---------------------------------------------------------------------------------------

export type Outcome = { request?: any; error?: string; params?: Record<string, any> };

/** An item of the collection, wished for or owned. */
export async function requestableItem(collectionId: any, id: unknown): Promise<any | null> {
  const itemId = idOf(id);
  if (!isId(itemId)) return null;
  return db.items.findOne(and(eq('_id', itemId), ofCollection(collectionId)));
}

/** A request of the collection this member may read, or null. */
export async function ownRequest(collectionId: any, id: unknown, userId: any): Promise<any | null> {
  const requestId = idOf(id);
  if (!isId(requestId)) return null;
  return db.requests.findOne(and(eq('_id', requestId), ofCollection(collectionId), readableBy(userId)), { defaults: true });
}

/** The request keeping the item away right now, if one does. */
export async function outRequestOf(collectionId: any, itemId: any): Promise<any | null> {
  const ongoing = await db.requests.find(and(ofCollection(collectionId), eq('item', idOf(itemId)), eq('status', 'accepted')), { defaults: true });
  return ongoing.find(isOut) || null;
}

function snapshotOf(type: any) {
  return {
    name: type.name,
    icon: type.icon,
    holder: type.holder || 'none',
    fields: (type.fields || []).map((f: any) => ({ key: f.key, label: f.label, type: f.type, deadline: !!f.deadline })),
    steps: (type.steps || []).map((s: any) => ({ key: s.key, label: s.label, out: !!s.out }))
  };
}

const logEntry = (by: any, action: string, step?: number) => ({ at: new Date(), by: idOf(by), action, ...(step !== undefined ? { step } : {}) });

function payloadOf(request: any, actorName: string, itemTitle: string, extra: Record<string, any> = {}) {
  return { actor: actorName, kind: request.snapshot?.name || request.type, item: itemTitle, ...extra };
}

export const isParty = (request: any, userId: any) =>
  idOf(request.sender) === idOf(userId) || idOf(request.recipient) === idOf(userId);

/** Tells the member on the other side of the request what the actor just did to it. */
async function tellOther(event: string, request: any, ctx: RequestContext, actorName: string, extra: Record<string, any> = {}) {
  const item = await db.items.findOne(eq('_id', idOf(request.item)), { fields: ['title'] });
  const other = idOf(request.sender) === ctx.userId ? request.recipient : request.sender;
  // A collection admin moving someone else's request along tells both of them.
  const to = isParty(request, ctx.userId) ? [other] : [request.sender, request.recipient];
  await notify({
    event,
    to,
    actor: ctx.userId,
    collection: ctx.collectionId,
    payload: payloadOf(request, actorName, item?.title || '', extra),
    link: `/requests/${idOf(request._id)}`
  });
}

export async function sendRequest(params: {
  type: any;
  ctx: RequestContext;
  item: any;
  recipientId: unknown;
  body: any;
  actorName: string;
}): Promise<Outcome> {
  const { type, ctx, item } = params;
  if (!requestsEnabled(ctx.settings) || !type.enabled) return { error: 'requests.err_type_off' };
  if (!hasRole(ctx.role, type.minRole)) return { error: 'requests.err_not_allowed' };
  const recipient = idOf(params.recipientId);
  if (!isId(recipient) || recipient === ctx.userId || !isMember(ctx.collection, recipient)) return { error: 'requests.err_recipient' };

  const { data, error } = readRequestData(type.fields || [], params.body);
  if (error) return { error: error.key, params: { field: error.field.label } };

  const already = await db.requests.exists(and(
    ofCollection(ctx.collectionId), eq('type', type.slug), eq('sender', ctx.userId),
    eq('recipient', recipient), eq('item', idOf(item._id)), eq('status', 'pending')
  ));
  if (already) return { error: 'requests.err_already_pending' };
  const open = await db.requests.count(and(ofCollection(ctx.collectionId), eq('sender', ctx.userId), isIn('status', OPEN_STATUSES)));
  if (open >= MAX_OPEN_REQUESTS) return { error: 'requests.err_too_many' };

  const request = await db.requests.create({
    collection: idOf(ctx.collectionId),
    type: type.slug,
    sender: ctx.userId,
    recipient,
    item: idOf(item._id),
    visibility: type.visibility === 'private' ? 'private' : 'members',
    status: 'pending',
    step: -1,
    message: cleanText(params.body?.message, MAX_REQUEST_MESSAGE),
    data,
    log: [logEntry(ctx.userId, 'sent')],
    snapshot: snapshotOf(type)
  });

  await notify({
    event: 'request.received',
    to: [recipient],
    actor: ctx.userId,
    collection: ctx.collectionId,
    payload: payloadOf(request, params.actorName, item.title || ''),
    link: `/requests/${idOf(request._id)}`
  });
  return { request };
}

/**
 * The recipient's answer. Accepting a type without steps closes the request at once. The
 * move away from pending is one filtered write, so a double click answers once.
 */
export async function answerRequest(params: { request: any; ctx: RequestContext; accept: boolean; response: string; actorName: string }): Promise<Outcome> {
  const { request, ctx, accept } = params;
  if (request.status !== 'pending' || idOf(request.recipient) !== ctx.userId) return { error: 'requests.err_not_allowed' };
  const status = !accept ? 'declined' : stepsOf(request).length === 0 ? 'done' : 'accepted';
  const answered = await db.requests.updateAndGet(
    and(eq('_id', idOf(request._id)), eq('status', 'pending')),
    { set: {
      status,
      response: cleanText(params.response, MAX_REQUEST_RESPONSE),
      log: [...(request.log || []), logEntry(ctx.userId, accept ? 'accepted' : 'declined')]
    } }
  );
  if (!answered) return { error: 'requests.err_already_answered' };
  await tellOther(accept ? 'request.accepted' : 'request.declined', answered, ctx, params.actorName);
  return { request: answered };
}

/** Whether this member may move an accepted request along: either side, or an admin. */
export function canAdvance(request: any, ctx: { userId: string; role: string | null }): boolean {
  return request?.status === 'accepted' && (isParty(request, ctx.userId) || hasRole(ctx.role, 'admin'));
}

/**
 * The next step. Reaching the last one closes the request. A step that takes the item
 * away is refused while another request already has it away.
 */
export async function advanceRequest(params: { request: any; ctx: RequestContext; actorName: string }): Promise<Outcome> {
  const { request, ctx } = params;
  if (!canAdvance(request, ctx)) return { error: 'requests.err_not_allowed' };
  const target = (request.step ?? -1) + 1;
  const step = stepsOf(request)[target];
  if (!step) return { error: 'requests.err_not_allowed' };
  if (step.out && request.snapshot?.holder !== 'none') {
    const away = await outRequestOf(ctx.collectionId, request.item);
    if (away && idOf(away._id) !== idOf(request._id)) return { error: 'requests.err_item_out' };
  }
  const last = target === stepsOf(request).length - 1;
  const moved = await db.requests.updateAndGet(
    and(eq('_id', idOf(request._id)), eq('status', 'accepted'), eq('step', request.step ?? -1)),
    { set: {
      step: target,
      status: last ? 'done' : 'accepted',
      log: [...(request.log || []), logEntry(ctx.userId, 'step', target)]
    } }
  );
  if (!moved) return { error: 'requests.err_already_answered' };
  await tellOther('request.step', moved, ctx, params.actorName, { step: step.label });
  return { request: moved };
}

/**
 * Called off: by the sender while it waits, by either side (or an admin) once accepted.
 * A request that is over stays as it ended.
 */
export function canCancel(request: any, ctx: { userId: string; role: string | null }): boolean {
  if (request?.status === 'pending') return idOf(request.sender) === idOf(ctx.userId);
  return canAdvance(request, ctx);
}

export async function cancelRequest(params: { request: any; ctx: RequestContext; actorName: string }): Promise<Outcome> {
  const { request, ctx } = params;
  if (!canCancel(request, ctx)) return { error: 'requests.err_not_allowed' };
  const cancelled = await db.requests.updateAndGet(
    and(eq('_id', idOf(request._id)), eq('status', request.status)),
    { set: { status: 'cancelled', log: [...(request.log || []), logEntry(ctx.userId, 'cancelled')] } }
  );
  if (!cancelled) return { error: 'requests.err_already_answered' };
  await tellOther('request.cancelled', cancelled, ctx, params.actorName);
  return { request: cancelled };
}

// ---------------------------------------------------------------------------------------
// Reading them back
// ---------------------------------------------------------------------------------------

/** How many requests wait for this member's answer in the collection. */
export async function inboxCount(collectionId: any, userId: any, settings: any): Promise<number> {
  if (!collectionId || !userId || !requestsEnabled(settings)) return 0;
  return db.requests.count(and(ofCollection(collectionId), eq('recipient', idOf(userId)), eq('status', 'pending')));
}

/**
 * The items away right now, by item id, with who has them. Only requests every member
 * may read count: a private one never tells the others where an item is.
 */
export async function outByItem(collectionId: any, itemIds?: any[]): Promise<Map<string, any>> {
  if (!collectionId || (itemIds && itemIds.length === 0)) return new Map();
  const ongoing = (await db.requests.find(and(
    ofCollection(collectionId), eq('status', 'accepted'), eq('visibility', 'members'),
    itemIds ? isIn('item', itemIds.map(idOf)) : null
  ), { defaults: true })).filter(isOut);
  const holders = [...new Set(ongoing.map(holderOf).filter(Boolean))] as string[];
  const users = holders.length ? await db.users.find(isIn('_id', holders), { fields: ['username'] }) : [];
  const names = new Map(users.map((u: any) => [idOf(u._id), u.username]));
  return new Map(ongoing.map((r: any) => [idOf(r.item), {
    holder: names.get(holderOf(r) || '') || '',
    typeName: r.snapshot?.name || '',
    icon: r.snapshot?.icon || 'paper-plane',
    overdue: isOverdue(r)
  }]));
}

/** The ids of the items away right now, for the "away" filter. */
export async function outItemIds(collectionId: any): Promise<string[]> {
  return [...(await outByItem(collectionId)).keys()];
}

/** Whether any type of the collection can take an item away, which is when the filter shows. */
export async function anyTypeMovesItems(collectionId: any): Promise<boolean> {
  return (await typesOf(collectionId)).some((t: any) => t.enabled && t.holder !== 'none');
}

/**
 * Requests made readable for `viewer`: names, the item, the answers as label and value,
 * where it stands, and what this member can do with it.
 */
export async function describeRequests(requests: any[], viewer: { userId: string; role: string | null }, t: (k: string, o?: any) => string): Promise<any[]> {
  const userIds = [...new Set(requests.flatMap(r => [r.sender, r.recipient]).filter(Boolean).map(idOf))];
  const itemIds = [...new Set(requests.map(r => r.item).filter(Boolean).map(idOf))];
  const [users, items] = await Promise.all([
    userIds.length ? db.users.find(isIn('_id', userIds), { fields: ['username', 'img'] }) : [],
    itemIds.length ? db.items.find(isIn('_id', itemIds)) : []
  ]);
  const userById = new Map(users.map((u: any) => [idOf(u._id), u]));
  const itemById = new Map(items.map((i: any) => [idOf(i._id), i]));
  const nameOf = (id: any) => userById.get(idOf(id))?.username || t('notifications.someone');
  const imgOf = (id: any) => userById.get(idOf(id))?.img || '/ressources/no-pp.jpg';

  return requests.map(r => {
    const snapshot = r.snapshot || {};
    const item = itemById.get(idOf(r.item));
    const plugin = item ? registry.getByKind(item.kind) : null;
    const view = item && plugin ? plugin.formatForView(item) : null;
    const fields = (snapshot.fields || []).filter((f: any) => r.data && r.data[f.key] !== undefined).map((f: any) => {
      const value = r.data[f.key];
      return { label: f.label, type: f.type, deadline: !!f.deadline, value: f.type === 'boolean' ? t(value ? 'common.yes' : 'common.no') : String(value) };
    });
    const step = currentStep(r);
    const next = nextStep(r);
    const holder = holderOf(r);
    const me = viewer.userId;
    const started = r.status === 'accepted' || r.status === 'done';
    return {
      id: idOf(r._id),
      typeSlug: r.type,
      name: snapshot.name || r.type,
      icon: snapshot.icon || 'paper-plane',
      status: r.status,
      stepLabel: step?.label || '',
      steps: (snapshot.steps || []).map((s: any, i: number) => ({ label: s.label, out: !!s.out, reached: started && i <= (r.step ?? -1) })),
      out: isOut(r),
      overdue: isOverdue(r),
      due: dueDateOf(r),
      holder: holder ? nameOf(holder) : '',
      holderIsMe: !!holder && holder === me,
      message: r.message || '',
      response: r.response || '',
      fields,
      private: r.visibility === 'private',
      senderId: idOf(r.sender),
      sender: nameOf(r.sender),
      senderImg: imgOf(r.sender),
      recipientId: idOf(r.recipient),
      recipient: nameOf(r.recipient),
      recipientImg: imgOf(r.recipient),
      fromMe: idOf(r.sender) === me,
      toMe: idOf(r.recipient) === me,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      item: view ? { id: idOf(item._id), title: view.title || '', cover: view.cover_image || '', href: `${plugin!.routePrefix}/${idOf(item._id)}`, wished: !!item.in_wishlist } : null,
      can: {
        answer: r.status === 'pending' && idOf(r.recipient) === me,
        cancel: canCancel(r, viewer),
        advance: canAdvance(r, viewer) && next ? next.label : ''
      }
    };
  });
}

/**
 * What the item page's requests card needs: the types this member can send about it and
 * to whom, and the requests about it they may read.
 */
export async function requestCardData(res: any, item: any, t: (k: string, o?: any) => string): Promise<any | null> {
  const settings = res.locals.settings;
  if (res.locals.isShareView || !res.locals.user || !requestsEnabled(settings)) return null;
  const collectionId = idOf(res.locals.activeCollectionId);
  const userId = idOf(res.locals.user._id);
  const role = res.locals.collectionRole;

  const types = (await typesOf(collectionId)).filter((type: any) => type.enabled && hasRole(role, type.minRole));
  const recipientIds = recipientsOf(res.locals.activeCollection, userId);
  const recipients = recipientIds.length
    ? (await db.users.find(isIn('_id', recipientIds), { fields: ['username'] }))
      .map((u: any) => ({ id: idOf(u._id), username: u.username }))
      .sort((a: any, b: any) => a.username.localeCompare(b.username))
    : [];

  const all = await db.requests.find(and(ofCollection(collectionId), eq('item', idOf(item._id)), readableBy(userId)), { sort: [desc('updated_at')], defaults: true });
  const rows = await describeRequests(all, { userId, role }, t);
  const open = rows.filter(r => r.status === 'pending' || r.status === 'accepted');
  const past = rows.filter(r => r.status !== 'pending' && r.status !== 'accepted').slice(0, 10);
  if ((types.length === 0 || recipients.length === 0) && rows.length === 0) return null;
  return { types: recipients.length ? types : [], recipients, open, past };
}

// ---------------------------------------------------------------------------------------
// Cleaning up
// ---------------------------------------------------------------------------------------

/** The items went: what was still open about them is called off, and both sides told. */
export async function closeRequestsOnItems(itemIds: any[], titles: Map<string, string> = new Map()): Promise<void> {
  if (!itemIds || itemIds.length === 0) return;
  const open = await db.requests.find(and(isIn('item', itemIds.map(idOf)), isIn('status', OPEN_STATUSES)), { defaults: true });
  if (open.length === 0) return;
  await db.requests.updateMany(isIn('_id', open.map((r: any) => idOf(r._id))), { set: { status: 'cancelled' } });
  for (const r of open) {
    await notify({
      event: 'request.item_removed',
      to: [r.sender, r.recipient],
      collection: r.collection,
      payload: { kind: r.snapshot?.name || r.type, item: titles.get(idOf(r.item)) || '' },
      link: '/requests'
    });
  }
}

/** A member who leaves a collection: what was still open with them there is called off. */
export async function cancelRequestsOf(userId: any, collectionId?: any): Promise<void> {
  const me = idOf(userId);
  await db.requests.updateMany(
    and(or(eq('sender', me), eq('recipient', me)), isIn('status', OPEN_STATUSES), collectionId ? ofCollection(collectionId) : null),
    { set: { status: 'cancelled' } }
  );
}
