/** Providers DVinyl ships a preset for. 'custom' is any other OpenAI-compatible endpoint. */
export type AiProviderId = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  /** Base URL without a trailing slash; '' for 'custom', where the user supplies it. */
  baseUrl: string;
  defaultModel: string;
  /** Model suggested for image input; '' when the provider has no vision model worth defaulting to. */
  defaultVisionModel: string;
  /** Where the user goes to create a key. Shown in the admin panel. */
  docsUrl: string;
}

/** Effective configuration, after the environment has overridden the stored values. */
export interface AiConfig {
  enabled: boolean;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  visionModel: string;
  apiKey: string;
  /** True when at least one value came from the environment rather than the database. */
  fromEnv: boolean;
}

/** One part of a multimodal message. */
export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AiContentPart[];
}

export interface AiChatResult {
  /** The assistant's reply text, or '' when the provider returned no choice. */
  text: string;
  model: string;
}

/** One row the model produced, keyed by an importable field name. Values are raw strings. */
export type AiExtractedRow = Record<string, string>;
