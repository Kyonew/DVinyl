import express from 'express';
import { registry } from '../registry';
import { requireAuth, requireCollectionRole } from '../../middleware/authMiddleware';
import { importableFields, buildMapRow, ImportMapping } from '../csvMapping';
import { runCsvImport } from '../csvImport';
import { getAiConfig } from '../ai/instance';
import { isAiConfigured } from '../ai/config';
import { extractRows } from '../ai/extract';
import { textPart } from '../ai/client';
import { AiExtractedRow } from '../ai/types';

/**
 * Import through the AI assist: the user describes what they own, in prose or from a
 * photo, and gets a table to correct before anything is written.
 *
 * The same two-step shape as the generic CSV import next door, for the same reason: the
 * review screen cannot be drawn until the extraction has run, and nothing is stored
 * server-side between the steps, so abandoning the flow leaves nothing behind.
 *
 * The second step is the CSV importer. The rows the model produced are keyed by field
 * name, which makes them CsvRows whose columns happen to be the destination fields, so an
 * identity mapping carries them into runCsvImport() and they inherit its deduplication,
 * its enrichment through the module's real provider, and its progress events.
 */

const router = express.Router();

// Same tier as the other bulk imports (see csvImportRoute.ts).
const guards = [requireAuth, requireCollectionRole('admin')];

/** Cap on one request, so a paste of a whole library cannot become one enormous prompt. */
const MAX_INPUT_CHARS = 20000;
const MAX_ROWS = 200;

function resolvePlugin(req: any, res: any) {
  const settings = res.locals.settings;
  const plugin = registry.get(String(req.body?.plugin || ''));
  if (!plugin || !registry.getEnabled(settings).some(p => p.id === plugin.id)) return null;
  return plugin;
}

// POST /import/ai/preview -> rows for the review table, nothing saved
router.post('/import/ai/preview', ...guards, async (req: any, res: any) => {
  const config = await getAiConfig();
  if (!isAiConfigured(config)) {
    return res.status(400).json({ error: req.t('ai.err_not_configured') });
  }

  const plugin = resolvePlugin(req, res);
  if (!plugin) return res.status(400).json({ error: req.t('admin.csv_import.err_unknown_module') });

  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: req.t('ai.err_no_input') });
  if (text.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ error: req.t('ai.err_input_too_long', { max: MAX_INPUT_CHARS }) });
  }

  const fields = importableFields(plugin, res.locals.settings, req.t);

  try {
    const rows = await extractRows(
      config,
      fields,
      `Extract every ${plugin.id} entry from the following list. ` +
      `Language of the input may be any; keep titles in their original language.`,
      [textPart(text)],
      { timeoutMs: 60000 }
    );
    res.json({
      rows: rows.slice(0, MAX_ROWS),
      truncated: rows.length > MAX_ROWS,
      fields: fields.map(f => ({ name: f.name, label: f.label, type: f.type, required: f.required, options: f.options }))
    });
  } catch (err: any) {
    console.error('[ERR] AI import preview:', err.message);
    res.status(502).json({ error: req.t('ai.err_extract_failed', { error: err.message }) });
  }
});

// POST /import/ai -> saves the rows the user reviewed
router.post('/import/ai', ...guards, (req: any, res: any) => {
  const plugin = resolvePlugin(req, res);
  if (!plugin) return res.status(400).json({ error: req.t('admin.csv_import.err_unknown_module') });

  const incoming = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (incoming.length === 0) return res.status(400).json({ error: req.t('ai.err_no_rows') });

  const fields = importableFields(plugin, res.locals.settings, req.t);
  const fieldNames = new Set(fields.map(f => f.name));

  // Re-validated here rather than trusted from the review screen: what comes back is a
  // POST body, and the browser is not the place this guarantee can live.
  const rows: AiExtractedRow[] = incoming.slice(0, MAX_ROWS).map((row: any) => {
    const clean: AiExtractedRow = {};
    if (row && typeof row === 'object') {
      for (const name of fieldNames) {
        const value = row[name];
        if (typeof value === 'string' && value.trim()) clean[name] = value.trim();
      }
    }
    return clean;
  }).filter((row: AiExtractedRow) => Object.keys(row).length > 0);

  if (rows.length === 0) return res.status(400).json({ error: req.t('ai.err_no_rows') });

  // Identity mapping: the model was asked for these field names, so each key is its own column.
  const mapping: ImportMapping = {};
  for (const field of fields) mapping[field.name] = { source: 'column', column: field.name };
  const mapRow = buildMapRow(fields, mapping, req.t);

  return runCsvImport(req, res, {
    plugin,
    rows,
    mapRow,
    // Without a searchQuery, enrichment falls back to the title alone (runCsvImport's
    // own default). Only combined with the creator for a plugin that opts in - see
    // includeCreatorInSearch's own comment for why this isn't the default for every
    // provider.
    ...(plugin.includeCreatorInSearch ? {
      searchQuery: (_row: any, data: Record<string, any>) => [data[plugin.creatorField], data.title].filter(Boolean).join(' ')
    } : {}),
    searchOptions: (_row: any, data: Record<string, any>) => (data.media_type ? { type: data.media_type } : {})
  });
});

export default router;
