import User from '../models/User';
import jwt from 'jsonwebtoken';
import LoginLog from '../models/LoginLog';
import { isLocalLoginDisabled } from '../config/oidc';

/**
 * Retrieve the client IP address from request headers or socket details.
 */
const getClientIp = (req: any): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
};

/**
 * Retrieve geolocation information (country and city) for a given IP.
 * Uses freeipapi.com with a short timeout and checks for private/local IPs.
 */
const getGeoLocation = async (ip: string) => {
  const isPrivate = 
    ip === '127.0.0.1' || 
    ip === '::1' || 
    ip === '::ffff:127.0.0.1' ||
    /^10\./.test(ip) || 
    /^192\.168\./.test(ip) || 
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) ||
    /^fe80:/i.test(ip);

  if (isPrivate) {
    return null;
  }

  try {
    const response = await fetch(`https://freeipapi.com/api/json/${ip}`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      country: data.countryCode || 'XX',
      city: data.cityName || null
    };
  } catch (err) {
    console.error('[GeoIP] Error fetching location:', err);
    return null;
  }
};



// In-memory login attempt tracking to throttle brute-force attempts.
interface LoginAttempt {
  count: number;
  lastTry: number;
  blockedUntil?: number;
}

const loginAttempts: Record<string, LoginAttempt> = {};
const MAX_ATTEMPTS = 4;
const BLOCK_TIME = 5 * 60 * 1000; // 5 minutes (can be adjusted as needed)

/**
 * Translate known errors into i18n keys returned to the client.
 * This function handles both manual logic errors and Mongoose validation errors.
 * @param {Error} err - Error thrown by model operations
 * @returns {{login: string}} Object containing the i18n key for the error
 */
export const handleErrors = (err: any) => {
  let errors = { login: '' };

  // Manual check for login logic (custom errors thrown by User.login static method)
  if (err.message === 'incorrect email' || err.message === 'incorrect password') {
    errors.login = 'errors.invalid_credentials';
  }

  // If the error is a validation error, we extract the key defined in the User Schema.
  if (err.message.includes('user validation failed')) {
    Object.values(err.errors).forEach(({ properties }: any) => {
      // The properties.message contains the i18n key (e.g., "auth.email_required")
      errors.login = properties.message;
    });
  }

  return errors;
};

/**
 * GET /login
 * Render the login page, or hand the visitor straight to the identity provider
 * when the instance has no local sign-in. An OIDC error is still shown here, so
 * a failed SSO round-trip reports what happened instead of bouncing forever.
 */
export const login_get = (req: any, res: any) => {
  if (isLocalLoginDisabled() && !req.query.error) {
    return res.redirect(`${res.locals.baseUrl || ''}/login/oidc`);
  }
  res.render('login', { oidcError: req.query.error || null });
};

/**
 * Issue the JWT session cookie for an already-authenticated user and record
 * a LoginLog entry. Used by both password login and OIDC login.
 */
export const issueSession = async (req: any, res: any, user: any) => {
  const clientIp = getClientIp(req);
  const geo = await getGeoLocation(clientIp);

  await LoginLog.create({
    user: user._id,
    username: user.username,
    email: user.email,
    ip: clientIp,
    country: geo?.country || 'XX',
    city: geo?.city || req.t('common.unknown'),
    userAgent: req.headers['user-agent'],
    status: 'success'
  });

  console.log(`[AUTH] Session issued for ${user.email} (${clientIp}${geo?.country ? ', ' + geo.country : ''})`);

  const passjwt = process.env.PASSJWT;
  if (!passjwt) {
    throw new Error("PASSJWT environment variable is missing");
  }

  const token = jwt.sign({ id: user._id }, passjwt, { expiresIn: '3d' });

  res.cookie('jwt', token, {
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000,
    secure: process.env.PROD === 'true', // Only send cookie over HTTPS in production
    sameSite: 'lax' // Mitigate CSRF
  });
};

/**
 * POST /login
 * Process login form submissions. Implements simple in-memory rate limiting
 * and logs each attempt (success or failure) with geolocation information.
 */
export const login_post = async (req: any, res: any) => {
  // Refused server-side too: hiding the form is presentation, this is the rule.
  if (isLocalLoginDisabled()) {
    return res.status(403).json({ errors: { login: req.t('login.local_disabled') } });
  }

  const { email, password } = req.body;
  const now = Date.now();

  // Check whether this email is temporarily blocked due to repeated failures.
  if (loginAttempts[email] && loginAttempts[email].blockedUntil && now < loginAttempts[email].blockedUntil) {
    const secondsLeft = Math.ceil((loginAttempts[email].blockedUntil - now) / 1000);
    return res.status(429).json({
      errors: { login: req.t('errors.too_many_attempts_timed', { seconds: secondsLeft }) }
    });
  }

  try {
    const user = await (User as any).login(email, password);

    // Clear failed attempts on successful login.
    if (loginAttempts[email]) delete loginAttempts[email];

    await issueSession(req, res, user);
    res.status(200).json({ user: user._id });

  } catch (err) {
    // Increment failure counter for this email address.
    if (!loginAttempts[email]) loginAttempts[email] = { count: 0, lastTry: now };
    loginAttempts[email].count++;
    loginAttempts[email].lastTry = now;

    // If threshold reached, set a temporary block window.
    if (loginAttempts[email].count >= MAX_ATTEMPTS) {
      loginAttempts[email].blockedUntil = now + BLOCK_TIME;
      console.warn(`[AUTH] ${email} temporarily blocked after ${loginAttempts[email].count} failed attempts (from ${getClientIp(req)})`);
      return res.status(429).json({
        errors: { login: req.t('errors.too_many_attempts_blocked') }
      });
    }

    console.warn(`[AUTH] Login failed for ${email}: ${(err as any)?.message} (attempt ${loginAttempts[email].count}/${MAX_ATTEMPTS})`);

    // Retrieve the error key from handleErrors.
    const errorKeys = handleErrors(err);

    // Translate the key returned by the model using the current request language.
    res.status(400).json({
      errors: { login: req.t(errorKeys.login) }
    });
  }
};

/**
 * GET /logout
 */
export const logout_get = (req: any, res: any) => {
  console.log(`[AUTH] Logout${req.user?.email ? ': ' + req.user.email : ''}`);
  res.cookie('jwt', '', { maxAge: 1 });
  res.redirect('/');
};
