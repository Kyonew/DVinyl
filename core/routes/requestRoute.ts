import express from 'express';
import { db } from '../db';
import { and, desc, eq, idOf, isId, isIn, notIn, or } from '../db/query';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { setActiveCollection } from '../../utils/collectionHelpers';
import {
  Outcome, RequestContext, advanceRequest, answerRequest, cancelRequest, describeRequests,
  OPEN_STATUSES, ownRequest, readableBy, requestableItem, requestsEnabled, sendRequest
} from '../requests';
import { typeBySlug } from '../requestTypes';
import { describeNotification, markRead, notificationsOf, ownNotification } from '../notify';

/**
 * Requests between members, and the inbox. A request is always read back within the
 * active collection and only by those allowed to read it (core/requests.ts readableBy);
 * share links reach none of it.
 */
const router = express.Router();

const BOXES = ['inbox', 'sent', 'ongoing', 'history'] as const;
// How many closed requests the history box lists.
const HISTORY_SIZE = 50;

/** A same-site path to come back to, or the fallback. */
function safeBack(value: unknown, fallback: string): string {
  const path = String(value || '');
  return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}

/** `path` with a message for the page it leads to. */
function withMessage(path: string, key: string, field?: string): string {
  const [base = '', hash] = path.split('#');
  const params = new URLSearchParams({ request_msg: key.replace(/^requests\./, '') });
  if (field) params.set('request_field', field);
  return `${base}${base.includes('?') ? '&' : '?'}${params}${hash ? `#${hash}` : ''}`;
}

function contextOf(res: any): RequestContext {
  return {
    collectionId: idOf(res.locals.activeCollectionId),
    collection: res.locals.activeCollection,
    userId: idOf(res.locals.user._id),
    role: res.locals.collectionRole,
    settings: res.locals.settings
  };
}

/** Requests are off in this collection: nothing of them is reachable. */
function requestsOff(res: any): boolean {
  return res.locals.isShareView || !res.locals.activeCollectionId || !requestsEnabled(res.locals.settings);
}

