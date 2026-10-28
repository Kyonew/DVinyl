import express from 'express';
import { db } from '../db';
import { eq, idOf } from '../db/query';
import { requireAuth } from '../../middleware/authMiddleware';
import { NOTIFICATION_EVENTS } from '../notify';
import { ownSubscription, prefKey, rememberPushOrigin, removeSubscription, saveSubscription, sendToDevice, vapidKeys } from '../push';
import { getPublicProtocol } from '../helpers';

/**
 * A member's push devices and what they want pushed. Every route acts on the signed-in
 * member's own devices and preferences only.
 */
const router = express.Router();

const wantsJson = (req: any) => (req.headers.accept || '').includes('json');

/**
 * The address the member reached the instance at, which push signs with when it is HTTPS.
 * The browser's own Origin header first: behind a proxy that terminates HTTPS, the
 * request itself may only say http.
 */
const rememberOrigin = (req: any) => {
  const proto = String(req.get('x-forwarded-proto') || '').split(',')[0]!.trim() || getPublicProtocol(req);
  return rememberPushOrigin(req.get('origin') || `${proto}://${req.get('host')}`).catch(() => {});
};

// GET /push/key -> the public key a browser subscribes with
router.get('/push/key', requireAuth, async (req: any, res: any) => {
  try {
    await rememberOrigin(req);
    res.json({ publicKey: (await vapidKeys()).publicKey });
  } catch (err: any) {
    console.error('[ERR] Push key:', err.message);
    res.status(500).json({ error: 'unavailable' });
  }
});

// POST /push/subscriptions -> this device, as its browser described it
router.post('/push/subscriptions', requireAuth, async (req: any, res: any) => {
  try {
    await rememberOrigin(req);
    const outcome = await saveSubscription(req.user._id, req.body?.subscription, req.get('user-agent') || '');
    if (!outcome.ok) return res.status(400).json({ success: false, error: req.t(outcome.error) });
    res.json({ success: true, id: outcome.id });
  } catch (err: any) {
    console.error('[ERR] Push subscribe:', err.message);
    res.status(500).json({ success: false, error: req.t('errors.generic_server_error') });
  }
});

// POST /push/subscriptions/:id/delete -> a device of mine, no longer pushed to
router.post('/push/subscriptions/:id/delete', requireAuth, async (req: any, res: any) => {
  try {
    await removeSubscription(req.user._id, req.params.id);
    if (wantsJson(req)) return res.json({ success: true });
    res.redirect('/notifications?push_msg=removed#push');
  } catch (err: any) {
    console.error('[ERR] Push unsubscribe:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /push/subscriptions/:id/test -> a push to that device, to see it arrive
router.post('/push/subscriptions/:id/test', requireAuth, async (req: any, res: any) => {
  try {
    const device = await ownSubscription(req.user._id, req.params.id);
    if (!device) return res.redirect('/notifications#push');
    await rememberOrigin(req);
    const outcome = await sendToDevice(device, {
      title: 'DVinyl',
      body: req.t('notifications.push.test_body'),
      url: `${res.locals.baseUrl}/notifications`,
      tag: 'test'
    });
    const msg = outcome === 'sent' || outcome === 'dry' ? 'test_sent' : outcome === 'gone' ? 'test_gone' : 'test_failed';
    res.redirect(`/notifications?push_msg=${msg}#push`);
  } catch (err: any) {
    console.error('[ERR] Push test:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

// POST /notifications/prefs -> which events reach my devices (push_<event>=on)
router.post('/notifications/prefs', requireAuth, async (req: any, res: any) => {
  try {
    const push: Record<string, boolean> = {};
    for (const event of Object.keys(NOTIFICATION_EVENTS)) {
      if (req.body[`push_${prefKey(event)}`] !== 'on') push[prefKey(event)] = false;
    }
    await db.users.updateOne(eq('_id', idOf(req.user._id)), { set: { 'notificationPrefs.push': push } });
    res.redirect('/notifications?push_msg=prefs_saved#push');
  } catch (err: any) {
    console.error('[ERR] Notification prefs:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
