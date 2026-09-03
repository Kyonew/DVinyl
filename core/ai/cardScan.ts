import { AiMessage } from './types';
import { getAiConfig } from './instance';
import { isAiConfigured } from './config';
import { aiChat, imagePart, textPart } from './client';
import { extractJsonObject } from './jsonExtract';

export interface CardScanGuess {
  title: string;
  setName: string;
  confidence: number;
}

/**
 * Below this, the guess is not worth spending the user's attention on: a wrong search
 * query sends them to a result list full of the wrong card, more confusing than being told
 * the photo could not be read. Same threshold as the barcode fallback (core/ai/barcode.ts).
 */
const MIN_CONFIDENCE = 0.5;

export function buildCardScanPrompt(image: string, mediaLabel: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'You identify trading cards from a photo of the physical card. ' +
        'Answer with a single JSON object and nothing else: ' +
        '{"title": string, "setName": string, "confidence": number between 0 and 1}. ' +
        '"title" is the card\'s exact printed name. "setName" is the expansion or set it ' +
        'belongs to, only if you can actually read or recognise it, otherwise an empty ' +
        'string. If you do not genuinely recognise the card, return {"title": "", "confidence": 0}. ' +
        'Never guess a plausible-sounding name: a wrong answer is worse than no answer.'
    },
    {
      role: 'user',
      content: [
        textPart(`Trading card game: ${mediaLabel}\nIdentify this card.`),
        imagePart(image)
      ]
    }
  ];
}

/** The guess in a reply, or null when the model declined, hedged, or answered unusably. */
export function parseCardScanReply(text: string): CardScanGuess | null {
  const parsed = extractJsonObject(text || '');
  if (!parsed) return null;

  const title = String(parsed.title || '').trim();
  if (!title) return null;

  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) return null;

  return {
    title,
    setName: String(parsed.setName || '').trim(),
    confidence
  };
}

/**
 * The identification guess for a photographed trading card, or null.
 *
 * Same contract as resolveBarcodeWithAi: this returns a guess, not an item — the caller
 * turns it into a search query for the plugin's own searchProvider (TCGdex, Scryfall,
 * YGOPRODeck...), so whatever the user eventually saves still comes from that provider,
 * never fabricated here. Returned as {title, setName} rather than a pre-joined string
 * because the set name is the part a vision model most often gets wrong (small, easy to
 * misread symbol) — the caller can verify a "title + set" query against the real provider
 * and fall back to the bare title if that guess turns up nothing (see the card-scan route
 * in itemRoutes.ts).
 */
export async function resolveCardScanWithAi(image: string, mediaLabel: string): Promise<CardScanGuess | null> {
  const config = await getAiConfig();
  if (!isAiConfigured(config)) return null;

  try {
    const result = await aiChat(config, buildCardScanPrompt(image, mediaLabel), {
      // A vision-capable model, and longer: identifying a card from a photo is slower
      // than a text lookup (see the barcode fallback's own DEFAULT_TIMEOUT_MS comment).
      model: config.visionModel,
      maxTokens: 200,
      timeoutMs: 30000
    });
    return parseCardScanReply(result.text);
  } catch (err: any) {
    // An assist that fails must leave the original path exactly as it was.
    console.error('[ERR] AI card scan:', err.message);
    return null;
  }
}
