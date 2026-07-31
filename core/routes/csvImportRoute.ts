import express from 'express';
import { registry } from '../registry';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { CSV_DELIMITERS, detectCsvDelimiter, parseCsv, parseCsvRecords } from '../helpers';
import { runCsvImport } from '../csvImport';
import { buildMapRow, importableFields, sanitizeMapping } from '../csvMapping';

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
 */

const router = express.Router();

// Bulk imports are collection-admin only, same tier as the plugin importers.
const guards = [requireAuth, requireCollectionRole('admin')];

const SAMPLE_ROWS = 3;

/** The requested separator when it is one we support, else the detected one. */
function resolveDelimiter(requested: any, csv: string): string {
  return CSV_DELIMITERS.includes(requested) ? requested : detectCsvDelimiter(csv);
}

// POST /import/csv/preview -> columns, sample values and detected separator
router.post('/import/csv/preview', ...guards, (req: any, res: any) => {
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: req.t('admin.csv_import.err_no_file') });
  }

  const delimiter = resolveDelimiter(req.body?.delimiter, csv);
  const records = parseCsvRecords(csv, delimiter);
  if (records.length === 0) {
    return res.status(400).json({ error: req.t('admin.csv_import.err_empty') });
  }

  // Read back from the raw matrix rather than from the records: duplicate headers
  // collapse into a single key, and the mapping screen must not offer a column the
  // rows cannot actually be read from.
  const columns = Object.keys(records[0]!);
  const headerCount = (parseCsv(csv, delimiter)[0] || []).length;

  res.json({
    delimiter,
    columns,
    total: records.length,
    duplicateColumns: headerCount > columns.length,
    samples: records.slice(0, SAMPLE_ROWS)
  });
});

// POST /import/csv -> runs the import with a user-defined mapping
router.post('/import/csv', ...guards, (req: any, res: any) => {
  const csv = req.body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: req.t('admin.csv_import.err_no_file') });
  }

  const settings = res.locals.settings;
  const plugin = registry.get(String(req.body?.plugin || ''));
  if (!plugin || !registry.getEnabled(settings).some(p => p.id === plugin.id)) {
    return res.status(400).json({ error: req.t('admin.csv_import.err_unknown_module') });
  }

  const delimiter = resolveDelimiter(req.body?.delimiter, csv);
  const records = parseCsvRecords(csv, delimiter);
  if (records.length === 0) {
    return res.status(400).json({ error: req.t('admin.csv_import.err_empty') });
  }

  const fields = importableFields(plugin, settings, req.t);
  const { mapping, missingRequired } = sanitizeMapping(req.body?.mapping, fields, Object.keys(records[0]!));
  if (missingRequired.length > 0) {
    return res.status(400).json({
      error: req.t('admin.csv_import.err_missing_required', { fields: missingRequired.join(', ') })
    });
  }

  const mapRow = buildMapRow(fields, mapping, req.t);
  const creatorField = plugin.creatorField;

  return runCsvImport(req, res, {
    plugin,
    delimiter,
    mapRow,
    // Enrichment looks the item up by title and creator when the file carries one:
    // a bare title matches far too many releases on Discogs or TMDB.
    searchQuery: (_row, data) => [data.title, creatorField ? data[creatorField] : '']
      .filter(Boolean)
      .join(' ')
  });
});

export default router;
