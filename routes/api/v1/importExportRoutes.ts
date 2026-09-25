import { Router } from 'express';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { buildCollectionBackup, buildCollectionCsv } from '../../../utils/backupOperations';
import { sendBackupArchive } from '../../../core/backupArchive';
import { ImportJob, findRunningJob } from '../../../utils/importJobs';
import { GenericCsvFailure } from '../../../core/genericCsvImport';

/**
 * Import and export over /api/v1.
 *
 * Exports are ordinary authenticated file responses. Imports are jobs: the client posts
 * the request, receives a job id, and polls it, because a real import (a Discogs sync, a
 * large CSV) runs for minutes and must survive the app going to the background. The job
 * mechanics live in utils/importJobs.ts and utils/apiImportRunner.ts; this router owns
 * the HTTP contract.
 */

const router = Router();

router.use(requireApiAuth);

const fileNameDate = () => new Date().toISOString().split('T')[0];

/** The public shape of a job; internal fields (userId, scopeKey, minRole) stay server-side. */
function serializeJob(job: ImportJob) {
  return {
    id: job.id,
    kind: job.kind,
    importerId: job.importerId,
    pluginId: job.pluginId,
    collectionId: job.collectionId,
    status: job.status,
    current: job.current,
    total: job.total,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

/** Answers 409 with the running job when the scope is busy; true when it answered. */
function runningConflict(res: any, scopeKey: string): boolean {
  const running = findRunningJob(scopeKey);
  if (!running) return false;
  res.status(409).json({
    success: false,
    error: 'An import is already running',
    code: 'import_running',
    job: serializeJob(running)
  });
  return true;
}

/** Plain English for the shared CSV failure codes; the API does not localize. */
function csvErrorText(failure: GenericCsvFailure): string {
  switch (failure.error) {
    case 'no_file': return 'Missing CSV data';
    case 'empty': return 'CSV file is empty or invalid';
    case 'unknown_module': return `Unknown module: ${failure.detail}`;
    case 'missing_required': return `Missing required fields: ${failure.detail}`;
  }
}

// ============ COLLECTION EXPORTS (collection admin) ============

router.get('/collections/:id/export', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const collection = req.apiCollection;
    const data = await buildCollectionBackup(collection._id, collection);
    const slug = collection?.slug || 'collection';
    res.setHeader('Content-disposition', `attachment; filename=dvinyl_collection-${slug}_${fileNameDate()}.json`);
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('[API] Collection export failed:', err);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

router.get('/collections/:id/export.csv', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const collection = req.apiCollection;
    const settings = await getCollectionSettings(collection._id);
    const { csv, fileName } = await buildCollectionCsv({
      req,
      collectionId: collection._id,
      collection,
      settings
    });
    res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-type', 'text/csv; charset=utf-8');
    res.send(csv);
  } catch (err: any) {
    console.error('[API] Collection CSV export failed:', err);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

router.get('/collections/:id/export.zip', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  try {
    const collection = req.apiCollection;
    const data = await buildCollectionBackup(collection._id, collection);
    const slug = collection?.slug || 'collection';
    await sendBackupArchive(res, data, `dvinyl_collection-${slug}_${fileNameDate()}.zip`);
  } catch (err: any) {
    console.error('[API] Collection archive export failed:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Export failed' });
    else res.destroy(err as Error);
  }
});

export = router;
