import express from 'express';
import { registry } from '../registry';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { buildGenericCsvSpec, previewCsv, GenericCsvFailure } from '../genericCsvImport';
import { runCsvImport } from '../csvImport';

/**
 * Generic CSV import: any file, into any enabled module, with the user mapping the
 * columns by hand. Unlike the plugin importers (Libib, Goodreads...) it knows no source
 * format, so it lives in the core and takes the target plugin from the request.
 *
 * Two steps, because a mapping screen cannot be drawn before the file is read: the
 * preview returns the columns and a few sample rows, then the import runs with the
 * mapping the user validated. The file itself is never stored server-side between the
 * two: the browser re-posts it, which keeps the flow stateless and leaves nothing to
 * clean up if the user walks away mid-mapping.
 *
 * The parsing and specification live in `core/genericCsvImport.ts`, shared with the
 * /api/v1 import-job route.
 */

const router = express.Router();

// Bulk imports are collection-admin only, same tier as the plugin importers.
const guards = [requireAuth, requireCollectionRole('admin')];

/** Translates a shared failure code; the web UI is localized, the API is not. */
function csvError(req: any, failure: GenericCsvFailure): string {
  const key = `admin.csv_import.err_${failure.error}`;
  return failure.error === 'missing_required'
    ? req.t(key, { fields: failure.detail })
    : req.t(key);
}

// POST /import/csv/preview -> columns, sample values and detected separator
router.post('/import/csv/preview', ...guards, (req: any, res: any) => {
  const result = previewCsv(req.body?.csv, req.body?.delimiter);
  if ('error' in result) return res.status(400).json({ error: csvError(req, result) });
  res.json(result.preview);
});

// POST /import/csv -> runs the import with a user-defined mapping
router.post('/import/csv', ...guards, (req: any, res: any) => {
  const settings = res.locals.settings;
  const result = buildGenericCsvSpec({
    body: req.body,
    settings,
    enabledPlugins: registry.getEnabled(settings),
    t: req.t
  });
  if ('error' in result) return res.status(400).json({ error: csvError(req, result) });

  return runCsvImport(req, res, result.target.spec);
});

export default router;
