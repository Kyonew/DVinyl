import { ImportTargetField } from '../csvMapping';
import { AiConfig, AiContentPart, AiExtractedRow } from './types';
import { extractJsonArray } from './jsonExtract';
import { buildExtractionMessages } from './prompt';
import { aiChat, AiChatOptions } from './client';

export interface ValidatedRow {
  values: AiExtractedRow;
  /** Required field names this row left empty. Shown in the review table, never saved as-is. */
  missingRequired: string[];
}

/** A model may answer with a number, an array of genres, or a null. All become strings. */
function toStringValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).join(', ');
  if (typeof value === 'object') return '';
  return String(value).trim();
}

/**
 * Turns whatever the model returned into rows this plugin could actually accept.
 *
 * The guarantees the rest of the pipeline leans on:
 *  - only field names the plugin declared survive, so a hallucinated key cannot reach a
 *    schema path (and an inherited key like __proto__ cannot reach anything at all);
 *  - every value is a trimmed string, which is what coerceValue() expects;
 *  - a row missing a required field is kept and flagged rather than dropped, because the
 *    review table can fix it and a silent disappearance cannot be noticed.
 */
export function validateRows(raw: Record<string, any>[], fields: ImportTargetField[]): ValidatedRow[] {
  const byName = new Map(fields.map(field => [field.name, field]));
  const rows: ValidatedRow[] = [];

  for (const entry of raw) {
    const values: AiExtractedRow = Object.create(null) as AiExtractedRow;
    let hasAnyValue = false;

    // Iterating the declared fields, not the model's keys, is what keeps an unexpected
    // key out — including the ones that are dangerous to copy onto a plain object.
    for (const [name, field] of byName) {
      if (!Object.prototype.hasOwnProperty.call(entry, name)) continue;
      const value = toStringValue(entry[name]);
      if (field.required || value) values[name] = value;
      if (value) hasAnyValue = true;
    }

    if (!hasAnyValue) continue;

    const missingRequired = fields
      .filter(field => field.required && !values[field.name])
      .map(field => field.name);

    rows.push({ values: { ...values }, missingRequired });
  }

  return rows;
}

/** One extraction round-trip: prompt, call, parse, validate. */
export async function extractRows(
  config: AiConfig,
  fields: ImportTargetField[],
  instruction: string,
  parts: AiContentPart[],
  options: AiChatOptions = {}
): Promise<ValidatedRow[]> {
  const result = await aiChat(config, buildExtractionMessages(fields, instruction, parts), {
    maxTokens: 8192,
    ...options
  });
  return validateRows(extractJsonArray(result.text), fields);
}
