import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User';
import RefreshToken from '../models/RefreshToken';
import { isLocalLoginDisabled } from '../config/oidc';
import { secondsBlocked, recordFailure, clearAttempts, MAX_ATTEMPTS } from './loginAttempts';
import { listUserCollectionsWithRole } from '../utils/collectionHelpers';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function signAccessToken(userId: any): string {
  const passjwt = process.env.PASSJWT;
  if (!passjwt) throw new Error("PASSJWT environment variable is missing");
  return jwt.sign({ id: userId }, passjwt, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId: any, req: any): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(token),
    deviceLabel: String(req.headers['user-agent'] || 'Unknown device').slice(0, 200),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  });
  return token;
}

export { hashToken, signAccessToken, ACCESS_TOKEN_TTL_SECONDS };

/**
 * POST /api/v1/auth/login  { email, password }
 * Same brute-force gate as the web login (controllers/loginAttempts.ts), keyed by
 * email so a client can't dodge the block by switching between /login and this route.
 */
export const login = async (req: any, res: any) => {
  if (isLocalLoginDisabled()) {
    return res.status(403).json({ success: false, error: 'Local login is disabled on this instance' });
  }

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }

  const blockedSeconds = secondsBlocked(email);
  if (blockedSeconds !== null) {
    return res.status(429).json({
      success: false,
      error: `Too many attempts. Try again in ${blockedSeconds}s.`
    });
  }

  try {
    const user = await (User as any).login(email, password);
    clearAttempts(email);

    const accessToken = signAccessToken(user._id);
    const refreshToken = await issueRefreshToken(user._id, req);

    res.status(200).json({ accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  } catch (err) {
    const { count, justBlocked } = recordFailure(email);
    if (justBlocked) {
      console.warn(`[API AUTH] ${email} temporarily blocked after ${count} failed attempts`);
      return res.status(429).json({ success: false, error: 'Too many failed attempts. Try again later.' });
    }
    console.warn(`[API AUTH] Login failed for ${email} (attempt ${count}/${MAX_ATTEMPTS})`);
    res.status(400).json({ success: false, error: 'Invalid email or password' });
  }
};

/** GET /api/v1/auth/me — requires requireApiAuth. */
export const me = async (req: any, res: any) => {
  try {
    const collections = await listUserCollectionsWithRole(req.user);
    res.status(200).json({
      user: {
        id: String(req.user._id),
        username: req.user.username,
        email: req.user.email,
        isAdmin: req.user.isAdmin,
        img: req.user.img,
        theme: req.user.theme,
        language: req.user.language,
        currency: req.user.currency,
        hasLocalPassword: !!req.user.password,
        oidcLinked: !!req.user.oidc?.sub
      },
      collections
    });
  } catch (err: any) {
    console.error('API me error:', err);
    res.status(500).json({ success: false, error: 'Failed to load account' });
  }
};

/**
 * POST /api/v1/auth/refresh  { refreshToken }
 * Rotation-on-use: the presented token is deleted and a fresh pair issued, so a
 * leaked refresh token stops working the next time its rightful owner refreshes.
 */
export const refresh = async (req: any, res: any) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'refreshToken is required' });
  }

  const row = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) });
  if (!row || row.expiresAt.getTime() < Date.now()) {
    return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }

  await RefreshToken.deleteOne({ _id: row._id });

  const accessToken = signAccessToken(row.user);
  const newRefreshToken = await issueRefreshToken(row.user, req);

  res.status(200).json({ accessToken, refreshToken: newRefreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
};

/**
 * POST /api/v1/auth/logout  { refreshToken }
 * Revokes only the calling device: deletes that one RefreshToken row. Web sessions
 * and other mobile logins are untouched.
 */
export const logout = async (req: any, res: any) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: 'refreshToken is required' });
  }
  await RefreshToken.deleteOne({ tokenHash: hashToken(refreshToken) });
  res.status(200).json({ success: true });
};
