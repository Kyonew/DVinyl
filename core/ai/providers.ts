import { AiProviderId, AiProviderPreset } from './types';

/**
 * Every provider here speaks the OpenAI `POST {baseUrl}/chat/completions` shape, which is
 * why DVinyl needs one client and no per-provider adapters: Anthropic and Gemini both
 * publish OpenAI-compatible layers at the base URLs below.
 *
 * Model ids move fast. These are defaults to get someone started, not a recommendation,
 * and the admin panel lets any model id be typed in.
 */
export const AI_PROVIDERS: AiProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    defaultVisionModel: 'openai/gpt-4o-mini',
    docsUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultVisionModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    defaultVisionModel: 'claude-sonnet-4-5',
    docsUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    defaultVisionModel: 'gemini-2.0-flash',
    docsUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModel: '',
    defaultVisionModel: '',
    docsUrl: ''
  }
];

export const DEFAULT_PROVIDER_ID: AiProviderId = 'openrouter';

export function getProviderPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDERS.find(p => p.id === id);
}
