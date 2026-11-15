import express from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { importStateFor } from '../importJobs';

/**
 * GET /import/status -> the last import this account started in the active collection.
 *
 * Asked by the import screens whenever they may have missed an event (on a timer, when
 * the socket reconnects, when the tab comes back). `job: null` means there is nothing to
 * report: never started, long finished, or lost to a restart.
 */
const router = express.Router();

router.get('/import/status', requireAuth, (req: any, res: any) => {
  const job = importStateFor(req.user?._id, res.locals.activeCollectionId);
  res.set('Cache-Control', 'no-store');
  if (!job) return res.json({ job: null });
  res.json({
    job: {
      id: job.id,
      status: job.status,
      current: job.current,
      total: job.total,
      result: job.result || null,
      error: job.error || ''
    }
  });
});

export default router;
