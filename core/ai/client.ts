import { AiConfig, AiChatResult, AiContentPart, AiMessage } from './types';

export interface AiChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/** An error from the provider. `status` is the HTTP status when there was one. */
export class AiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    if (status !== undefined) this.status = status;
  }
}

/** A model that reasons over a shelf photo needs longer than a metadata lookup. */
const DEFAULT_TIMEOUT_MS = 30000;
/** Low but not zero: identification benefits from a little flexibility, invention does not. */
const DEFAULT_TEMPERATURE = 0.2;

export const textPart = (text: string): AiContentPart => ({ type: 'text', text });
export const imagePart = (url: string): AiContentPart => ({ type: 'image_url', image_url: { url } });

/** Digs the useful sentence out of a provider error body, whatever shape it arrived in. */
function providerMessage(body: any, status: number): string {
  const message = body?.error?.message || body?.message || body?.error;
  return typeof message === 'string' && message ? message : `HTTP error! status: ${status}`;
}

/**
 * One request to an OpenAI-compatible `/chat/completions` endpoint.
 *
 * Deliberately not built on fetchJson: a provider puts the sentence that explains the
 * failure ("Invalid API key", "model not found", "insufficient credits") in the response
 * body, and fetchJson throws on the status before the body can be read. Showing that
 * sentence to the admin is the difference between a fixable problem and a mystery.
 */
export async function aiChat(
  config: AiConfig,
  messages: AiMessage[],
  options: AiChatOptions = {}
): Promise<AiChatResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // A local endpoint (Ollama, LM Studio) takes no key, and some reject the header outright.
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const body = {
    model: options.model || config.model,
    messages,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.maxTokens ?? 4096
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
  } catch (err: any) {
    throw new AiError(err?.name === 'TimeoutError' ? 'AI request timed out' : `AI request failed: ${err?.message || err}`);
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new AiError(providerMessage(payload, response.status), response.status);
  }

  const content = payload?.choices?.[0]?.message?.content;
  return {
    text: typeof content === 'string' ? content : '',
    model: typeof payload?.model === 'string' ? payload.model : body.model
  };
}
