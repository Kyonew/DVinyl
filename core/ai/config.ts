import { AiConfig, AiProviderId } from './types';
import { getProviderPreset, DEFAULT_PROVIDER_ID } from './providers';
import { decryptSecret } from './secret';

/** The shape stored on InstanceSettings.ai. */
export interface StoredAiSettings {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  visionModel: string;
  apiKeyEncrypted: string;
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/**
 * The effective AI configuration: what is stored on the instance, with the AI_*
 * environment variables taking precedence.
 *
 * Environment first matches how every other credential in DVinyl is supplied
 * (DISCOGS_TOKEN, TMDB_API_KEY...), so a Docker-secrets install never has to touch the
 * admin panel, while everyone else configures it from the UI.
 *
 * Pure by design: it reads process.env and its argument, and touches no database, which
 * is what makes the precedence rules testable.
 */
export function resolveAiConfig(stored: StoredAiSettings | null | undefined): AiConfig {
  const envKey = process.env.AI_API_KEY || '';
  const envBaseUrl = process.env.AI_BASE_URL || '';
  const envModel = process.env.AI_MODEL || '';
  const envProvider = process.env.AI_PROVIDER || '';
  const fromEnv = Boolean(envKey || envBaseUrl || envModel || envProvider);

  const providerId = envProvider || stored?.provider || DEFAULT_PROVIDER_ID;
  const preset = getProviderPreset(providerId) || getProviderPreset(DEFAULT_PROVIDER_ID)!;

  const baseUrl = stripTrailingSlash(envBaseUrl || stored?.baseUrl || preset.baseUrl);
  const model = envModel || stored?.model || preset.defaultModel;
  const visionModel = stored?.visionModel || model;
  const apiKey = envKey || decryptSecret(stored?.apiKeyEncrypted || '');

  return {
    // A key supplied through the environment is an explicit act of configuration, so it
    // turns the feature on without a second switch in the admin panel.
    enabled: Boolean(envKey) || stored?.enabled === true,
    provider: preset.id as AiProviderId,
    baseUrl,
    model,
    visionModel,
    apiKey,
    fromEnv
  };
}

/**
 * The base URL a save should actually persist. Only the custom provider has a
 * user-supplied endpoint; every hosted preset's URL is fixed by the provider choice
 * itself, so a value here would be persisted as an explicit override that shadows the
 * preset's own baseUrl on every future read — including after switching to a
 * different provider. This is why the panel's (hidden, unedited) base-URL field can
 * never be trusted as-is: what it holds after a GET is the *resolved* baseUrl, which
 * already has the current preset's default filled in, not the raw stored one.
 */
export function normalizeStoredBaseUrl(provider: string, baseUrl: string): string {
  return provider === 'custom' ? baseUrl.trim() : '';
}

/**
 * True when a request can actually be sent. A local endpoint (Ollama, LM Studio) needs no
 * key, so the key is only required of the hosted presets.
 */
export function isAiConfigured(config: AiConfig): boolean {
  if (!config.enabled) return false;
  if (!config.baseUrl || !config.model) return false;
  if (config.provider !== 'custom' && !config.apiKey) return false;
  return true;
}
