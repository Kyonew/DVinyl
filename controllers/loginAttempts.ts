// In-memory, per-process login attempt tracking shared by the web login
// (controllers/authController.ts) and the mobile API login
// (controllers/apiAuthController.ts), so switching between the two endpoints
// can't be used to double an attacker's attempt budget.
interface LoginAttempt {
  count: number;
  lastTry: number;
  blockedUntil?: number;
}

const loginAttempts: Record<string, LoginAttempt> = {};

export const MAX_ATTEMPTS = 4;
export const BLOCK_TIME = 5 * 60 * 1000; // 5 minutes

/** Seconds left on an active block for `key`, or null if it isn't currently blocked. */
export function secondsBlocked(key: string): number | null {
  const attempt = loginAttempts[key];
  if (!attempt?.blockedUntil) return null;
  const now = Date.now();
  if (now >= attempt.blockedUntil) return null;
  return Math.ceil((attempt.blockedUntil - now) / 1000);
}

/** Records a failed attempt for `key`. `justBlocked` is true the moment it crosses MAX_ATTEMPTS. */
export function recordFailure(key: string): { count: number; justBlocked: boolean } {
  const now = Date.now();
  if (!loginAttempts[key]) loginAttempts[key] = { count: 0, lastTry: now };
  loginAttempts[key].count++;
  loginAttempts[key].lastTry = now;

  if (loginAttempts[key].count >= MAX_ATTEMPTS) {
    loginAttempts[key].blockedUntil = now + BLOCK_TIME;
    return { count: loginAttempts[key].count, justBlocked: true };
  }
  return { count: loginAttempts[key].count, justBlocked: false };
}

export function clearAttempts(key: string): void {
  delete loginAttempts[key];
}