// GET /requests -> my requests: waiting for me, sent by me, ongoing, over
router.get('/requests', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    if (requestsOff(res)) return res.redirect('/');
    const ctx = contextOf(res);
    const box = (BOXES as readonly string[]).includes(req.query.box) ? req.query.box : 'inbox';
    const ofCollection = eq('collection', ctx.collectionId);
    const me = ctx.userId;

    const filters: Record<string, any> = {
      inbox: and(ofCollection, eq('recipient', me), eq('status', 'pending')),
      sent: and(ofCollection, eq('sender', me), eq('status', 'pending')),
      // Everything under way that this member may read: theirs, and what every member sees.
      ongoing: and(ofCollection, eq('status', 'accepted'), readableBy(me)),
      history: and(ofCollection, notIn('status', OPEN_STATUSES), or(eq('sender', me), eq('recipient', me)))
    };
    const counts: Record<string, number> = {};
    for (const name of ['inbox', 'sent', 'ongoing']) counts[name] = await db.requests.count(filters[name]);

    const requests = await db.requests.find(filters[box], {
      sort: [desc(box === 'history' ? 'updated_at' : 'created_at')],
      ...(box === 'history' ? { limit: HISTORY_SIZE } : {}),
      defaults: true
    });
    const rows = await describeRequests(requests, ctx, req.t.bind(req));
    // Late ones first, where they will be seen.
    if (box === 'ongoing') rows.sort((a, b) => Number(b.overdue) - Number(a.overdue));

    res.render('requests', {
      user: res.locals.user,
      box,
      rows,
      counts,
      requestMsg: req.query.request_msg,
      requestField: req.query.request_field
    });
  } catch (err: any) {
    console.error('[ERR] Requests page:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// GET /requests/:id -> one request, where a notification leads
router.get('/requests/:id', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    if (requestsOff(res)) return res.redirect('/');
    const ctx = contextOf(res);
    const request = await ownRequest(ctx.collectionId, req.params.id, ctx.userId);
    if (!request) return res.status(404).render('404');
    const [row] = await describeRequests([request], ctx, req.t.bind(req));
    res.render('request', {
      user: res.locals.user,
      r: row,
      log: await describeLog(request, req.t.bind(req)),
      requestMsg: req.query.request_msg,
      requestField: req.query.request_field
    });
  } catch (err: any) {
    console.error('[ERR] Request page:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

/** The request's history in words, oldest first. */
async function describeLog(request: any, t: (k: string, o?: any) => string) {
  const entries = Array.isArray(request.log) ? request.log : [];
  const ids = [...new Set(entries.map((e: any) => e.by).filter(Boolean).map(idOf))] as string[];
  const users = ids.length ? await db.users.find(isIn('_id', ids), { fields: ['username'] }) : [];
  const names = new Map(users.map((u: any) => [idOf(u._id), u.username]));
  const steps = request.snapshot?.steps || [];
  return entries.map((e: any) => ({
    at: e.at,
    text: t(`requests.log.${e.action}`, {
      name: names.get(idOf(e.by)) || t('notifications.someone'),
      step: steps[e.step]?.label || '',
      defaultValue: e.action
    })
  }));
}

// POST /requests -> send one (type, itemId, recipient, message, f_<field>)
router.post('/requests', requireAuth, requireCollectionRole('viewer'), async (req: any, res: any) => {
  try {
    if (requestsOff(res)) return res.status(404).render('404');
    const ctx = contextOf(res);
    const type = await typeBySlug(ctx.collectionId, String(req.body.type || ''));
    const item = await requestableItem(ctx.collectionId, req.body.itemId);
    if (!type || !item) return res.status(404).render('404');
    const back = safeBack(req.body.back, '/requests?box=sent');

    const outcome = await sendRequest({ type, ctx, item, recipientId: req.body.recipient, body: req.body, actorName: req.user.username });
    if (outcome.error) return res.redirect(withMessage(back, outcome.error, outcome.params?.field));
    res.redirect(withMessage(back, 'msg_sent'));
  } catch (err: any) {
    console.error('[ERR] Send request:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

/** The routes acting on one request: read it back, act, come back with what happened. */
function act(run: (request: any, ctx: RequestContext, req: any) => Promise<Outcome>, done: string) {
  return async (req: any, res: any) => {
    try {
      if (requestsOff(res)) return res.status(404).render('404');
      const ctx = contextOf(res);
      const request = await ownRequest(ctx.collectionId, req.params.id, ctx.userId);
      if (!request) return res.status(404).render('404');
      const outcome = await run(request, ctx, req);
      res.redirect(withMessage(safeBack(req.body.back, `/requests/${idOf(request._id)}`), outcome.error || done));
    } catch (err: any) {
      console.error('[ERR] Request action:', err.message);
      res.status(500).send(req.t('errors.generic_server_error'));
    }
  };
}

router.post('/requests/:id/accept', requireAuth, requireCollectionRole('viewer'), act(
  (request, ctx, req) => answerRequest({ request, ctx, accept: true, response: req.body.response, actorName: req.user.username }), 'msg_accepted'));
router.post('/requests/:id/decline', requireAuth, requireCollectionRole('viewer'), act(
  (request, ctx, req) => answerRequest({ request, ctx, accept: false, response: req.body.response, actorName: req.user.username }), 'msg_declined'));
router.post('/requests/:id/advance', requireAuth, requireCollectionRole('viewer'), act(
  (request, ctx, req) => advanceRequest({ request, ctx, actorName: req.user.username }), 'msg_advanced'));
router.post('/requests/:id/cancel', requireAuth, requireCollectionRole('viewer'), act(
  (request, ctx, req) => cancelRequest({ request, ctx, actorName: req.user.username }), 'msg_cancelled'));

// GET /notifications -> my inbox, latest first, grouped by day in the view
router.get('/notifications', requireAuth, async (req: any, res: any) => {
  try {
    const t = req.t.bind(req);
    const rows = (await notificationsOf(req.user._id)).map((n: any) => ({
      id: idOf(n._id),
      ...describeNotification(n, t),
      read: !!n.readAt,
      createdAt: n.created_at
    }));
    res.render('notifications', { user: res.locals.user, notifications: rows });
  } catch (err: any) {
    console.error('[ERR] Notifications page:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /notifications/read -> all of mine read
router.post('/notifications/read', requireAuth, async (req: any, res: any) => {
  try {
    await markRead(req.user._id);
    if ((req.headers.accept || '').includes('json')) return res.json({ success: true });
    res.redirect('/notifications');
  } catch (err: any) {
    console.error('[ERR] Read notifications:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// GET /notifications/:id/open -> read, then where it leads, in the collection it is about
router.get('/notifications/:id/open', requireAuth, async (req: any, res: any) => {
  try {
    const notification = await ownNotification(req.user._id, req.params.id);
    if (!notification) return res.redirect('/notifications');
    await markRead(req.user._id, notification._id);
    if (notification.collection && isId(idOf(notification.collection))) {
      const member = await db.collections.exists(and(eq('_id', idOf(notification.collection)), eq('members.user', idOf(req.user._id))));
      if (member) await setActiveCollection(req, notification.collection);
    }
    res.redirect(safeBack(notification.link, '/notifications'));
  } catch (err: any) {
    console.error('[ERR] Open notification:', err.message);
    res.redirect('/notifications');
  }
});

export default router;
