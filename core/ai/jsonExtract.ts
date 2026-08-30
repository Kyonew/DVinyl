/**
 * Pulling JSON out of a model's reply.
 *
 * The OpenAI-compatible layers DVinyl talks to do not all enforce a response schema —
 * Anthropic's compatibility layer documents that `strict` function calling is ignored —
 * and models habitually wrap their JSON in a code fence and a sentence of commentary. So
 * a reply is never handed to JSON.parse directly; it is scanned for the first balanced
 * bracketed run, which is parsed on its own.
 */

/** Envelope keys a model reaches for when told to return an array and it wraps it anyway. */
const ENVELOPE_KEYS = ['items', 'results', 'books', 'data', 'entries'];

/**
 * The first balanced `open`..`close` run in the text, respecting string literals so a
 * bracket inside a title cannot end the scan early. Returns null when nothing balances.
 */
function balancedSlice(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseOrNull(candidate: string | null): any {
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** The first JSON object in the text, or null. */
export function extractJsonObject(text: string): Record<string, any> | null {
  const parsed = parseOrNull(balancedSlice(text || '', '{', '}'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

/**
 * Every object the model returned, however it chose to wrap them: a bare array, a fenced
 * array, a lone object, or an array under an envelope key. Anything that is not an object
 * is dropped rather than allowed to reach a save path as a row.
 */
export function extractJsonArray(text: string): Record<string, any>[] {
  const source = text || '';
  const onlyObjects = (value: any): Record<string, any>[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is Record<string, any> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      : [];

  // An array first: the requested shape, and the one that must win when a reply holds both.
  const asArray = parseOrNull(balancedSlice(source, '[', ']'));
  if (Array.isArray(asArray)) return onlyObjects(asArray);

  const asObject = extractJsonObject(source);
  if (!asObject) return [];

  for (const key of ENVELOPE_KEYS) {
    if (Array.isArray(asObject[key])) return onlyObjects(asObject[key]);
  }
  return [asObject];
}
