import { AiMessage } from './types';
import { getAiConfig } from './instance';
import { isAiConfigured } from './config';
import { aiChat } from './client';
import { IdentificationGuess, IDENTIFICATION_SHAPE, parseIdentificationReply } from './identify';

export function buildBarcodePrompt(code: string, mediaLabel: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'You identify retail products from their barcode. ' +
        'Answer with a single JSON object and nothing else: ' +
        `${IDENTIFICATION_SHAPE}. ` +
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

/**
 * What a barcode the UPC database could not resolve probably is, or null.
 *
 * A guess, not an item: it only becomes the query handed to the module's own source (see
 * searchWithGuess), so what the user eventually saves still comes from TMDB or IGDB. The
 * model only supplies a better search string than twelve digits.
 */
export async function resolveBarcodeWithAi(code: string, mediaLabel: string): Promise<IdentificationGuess | null> {
  const config = await getAiConfig();
  if (!isAiConfigured(config)) return null;

  try {
    const result = await aiChat(config, buildBarcodePrompt(code, mediaLabel), {
      maxTokens: 200,
      timeoutMs: 20000
    });
    return parseIdentificationReply(result.text);
  } catch (err: any) {
    // An assist that fails must leave the original path exactly as it was.
    console.error('[ERR] AI barcode resolve:', err.message);
    return null;
  }
}
