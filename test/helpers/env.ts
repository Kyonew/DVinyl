// Loaded via `--import ./test/helpers/env.ts` (after `--import tsx`), so these
// values exist before any route module reads process.env at import time.
process.env.NODE_ENV = 'test';
process.env.PROD = 'false';
process.env.PASSJWT = process.env.PASSJWT || 'test-passjwt-secret-0123456789abcdef';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-0123456789abcdef';
process.env.MONGODB_URL = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/dvinyl_test_placeholder';
process.env.BASE_URL = process.env.BASE_URL ?? '';

// OIDC is off unless a test explicitly turns it on, and then restores it.
delete process.env.OIDC_ISSUER_URL;
delete process.env.OIDC_CLIENT_ID;
delete process.env.OIDC_CLIENT_SECRET;
delete process.env.OIDC_REDIRECT_URI;
delete process.env.OIDC_DISABLE_LOCAL_LOGIN;

export {};
