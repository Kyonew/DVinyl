import { test, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-session-secret';

let encryptSecret: (plain: string) => string;
let resolveAiConfig: (typeof import('./config'))['resolveAiConfig'];
let resolveTestConfig: (typeof import('./config'))['resolveTestConfig'];
let isAiConfigured: (typeof import('./config'))['isAiConfigured'];
let normalizeStoredBaseUrl: (typeof import('./config'))['normalizeStoredBaseUrl'];

before(async () => {
  ({ encryptSecret } = await import('./secret'));
  ({ resolveAiConfig, resolveTestConfig, isAiConfigured, normalizeStoredBaseUrl } = await import('./config'));
});

const AI_ENV = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROVIDER'];

beforeEach(() => {
  for (const name of AI_ENV) delete process.env[name];
});

test('an absent stored document yields a disabled, unconfigured config', () => {
  const config = resolveAiConfig(null);
  assert.equal(config.enabled, false);
  assert.equal(config.apiKey, '');
  assert.equal(isAiConfigured(config), false);
});

test('stored values are used and the key is decrypted', () => {
  const config = resolveAiConfig({
    enabled: true,
    provider: 'openrouter',
    baseUrl: '',
    model: 'openai/gpt-4o-mini',
    visionModel: '',
    apiKeyEncrypted: encryptSecret('sk-stored')
  });
  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, 'sk-stored');
  assert.equal(config.baseUrl, 'https://openrouter.ai/api/v1', 'falls back to the preset base URL');
  assert.equal(config.model, 'openai/gpt-4o-mini');
  assert.equal(config.fromEnv, false);
  assert.equal(isAiConfigured(config), true);
});

test('the environment overrides the stored key, base URL and model', () => {
  process.env.AI_API_KEY = 'sk-from-env';
  process.env.AI_BASE_URL = 'http://localhost:11434/v1';
  process.env.AI_MODEL = 'llama3';
  const config = resolveAiConfig({
    enabled: true,
    provider: 'openrouter',
    baseUrl: '',
    model: 'openai/gpt-4o-mini',
    visionModel: '',
    apiKeyEncrypted: encryptSecret('sk-stored')
  });
  assert.equal(config.apiKey, 'sk-from-env');
  assert.equal(config.baseUrl, 'http://localhost:11434/v1');
  assert.equal(config.model, 'llama3');
  assert.equal(config.fromEnv, true);
});

test('AI_API_KEY alone enables AI even with nothing stored', () => {
  process.env.AI_API_KEY = 'sk-from-env';
  process.env.AI_MODEL = 'gpt-4o-mini';
  const config = resolveAiConfig(null);
  assert.equal(config.enabled, true);
  assert.equal(isAiConfigured(config), true);
});

test('a trailing slash is stripped from the base URL', () => {
  process.env.AI_BASE_URL = 'http://localhost:11434/v1/';
  const config = resolveAiConfig(null);
  assert.equal(config.baseUrl, 'http://localhost:11434/v1');
});

test('an unknown provider falls back to the default preset', () => {
  const config = resolveAiConfig({
    enabled: true,
    provider: 'bogus',
    baseUrl: '',
    model: '',
    visionModel: '',
    apiKeyEncrypted: encryptSecret('sk-x')
  });
  assert.equal(config.provider, 'openrouter');
  assert.equal(config.model, 'openai/gpt-4o-mini', 'falls back to the preset default model');
});

test('a config with no model or no base URL is not configured', () => {
  assert.equal(isAiConfigured(resolveAiConfig({
    enabled: true, provider: 'custom', baseUrl: '', model: 'x',
    visionModel: '', apiKeyEncrypted: encryptSecret('sk-x')
  })), false, 'custom with no base URL');

  assert.equal(isAiConfigured(resolveAiConfig({
    enabled: true, provider: 'custom', baseUrl: 'http://h/v1', model: '',
    visionModel: '', apiKeyEncrypted: encryptSecret('sk-x')
  })), false, 'no model');
});

test('a disabled config is never configured, whatever it holds', () => {
  const config = resolveAiConfig({
    enabled: false, provider: 'openrouter', baseUrl: '', model: 'm',
    visionModel: '', apiKeyEncrypted: encryptSecret('sk-x')
  });
  assert.equal(isAiConfigured(config), false);
});

test('normalizeStoredBaseUrl keeps an explicit override only for the custom provider', () => {
  assert.equal(normalizeStoredBaseUrl('custom', '  http://localhost:11434/v1  '), 'http://localhost:11434/v1');
});

test('normalizeStoredBaseUrl drops a hosted preset\'s base URL even when the panel echoed it back', () => {
  // GET returns the *resolved* baseUrl (a preset default already filled in) for display,
  // not the raw stored one. A save must not trust that value back for a hosted preset,
  // or picking OpenRouter once permanently shadows every other provider's own endpoint.
  assert.equal(normalizeStoredBaseUrl('openrouter', 'https://openrouter.ai/api/v1'), '');
  assert.equal(normalizeStoredBaseUrl('anthropic', 'https://openrouter.ai/api/v1'), '', 'a stale value from a prior provider is dropped, not persisted');
});

test('visionModel falls back to the text model when unset', () => {
  const config = resolveAiConfig({
    enabled: true, provider: 'openrouter', baseUrl: '', model: 'my-model',
    visionModel: '', apiKeyEncrypted: encryptSecret('sk-x')
  });
  assert.equal(config.visionModel, 'my-model');
});

test('resolveTestConfig is configured from unsaved fields alone, nothing stored', () => {
  const config = resolveTestConfig({
    provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-4-5', visionModel: '',
    apiKey: 'sk-fresh-unsaved'
  }, null);
  assert.equal(config.enabled, true, 'testing does not require the enable toggle');
  assert.equal(config.provider, 'anthropic');
  assert.equal(config.baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(config.apiKey, 'sk-fresh-unsaved');
  assert.equal(isAiConfigured(config), true);
});

test('resolveTestConfig falls back to the stored key when the field is blank', () => {
  const config = resolveTestConfig({
    provider: 'anthropic', baseUrl: '', model: '', visionModel: '', apiKey: ''
  }, {
    enabled: false, provider: 'anthropic', baseUrl: '', model: 'claude-sonnet-4-5',
    visionModel: '', apiKeyEncrypted: encryptSecret('sk-already-stored')
  });
  assert.equal(config.apiKey, 'sk-already-stored');
  assert.equal(config.model, 'claude-sonnet-4-5');
});

test('resolveTestConfig ignores a hosted-preset baseUrl left over from a previous provider', () => {
  const config = resolveTestConfig({
    provider: 'anthropic', baseUrl: 'https://openrouter.ai/api/v1', model: '', visionModel: '',
    apiKey: 'sk-x'
  }, null);
  assert.equal(config.baseUrl, 'https://api.anthropic.com/v1');
});
