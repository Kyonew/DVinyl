import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_PROVIDERS, getProviderPreset, DEFAULT_PROVIDER_ID } from './providers';

test('every preset has a usable id, label and default model', () => {
  assert.ok(AI_PROVIDERS.length >= 5);
  for (const preset of AI_PROVIDERS) {
    assert.ok(preset.id.length > 0, 'id');
    assert.ok(preset.label.length > 0, `label for ${preset.id}`);
    if (preset.id !== 'custom') {
      assert.ok(preset.defaultModel.length > 0, `defaultModel for ${preset.id}`);
    }
  }
});

test('hosted presets carry an https base URL, custom carries none', () => {
  for (const preset of AI_PROVIDERS) {
    if (preset.id === 'custom') {
      assert.equal(preset.baseUrl, '');
    } else {
      assert.ok(preset.baseUrl.startsWith('https://'), `baseUrl for ${preset.id}`);
      assert.ok(!preset.baseUrl.endsWith('/'), `no trailing slash for ${preset.id}`);
    }
  }
});

test('the four named providers are present', () => {
  for (const id of ['openrouter', 'openai', 'anthropic', 'gemini']) {
    assert.ok(getProviderPreset(id), `missing ${id}`);
  }
});

test('getProviderPreset returns undefined for an unknown id', () => {
  assert.equal(getProviderPreset('nope'), undefined);
});

test('the default provider id resolves to a preset', () => {
  assert.ok(getProviderPreset(DEFAULT_PROVIDER_ID));
});
