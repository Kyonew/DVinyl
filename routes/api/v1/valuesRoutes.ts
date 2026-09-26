import { Router } from 'express';
import mongoose from 'mongoose';
import Item from '../../../models/Item';
import Settings from '../../../models/Settings';
import { registry } from '../../../core/registry';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { resolveMemberRole, roleAtLeast } from '../../../utils/collectionHelpers';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { applyVisibilityFilter } from '../../../utils/visibilityHelper';
import { readEstimateHistory } from '../../../utils/priceHistory';
import { getValueEstimateJob, startValueEstimate } from '../../../utils/valueEstimates';

const router = Router();

router.use(requireApiAuth);

const MAX_CONDITION_LENGTH = 20;

router.get('/items/:itemId/estimate', async (req: any, res: any) => {
  const { itemId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const item: any = await Item.findById(itemId).lean();
  if (!item || !item.collection) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const { role } = await resolveMemberRole(req.user, item.collection);
  if (!roleAtLeast(role, 'viewer')) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  // Mirrors GET /items/:itemId: an item the collection hides from viewers is not
  // priceable by id either (same id-non-disclosure rule).
  const settings: any = await Settings.findOne({ collection: item.collection }).lean();
  const visibilityQuery: any = { _id: item._id };
  applyVisibilityFilter(visibilityQuery, role === 'admin', settings);
  const visible = await Item.findOne(visibilityQuery).select('_id').lean();
  if (!visible) {
    return res.status(404).json({ success: false, error: 'Item not found' });
  }

  const plugin = registry.getByKind(item.kind);
  if (!plugin || !plugin.estimatePrice || !plugin.externalIdField) {
    return res.status(404).json({ success: false, error: 'Price estimation is not supported for this item' });
  }

  const externalId = item[plugin.externalIdField];
  if (externalId === undefined || externalId === null || externalId === '') {
    return res.status(404).json({ success: false, error: 'Price estimation is not supported for this item' });
  }

  const condition = String(req.query.condition || '').trim().slice(0, MAX_CONDITION_LENGTH);

  try {
    const estimate = await plugin.estimatePrice(String(externalId), {
      condition,
      currency: req.user.currency || 'USD'
    });
    if (!estimate) {
      return res.status(200).json({ estimate: null, reason: 'unavailable' });
    }
    res.status(200).json({ estimate });
  } catch (err: any) {
    console.error(`API price estimate error for item ${itemId}:`, err.message);
    res.status(502).json({ success: false, error: `Price provider error: ${err.message}` });
  }
});

router.get('/collections/:id/value-history', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  const currency = req.user.currency || 'USD';
  res.status(200).json(await readEstimateHistory(req.apiCollection._id, currency));
});

/** The client-facing subset of a job: no userId/collectionId/currency bookkeeping. */
function serializeJob(job: any) {
  const out: any = {
    id: job.id,
    status: job.status,
    progress: { processed: job.processed, total: job.total }
  };
  if (job.status === 'done') {
    out.result = {
      value: job.value,
      minValue: job.minValue,
      maxValue: job.maxValue,
      itemCount: job.total,
      currency: job.currency,
      pricedCount: job.pricedCount,
      failedCount: job.failedCount,
      saved: job.saved
    };
  }
  if (job.status === 'error') out.error = job.error;
  return out;
}

router.post('/collections/:id/value-estimate', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const settings = await getCollectionSettings(req.apiCollection._id);
  const outcome = await startValueEstimate({
    collectionId: req.apiCollection._id,
    user: req.user,
    settings
  });

  if (outcome.error === 'running') {
    return res.status(409).json({
      success: false,
      error: 'An estimate is already running',
      estimate: serializeJob(outcome.activeJob)
    });
  }
  if (outcome.error === 'no_items') {
    return res.status(400).json({ success: false, error: 'No estimable items' });
  }
  res.status(202).json({ estimate: serializeJob(outcome.job) });
});

router.get('/collections/:id/value-estimate/:jobId', requireApiCollectionRole('viewer'), async (req: any, res: any) => {
  const job = getValueEstimateJob(req.params.jobId);
  if (!job || job.collectionId !== String(req.apiCollection._id) || job.userId !== String(req.user._id)) {
    return res.status(404).json({ success: false, error: 'Estimate not found' });
  }
  res.status(200).json({ estimate: serializeJob(job) });
});

export = router;
