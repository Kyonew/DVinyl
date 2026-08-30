import InstanceSettings from '../../models/InstanceSettings';
import { AiConfig } from './types';
import { resolveAiConfig, normalizeStoredBaseUrl, StoredAiSettings } from './config';
import { encryptSecret } from './secret';

/**
 * The AI config as the running app sees it.
 *
 * Cached briefly for the same reason utils/instanceSettings.ts caches its document: this
 * is consulted on request paths (the barcode fallback sits in the middle of a search), and
 * re-reading a singleton for every lookup is a query nobody needs. The cache is dropped
 * outright whenever the settings are saved, so the admin panel never shows a stale state.
 */
const CACHE_TTL_MS = 30000;

let cached: { config: AiConfig; at: number } | null = null;

export function invalidateAiConfigCache(): void {
  cached = null;
}

/** The raw stored document, undecrypted key and all - for anything that needs to fall
 * back to it field-by-field (the test-connection route) rather than the fully-resolved
 * config. */
export async function getStoredAiSettings(): Promise<StoredAiSettings | null> {
  try {
    const doc: any = await InstanceSettings.findOne({ key: 'instance' }).lean();
    return (doc?.ai as StoredAiSettings) || null;
  } catch (err: any) {
    // A database hiccup must not take a search page down with it: AI is an assist, and
    // an unresolved config simply reads as "not configured".
    console.error('[ERR] AI config read:', err.message);
    return null;
  }
}

export async function getAiConfig(): Promise<AiConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.config;

  const stored = await getStoredAiSettings();
  const config = resolveAiConfig(stored);
  cached = { config, at: Date.now() };
  return config;
}

export interface AiSettingsInput {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  visionModel: string;
  /** Absent or empty leaves the stored key untouched; '__clear__' removes it. */
  apiKey?: string;
}

export async function saveAiSettings(input: AiSettingsInput): Promise<void> {
  const update: Record<string, any> = {
    'ai.enabled': input.enabled,
    'ai.provider': input.provider,
    'ai.baseUrl': normalizeStoredBaseUrl(input.provider, input.baseUrl),
    'ai.model': input.model.trim(),
    'ai.visionModel': input.visionModel.trim()
  };

  // An untouched key field must not wipe the stored key: the panel never renders it back,
  // so an empty box means "unchanged", and clearing is an explicit act.
  if (input.apiKey === '__clear__') {
    update['ai.apiKeyEncrypted'] = '';
  } else if (input.apiKey) {
    update['ai.apiKeyEncrypted'] = encryptSecret(input.apiKey.trim());
  }

  await InstanceSettings.updateOne({ key: 'instance' }, { $set: update }, { upsert: true });
  invalidateAiConfigCache();
}
