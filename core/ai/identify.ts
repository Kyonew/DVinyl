import { extractJsonObject } from './jsonExtract';

/**
 * What a model believes an item is, from its barcode or a photo of it. Never saved as
 * such: it only becomes the query handed to the plugin's own source, whose results the
 * user picks from.
 */
export interface IdentificationGuess {
  title: string;
  creator: string;
  year: string;
  confidence: number;
}

/** The JSON shape every identification prompt asks for. */
export const IDENTIFICATION_SHAPE =
  '{"title": string, "creator": string, "year": string, "confidence": number between 0 and 1}';

/**
 * Below this, the guess is not worth spending the user's attention on: a wrong search
 * query sends them to a result list full of the wrong work, which is more confusing than
 * being told the item could not be identified.
 */
const MIN_CONFIDENCE = 0.5;

/** The guess in a reply, or null when the model declined, hedged, or answered unusably. */
export function parseIdentificationReply(text: string): IdentificationGuess | null {
  const parsed = extractJsonObject(text || '');
  if (!parsed) return null;

  const title = String(parsed.title || '').trim();
  if (!title) return null;

  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) return null;

  return {
    title,
    creator: String(parsed.creator || '').trim(),
    year: String(parsed.year || '').trim(),
    confidence
  };
}
