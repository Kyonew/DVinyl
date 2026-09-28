import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import RefreshToken from '../../models/RefreshToken';

export function signAccessToken(userId: any): string {
  const secret = process.env.PASSJWT;
  if (!secret) throw new Error('PASSJWT missing in test env');
  return jwt.sign({ id: String(userId) }, secret, { expiresIn: '15m' });
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Creates a real RefreshToken row and returns the plaintext token. */
export async function seedRefreshToken(user: any, label = 'test-device'): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await RefreshToken.create({
    user: user._id,
    tokenHash,
    deviceLabel: label,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  return token;
}
