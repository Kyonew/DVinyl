import { PluginDefinition } from './types';
import { ImportTargetField, Translate, buildMapRow, importableFields, sanitizeMapping } from './csvMapping';
import { CSV_DELIMITERS, CsvDelimiter, detectCsvDelimiter, parseCsv, parseCsvRecords } from './helpers';
import { CsvImportSpec, CsvRow } from './csvImport';

/**
 * The source-format-agnostic half of the generic CSV importer, shared by the web route
 * (`core/routes/csvImportRoute.ts`) and the API (via the import-job runner). It knows how
 * to preview a file and how to turn a validated mapping into the `mapRow` the engine
 * expects; it never answers an HTTP request itself, so each caller owns its own envelope.
 */

export const CSV_PREVIEW_ROWS = 3;

export type GenericCsvErrorCode = 'no_file' | 'empty' | 'unknown_module' | 'missing_required';

export interface GenericCsvPreview {
  delimiter: CsvDelimiter;
  columns: string[];
  total: number;
  duplicateColumns: boolean;
  samples: Record<string, string>[];
}

export interface GenericCsvFailure {
  error: GenericCsvErrorCode;
  /** The offending module id, or the list of unmapped required field labels. */
  detail?: string;
}

/** The requested separator when it is one we support, else the detected one. */
export function resolveDelimiter(requested: unknown, csv: string): CsvDelimiter {
  return (CSV_DELIMITERS as readonly string[]).includes(requested as string)
    ? (requested as CsvDelimiter)
    : detectCsvDelimiter(csv);
}

export function previewCsv(csv: unknown, requestedDelimiter?: unknown): { preview: GenericCsvPreview } | GenericCsvFailure {
  if (typeof csv !== 'string' || !csv.trim()) return { error: 'no_file' };

  const delimiter = resolveDelimiter(requestedDelimiter, csv);
  const records = parseCsvRecords(csv, delimiter);
  if (records.length === 0) return { error: 'empty' };

  // Read back from the raw matrix rather than from the records: duplicate headers
  // collapse into a single key, and the mapping screen must not offer a column the
  // rows cannot actually be read from.
  const columns = Object.keys(records[0]!);
  const headerCount = (parseCsv(csv, delimiter)[0] || []).length;

  return {
    preview: {
      delimiter,
      columns,
      total: records.length,
      duplicateColumns: headerCount > columns.length,
      samples: records.slice(0, CSV_PREVIEW_ROWS)
    }
  };
}

export interface GenericCsvTarget {
  plugin: PluginDefinition;
  delimiter: CsvDelimiter;
  fields: ImportTargetField[];
  spec: CsvImportSpec;
}

/**
 * Validates a generic CSV import body and builds the engine spec for it. Returns a
 * failure code the caller translates, so web and API keep their own error wordings.
 */
export function buildGenericCsvSpec(params: {
  body: any;
  settings: any;
  enabledPlugins: PluginDefinition[];
  t?: Translate;
}): { target: GenericCsvTarget } | GenericCsvFailure {
  const { body, settings, enabledPlugins, t } = params;

  const csv = body?.csv;
  if (typeof csv !== 'string' || !csv.trim()) return { error: 'no_file' };

  const requestedId = String(body?.plugin ?? '');
  const plugin = enabledPlugins.find(p => p.id === requestedId);
  if (!plugin) return { error: 'unknown_module', detail: requestedId };

  const delimiter = resolveDelimiter(body?.delimiter, csv);
  const records = parseCsvRecords(csv, delimiter);
  if (records.length === 0) return { error: 'empty' };

  const fields = importableFields(plugin, settings, t);
  const { mapping, missingRequired } = sanitizeMapping(body?.mapping, fields, Object.keys(records[0]!));
  if (missingRequired.length > 0) return { error: 'missing_required', detail: missingRequired.join(', ') };

  return {
    target: {
      plugin,
      delimiter,
      fields,
      spec: {
        plugin,
        delimiter,
        mapRow: buildMapRow(fields, mapping, t),
        // The support the row landed on, when the mapping fed one: providers that key
        // their search on it (Discogs) otherwise default to vinyl and would enrich a CD
        // import with the wrong pressings; the others ignore the option.
        searchOptions: (_row: CsvRow, data: Record<string, any>) => (data.media_type ? { type: data.media_type } : {})
      }
    }
  };
}
