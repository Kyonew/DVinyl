import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-session-secret';

let encryptSecret: (plain: string) => string;
let decryptSecret: (stored: string) => string;
let keyHint: (plain: string) => string;

before(async () => {
  ({ encryptSecret, decryptSecret, keyHint } = await import('./secret'));
});

test('round-trips a secret', () => {
  const plain = 'sk-or-v1-abcdef0123456789';
  const stored = encryptSecret(plain);
  assert.notEqual(stored, plain, 'must not store plaintext');
  assert.ok(stored.startsWith('v1:'));
  assert.equal(decryptSecret(stored), plain);
});

test('produces a different ciphertext each time (random iv)', () => {
  assert.notEqual(encryptSecret('same'), encryptSecret('same'));
});

test('returns empty string for tampered, malformed or empty input', () => {
  const stored = encryptSecret('secret-value');
  const parts = stored.split(':');
  const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('garbage').toString('base64')}`;
  assert.equal(decryptSecret(tampered), '');
  assert.equal(decryptSecret('not-a-payload'), '');
  assert.equal(decryptSecret(''), '');
});

test('encrypting an empty secret yields an empty stored value', () => {
  assert.equal(encryptSecret(''), '');
});

test('keyHint masks the middle and never reveals the whole key', () => {
  const hint = keyHint('sk-or-v1-abcdef0123456789');
  assert.ok(hint.includes('…'));
  assert.ok(!hint.includes('abcdef0123'));
  assert.ok(hint.endsWith('6789'));
});

test('keyHint of a short or empty key does not throw', () => {
  assert.equal(keyHint(''), '');
  assert.ok(typeof keyHint('abc') === 'string');
});
