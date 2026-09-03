import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const VERSION = 'v1';

/** Derives a 32-byte key from SESSION_SECRET so no separate secret needs configuring. */
function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET || '';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext secret (e.g. an AI provider API key) for storage.
 * Format: v1:<iv base64>:<authTag base64>:<ciphertext base64>. Empty input yields ''.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Decrypts a value produced by encryptSecret. Returns '' for empty, malformed, or
 * tampered input rather than throwing, so callers can treat any '' as "no secret".
 */
export function decryptSecret(stored: string): string {
  if (!stored) return '';

  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return '';
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

  try {
    const iv = Buffer.from(ivPart, 'base64');
    const authTag = Buffer.from(tagPart, 'base64');
    const ciphertext = Buffer.from(dataPart, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return '';
  }
}

/** Masks a secret for display, keeping only the last 4 characters visible. */
export function keyHint(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 4) return `…${plain}`;
  return `…${plain.slice(-4)}`;
}
