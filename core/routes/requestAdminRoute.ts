import express from 'express';
import { db } from '../db';
import { and, eq, idOf } from '../db/query';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { requestsEnabled } from '../requests';
import { registry } from '../registry';
import { MAX_TYPES, REQUEST_TYPE_ICONS, cleanRequestType, freeSlug, ownType, requestTemplates, typesOf } from '../requestTypes';

/**
 * The Requests tab of the collection's admin page: the switch, and the request types the
 * admin makes up. Mounted under /admin.
 */
const router = express.Router();

/** What the Requests tab draws. */
export async function requestAdminData(res: any, t: (k: string, options?: any) => string) {
  const types = await typesOf(res.locals.activeCollectionId);
  return {
    enabled: requestsEnabled(res.locals.settings),
    types: types.map((type: any) => ({
      _id: idOf(type._id),
      slug: type.slug,
      name: type.name,
      icon: type.icon,
      description: type.description || '',
      enabled: type.enabled !== false,
      minRole: type.minRole,
      visibility: type.visibility,
      holder: type.holder,
      fields: type.fields || [],
      steps: type.steps || []
    })),
    templates: requestTemplates(t, registry.getEnabled(res.locals.settings)),
    icons: REQUEST_TYPE_ICONS,
    maxTypes: MAX_TYPES
  };
}

// POST /admin/requests/settings -> the switch, and which types are on
router.post('/requests/settings', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const collectionId = idOf(res.locals.activeCollectionId);
    await db.settings.updateOne(eq('collection', collectionId), {
      set: { requests: { enabled: req.body.enabled === 'on' } }
    }, { upsert: true });
    for (const type of await typesOf(collectionId)) {
      const enabled = req.body[`type_${type.slug}`] === 'on';
      if (enabled !== (type.enabled !== false)) {
        await db.requestTypes.updateOne(eq('_id', idOf(type._id)), { set: { enabled } });
      }
    }
    res.redirect('/admin?msg=saved#requests');
  } catch (err: any) {
    console.error('[ERR] Request settings:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

/** The builder sends JSON and reads JSON back: errors as translated sentences. */
function refuse(req: any, res: any, errors: string[]) {
  return res.status(400).json({ success: false, errors: errors.map(e => req.t(e)) });
}

// POST /admin/request-types -> a new type
router.post('/request-types', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const collectionId = idOf(res.locals.activeCollectionId);
    if ((await db.requestTypes.count(eq('collection', collectionId))) >= MAX_TYPES) {
      return refuse(req, res, ['requests.builder.err_too_many_types']);
    }
    const { type, errors } = cleanRequestType(req.body);
    if (!type) return refuse(req, res, errors);
    await db.requestTypes.create({
      ...type,
      collection: collectionId,
      slug: await freeSlug(collectionId, type.name),
      createdBy: idOf(req.user._id)
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] Create request type:', err.message);
    res.status(500).json({ success: false, errors: [req.t('errors.generic_server_error')] });
  }
});

// POST /admin/request-types/:id -> a type changed. Requests already sent keep the type as
// it read then; only new ones follow the change.
router.post('/request-types/:id', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const record = await ownType(res.locals.activeCollectionId, req.params.id);
    if (!record) return res.status(404).json({ success: false });
    const { type, errors } = cleanRequestType({ ...req.body, enabled: record.enabled !== false });
    if (!type) return refuse(req, res, errors);
    await db.requestTypes.updateOne(eq('_id', idOf(record._id)), { set: type });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[ERR] Update request type:', err.message);
    res.status(500).json({ success: false, errors: [req.t('errors.generic_server_error')] });
  }
});

// POST /admin/request-types/:id/delete -> gone from the forms. What was still waiting for
// an answer is called off; what is under way runs to its end from its own copy of the type.
router.post('/request-types/:id/delete', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const collectionId = idOf(res.locals.activeCollectionId);
    const record = await ownType(collectionId, req.params.id);
    if (record) {
      await db.requestTypes.deleteOne(and(eq('_id', idOf(record._id)), eq('collection', collectionId)));
      await db.requests.updateMany(
        and(eq('collection', collectionId), eq('type', record.slug), eq('status', 'pending')),
        { set: { status: 'cancelled' } }
      );
    }
    res.redirect('/admin?msg=saved#requests');
  } catch (err: any) {
    console.error('[ERR] Delete request type:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
