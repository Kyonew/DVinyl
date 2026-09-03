import { AiMessage } from './types';
import { getAiConfig } from './instance';
import { isAiConfigured } from './config';
import { aiChat } from './client';
import { extractJsonObject } from './jsonExtract';

export interface BarcodeGuess {
  title: string;
  creator: string;
  year: string;
  confidence: number;
}

/**
 * Below this, the guess is not worth spending the user's attention on: a wrong search
 * query sends them to a result list full of the wrong work, which is more confusing than
 * being told the barcode was not found.
 */
const MIN_CONFIDENCE = 0.5;

export function buildBarcodePrompt(code: string, mediaLabel: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'You identify retail products from their barcode. ' +
        'Answer with a single JSON object and nothing else: ' +
        '{"title": string, "creator": string, "year": string, "confidence": number between 0 and 1}. ' +
        '"creator" is the author, artist, studio or publisher, whichever fits the media. ' +
        'If you do not genuinely recognise the code, return {"title": "", "confidence": 0}. ' +
        'Never guess a plausible-sounding title: a wrong answer is worse than no answer.'
    },
    {
      role: 'user',
      content: `Barcode: ${code}\nMedia type: ${mediaLabel}\nIdentify this product.`
    }
  ];
}

/** The guess in a reply, or null when the model declined, hedged, or answered unusably. */
export function parseBarcodeReply(text: string): BarcodeGuess | null {
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

/**
 * A search query for a barcode the UPC database could not resolve, or null.
 *
 * Returns a *query*, not an item: the guess is handed to the module's real metadata
 * provider, so what the user eventually saves still comes from Hardcover, Discogs or TMDB.
 * The model only supplies a better search string than twelve digits.
 */
export async function resolveBarcodeWithAi(code: string, mediaLabel: string): Promise<string | null> {
  const config = await getAiConfig();
  if (!isAiConfigured(config)) return null;

  try {
    const result = await aiChat(config, buildBarcodePrompt(code, mediaLabel), {
      maxTokens: 200,
      timeoutMs: 20000
    });
    const guess = parseBarcodeReply(result.text);
    if (!guess) return null;
    // The creator sharpens the query for the providers that index it, and the ones that
    // do not are handled by the existing title fallback, which drops trailing words.
    return [guess.title, guess.creator].filter(Boolean).join(' ');
  } catch (err: any) {
    // An assist that fails must leave the original path exactly as it was.
    console.error('[ERR] AI barcode resolve:', err.message);
    return null;
  }
}
