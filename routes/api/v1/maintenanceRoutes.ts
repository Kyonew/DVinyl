import { Router } from 'express';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { registry } from '../../../core/registry';
import Item from '../../../models/Item';
import { deleteItemsAndContents } from '../../../utils/itemHelpers';
import { collectRefreshItems, runPluginRefresh } from '../../../utils/refreshAll';
import {
  RefreshJob, createRefreshJob, failRefreshJob, findRunningRefreshJob, finishRefreshJob,
  getRefreshJob, refreshScopeKey, setRefreshProgress
} from '../../../utils/refreshJobs';

const router = Router();

router.use(requireApiAuth);

const MAX_ITEM_DELETE_COUNT = 10000;

/** The public shape of a job; internal fields (userId, scopeKey) stay server-side. */
function serializeRefreshJob(job: RefreshJob) {
  return {
    id: job.id,
    pluginId: job.pluginId,
    mode: job.mode,
    status: job.status,
    current: job.current,
    total: job.total,
    currentTitle: job.currentTitle,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

router.post('/collections/:id/refresh-all', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const { pluginId, mode } = req.body ?? {};

  const plugin = typeof pluginId === 'string' && pluginId ? registry.get(pluginId) : undefined;
  if (!plugin) {
    return res.status(404).json({ success: false, error: 'Plugin not found' });
  }
  if (!plugin.refreshItem) {
    return res.status(400).json({ success: false, error: 'Plugin does not support refresh' });
  }
  if (mode !== undefined && mode !== 'all' && mode !== 'missing') {
    return res.status(400).json({ success: false, error: 'Invalid mode' });
  }

  const collection = req.apiCollection;
  const scopeKey = refreshScopeKey(collection._id, plugin.id);
  const running = findRunningRefreshJob(scopeKey);
  if (running) {
    return res.status(409).json({
      success: false,
      error: 'A refresh is already running',
      code: 'refresh_running',
      job: serializeRefreshJob(running)
    });
  }

  const job = createRefreshJob({
    collectionId: collection._id,
    pluginId: plugin.id,
    mode: mode ?? 'all',
    userId: req.user._id
  });
  res.status(202).json({ job: serializeRefreshJob(job) });

  (async () => {
    try {
      const items = await collectRefreshItems(plugin, collection._id, job.mode);
      const { refreshed, failed } = await runPluginRefresh({
        plugin,
        items,
        mode: job.mode,
        req,
        onProgress: (p) => setRefreshProgress(job, p.current, p.total, p.title)
      });
      finishRefreshJob(job, { refreshed, failed, total: items.length });
    } catch (err: any) {
      failRefreshJob(job, err?.message || 'Refresh failed');
    }
  })();
});

router.get('/collections/:id/refresh-jobs/:jobId', requireApiCollectionRole('admin'), (req: any, res: any) => {
  const job = getRefreshJob(String(req.params.jobId));
  if (!job || job.collectionId !== String(req.apiCollection._id)) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.status(200).json({ job: serializeRefreshJob(job) });
});

router.post('/collections/:id/delete-last-items', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const { count, pluginId } = req.body ?? {};

  if (!Number.isInteger(count) || count < 1 || count > MAX_ITEM_DELETE_COUNT) {
    return res.status(400).json({ success: false, error: 'Invalid count' });
  }

  const plugin = typeof pluginId === 'string' && pluginId ? registry.get(pluginId) : undefined;
  if (!plugin) {
    return res.status(400).json({ success: false, error: 'Unknown plugin' });
  }

  try {
    // Counted the way the grid counts: "the last 3 items" means the last 3 lines someone
    // can see, and a show leaves with its seasons rather than counting as several.
    const items = await Item.find({
      collection: req.apiCollection._id,
      kind: plugin.kind,
      parent: { $exists: false }
    })
      .sort({ added_at: -1, _id: -1 })
      .limit(count)
      .select('_id');

    const deleted = await deleteItemsAndContents(items.map((i: any) => i._id));
    res.status(200).json({ success: true, deleted });
  } catch (err: any) {
    console.error('API delete-last-items error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export = router;
