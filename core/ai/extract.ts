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
    // key out, including the ones that are dangerous to copy onto a plain object.
    for (const [name, field] of byName) {
      if (!Object.prototype.hasOwnProperty.call(entry, name)) continue;
      let value = toStringValue(entry[name]);
      // quantity (models/Item.ts) is the one field in this app whose valid range starts
      // at 1: a list rarely states how many copies of something you own, and the model
      // reliably writes 0 rather than an empty string for that unstated count. A literal
      // 0 fails the schema outright, so it's corrected to the same default(1) the field
      // itself declares - shown plainly in the review table rather than left blank and
      // relying on an invisible DB-level fallback. Every other number field (rating,
      // pages...) genuinely permits 0, so this is not generalised to numbers at large.
      if (name === 'quantity' && value === '0') value = '1';
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

/**
 * A reply that ran into the token cap is cut the same way when asked again, so it is not
 * worth a second request. Any other empty reply (a blank answer, a refusal, prose with no
 * array) is often a one-off and the same request then comes back fine.
 */
const MAX_ATTEMPTS = 2;

/** One extraction: prompt, call, parse, validate, with one more try when nothing usable came back. */
export async function extractRows(
  config: AiConfig,
  fields: ImportTargetField[],
  instruction: string,
  parts: AiContentPart[],
  options: AiChatOptions = {}
): Promise<ValidatedRow[]> {
  const messages = buildExtractionMessages(fields, instruction, parts);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await aiChat(config, messages, { maxTokens: 8192, ...options });
    const rows = validateRows(extractJsonArray(result.text), fields);
    if (rows.length > 0) return rows;

    // Worth seeing in the logs: the stop reason tells a cut reply ('length'), a filtered
    // one or a refusal apart from a model that genuinely found nothing.
    console.warn(
      `[AI] Extraction gave no usable row (attempt ${attempt}/${MAX_ATTEMPTS}, model ${result.model},`,
      `finish reason ${result.finishReason || 'none'}${result.refusal ? `, refusal ${JSON.stringify(result.refusal.slice(0, 200))}` : ''}).`,
      'Reply began with:', JSON.stringify(String(result.text || '').slice(0, 300))
    );
    if (result.finishReason === 'length') break;
  }
  return [];
}
