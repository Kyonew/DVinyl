import { AiConfig, AiMessage } from './types';
import { aiChat, imagePart, textPart } from './client';
import { IdentificationGuess, IDENTIFICATION_SHAPE, parseIdentificationReply } from './identify';

/**
 * The prompt for one photo of one item. `creatorField` is the plugin's own name for who
 * made it (artist, author, director, developer...), so the answer lines up with the field
 * the search results are matched on.
 */
export function buildPhotoPrompt(image: string, mediaLabel: string, creatorField: string): AiMessage[] {
  return [
    {
      role: 'system',
      content:
        'You identify one collectible item from a photograph of it: a cover, a spine, a box, ' +
        'a disc or a label. Answer with a single JSON object and nothing else: ' +
        `${IDENTIFICATION_SHAPE}. ` +
        `"creator" is the item's ${creatorField || 'creator'}. ` +
        'Read the text printed on the item first, and rely on the artwork alone only when no ' +
        'text is legible. Give the title of the work itself, without edition, format or ' +
        'retail wording such as "Deluxe Edition", "Blu-ray", "Remastered" or "Collector". ' +
        'If several items are visible, identify the most prominent one. ' +
        'If you cannot tell what it is, return {"title": "", "confidence": 0}. ' +
        'Never guess a plausible-sounding title: a wrong answer is worse than no answer.'
    },
    {
      role: 'user',
      content: [textPart(`Media type: ${mediaLabel}\nIdentify this item.`), imagePart(image)]
    }
  ];
}

/**
 * What the photographed item probably is, or null when the model could not tell. A
 * failing provider throws: the user clicked for this, and is owed the reason.
 */
export async function identifyFromPhoto(
  config: AiConfig,
  image: string,
  mediaLabel: string,
  creatorField: string
): Promise<IdentificationGuess | null> {
  const result = await aiChat(config, buildPhotoPrompt(image, mediaLabel, creatorField), {
    model: config.visionModel,
    maxTokens: 200,
    timeoutMs: 60000
  });
  return parseIdentificationReply(result.text);
}
