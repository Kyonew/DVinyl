import { Router } from 'express';
import { requireApiAuth } from '../../../middleware/authMiddleware';
import { requireApiCollectionRole } from '../../../middleware/apiAuthMiddleware';
import { getCollectionSettings } from '../../../utils/collectionSettings';
import { buildCollectionBackup, buildCollectionCsv } from '../../../utils/backupOperations';
import { sendBackupArchive } from '../../../core/backupArchive';
import { ImportJob, createImportJob, findRunningJob, getImportJob } from '../../../utils/importJobs';
import { GenericCsvFailure, buildGenericCsvSpec, previewCsv } from '../../../core/genericCsvImport';
import { runCsvImport } from '../../../core/csvImport';
import { startImportJob } from '../../../utils/apiImportRunner';
import { registry } from '../../../core/registry';
import { importableFields } from '../../../core/csvMapping';
import { CSV_DELIMITERS } from '../../../core/helpers';

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

// ============ IMPORTER CATALOG (collection editor) ============

// The API returns raw i18n keys (the client localizes), so never route catalog
// labels through the request translator.
const rawLabel = (key: string) => key;

function serializeImporter(importer: any, plugin: any) {
  const ui = importer.ui;
  return {
    id: importer.id,
    pluginId: plugin.id,
    pluginLabel: plugin.label,
    requiresAdmin: !!importer.requireAdmin,
    generic: false,
    ui: ui ? {
      label: ui.label,
      icon: ui.icon,
      description: ui.description ?? null,
      color: ui.color ?? null,
      help: ui.help ?? [],
      warning: ui.warning ?? null,
      submitLabel: ui.submitLabel,
      fields: (ui.fields || []).map((f: any) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        required: !!f.required,
        placeholder: f.placeholder ?? null,
        hint: f.hint ?? null,
        accept: f.accept ?? null,
        fileEncoding: f.fileEncoding ?? null,
        default: f.default ?? null,
        options: f.options ?? null
      }))
    } : null
  };
}

function genericCsvImporter(enabled: any[]) {
  return {
    id: 'csv',
    pluginId: null,
    pluginLabel: null,
    requiresAdmin: true,
    generic: true,
    ui: {
      label: 'admin.csv_import.title',
      icon: 'fa-file-csv',
      description: 'admin.csv_import.subtitle',
      color: null,
      help: [],
      warning: null,
      submitLabel: 'admin.csv_import.btn_import',
      fields: [
        { name: 'csv', label: 'admin.csv_import.file_label', type: 'file', required: true, accept: '.csv', fileEncoding: 'text', placeholder: null, hint: null, default: null, options: null },
        { name: 'plugin', label: 'admin.csv_import.module_label', type: 'select', required: true, placeholder: null, hint: 'admin.csv_import.module_hint', accept: null, fileEncoding: null, default: null, options: enabled.map((p: any) => ({ value: p.id, label: p.label })) },
        { name: 'delimiter', label: 'admin.csv_import.delimiter_label', type: 'select', required: false, placeholder: null, hint: 'admin.csv_import.delimiter_hint', accept: null, fileEncoding: null, default: 'auto', options: CSV_DELIMITERS.map(d => ({ value: d, label: d })) },
        { name: 'type', label: 'admin.csv_import.target_label', type: 'select', required: false, placeholder: null, hint: null, accept: null, fileEncoding: null, default: 'collection', options: [ { value: 'collection', label: 'admin.csv_import.target_collection' }, { value: 'wishlist', label: 'admin.csv_import.target_wishlist' } ] },
        { name: 'enrich', label: 'admin.csv_import.enrich_label', type: 'select', required: false, placeholder: null, hint: 'admin.csv_import.enrich_hint', accept: null, fileEncoding: null, default: 'false', options: [ { value: 'false', label: 'common.no' }, { value: 'true', label: 'common.yes' } ] }
      ]
    }
  };
}

router.get('/collections/:id/importers', requireApiCollectionRole('editor'), async (req: any, res: any) => {
  const settings = await getCollectionSettings(req.apiCollection._id);
  const enabled = registry.getEnabled(settings);
  const importers = enabled.flatMap(p => (p.importers || []).map(i => serializeImporter(i, p)));
  importers.push(genericCsvImporter(enabled));
  res.status(200).json({
    importers,
    csv: {
      delimiters: [...CSV_DELIMITERS],
      targets: enabled.map(p => ({
        pluginId: p.id,
        collectionType: p.collectionType,
        label: p.label,
        fields: importableFields(p, settings, rawLabel)
      }))
    }
  });
});

// ============ GENERIC CSV IMPORT (collection admin) ============
//
// Route order in this file is load-bearing: the literal `csv`, `csv/preview` and
// `backup` paths must be registered before `:importerId`, or Express reads them as
// an importer id.

router.post('/collections/:id/imports/csv/preview', requireApiCollectionRole('admin'), (req: any, res: any) => {
  const result = previewCsv(req.body?.csv, req.body?.delimiter);
  if ('error' in result) {
    return res.status(400).json({ success: false, error: csvErrorText(result) });
  }
  res.status(200).json(result.preview);
});

router.post('/collections/:id/imports/csv', requireApiCollectionRole('admin'), async (req: any, res: any) => {
  const settings = await getCollectionSettings(req.apiCollection._id);
  const built = buildGenericCsvSpec({
    body: req.body,
    settings,
    enabledPlugins: registry.getEnabled(settings),
    t: req.t
  });
  if ('error' in built) {
    return res.status(400).json({ success: false, error: csvErrorText(built) });
  }

  const scopeKey = `collection:${req.apiCollection._id}`;
  if (runningConflict(res, scopeKey)) return;

  const job = createImportJob({
    kind: 'csv',
    collectionId: req.apiCollection._id,
    userId: req.user._id,
    minRole: 'admin',
    pluginId: built.target.plugin.id
  });
  res.status(202).json({ job: serializeJob(job) });
  startImportJob({
    req,
    res,
    job,
    collection: req.apiCollection,
    run: (r, s) => runCsvImport(r, s, built.target.spec)
  });
});

// ============ JOB POLLING (any member at the job's role) ============

router.get('/collections/:id/imports/:jobId', requireApiCollectionRole('editor'), (req: any, res: any) => {
  const job = getImportJob(String(req.params.jobId));
  if (!job || job.collectionId !== String(req.apiCollection._id)) {
    return res.status(404).json({ success: false, error: 'Import job not found' });
  }
  if (job.minRole === 'admin' && req.apiCollectionRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  res.status(200).json({ job: serializeJob(job) });
});

export = router;
