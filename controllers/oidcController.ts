import User from '../models/User';
import { issueSession } from './authController';
import {
    getOidcConfig,
    getOidcRedirectUri
} from '../config/oidc';

/**
 * Build the IdP authorization URL (PKCE + state + nonce), store the values
 * needed to validate the callback in the session, and redirect the user.
 * `linkUserId` is only set when linking an existing account from Settings;
 * a plain SSO login omits it.
 */
const startAuthorization = async (req: any, res: any, linkUserId?: string) => {
    const { buildAuthorizationUrl, randomPKCECodeVerifier, calculatePKCECodeChallenge, randomState, randomNonce } =
        await import('openid-client');

    const config = await getOidcConfig();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const state = randomState();
    const nonce = randomNonce();

    req.session.oidc = { codeVerifier, state, nonce, linkUserId };

    const authUrl = buildAuthorizationUrl(config, {
        redirect_uri: getOidcRedirectUri(),
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce
    });

    res.redirect(authUrl.toString());
};

/**
 * GET /login/oidc
 * Start an SSO login attempt (no session required).
 */
export const login_oidc_get = async (req: any, res: any) => {
    try {
        await startAuthorization(req, res);
    } catch (err) {
        console.error('[OIDC] Failed to start login flow:', err);
        res.redirect('/login?error=oidc_unavailable');
    }
};

/**
 * GET /settings/oidc/link
 * Start linking the currently logged-in account to the configured IdP.
 */
export const link_oidc_get = async (req: any, res: any) => {
    try {
        await startAuthorization(req, res, String(req.user._id));
    } catch (err) {
        console.error('[OIDC] Failed to start link flow:', err);
        res.redirect('/settings?oidc=error');
    }
};

/**
 * GET /login/oidc/callback
 * Single redirect URI shared by the login and link flows, since IdPs
 * register one static callback URL per client.
 */
export const oidc_callback_get = async (req: any, res: any) => {
    // Single use: consume the handshake values before any validation so a
    // replayed callback cannot reuse them.
    const stashed = req.session.oidc;
    delete req.session.oidc;

    if (!stashed) {
        return res.redirect('/login?error=oidc_unavailable');
    }

    try {
        const { authorizationCodeGrant } = await import('openid-client');
        const config = await getOidcConfig();

        const currentUrl = new URL(req.originalUrl, getOidcRedirectUri());
        const tokens = await authorizationCodeGrant(config, currentUrl, {
            pkceCodeVerifier: stashed.codeVerifier,
            expectedState: stashed.state,
            expectedNonce: stashed.nonce
        });

        const claims = tokens.claims();
        const sub = claims?.sub;
        if (!sub) {
            throw new Error('OIDC response is missing a subject claim');
        }

        if (stashed.linkUserId) {
            // The user who started the link flow must still be the one
            // authenticated by the jwt cookie (the user may have logged out or
            // switched accounts during the round trip to the IdP).
            if (!req.user || String(req.user._id) !== stashed.linkUserId) {
                return res.redirect('/login');
            }

            const existing = await User.findOne({ 'oidc.sub': sub });
            if (existing && String(existing._id) !== stashed.linkUserId) {
                return res.redirect('/settings?oidc=already_linked');
            }

            await User.findByIdAndUpdate(stashed.linkUserId, {
                oidc: { sub, linkedAt: new Date() }
            });
            return res.redirect('/settings?oidc=linked');
        }

        // Login flow. Accounts are never auto-created from an OIDC identity:
        // the user must have linked it from Settings beforehand.
        const user = await User.findOne({ 'oidc.sub': sub });
        if (!user) {
            return res.redirect('/login?error=oidc_unlinked');
        }

        await issueSession(req, res, user);
        res.redirect('/');
    } catch (err) {
        console.error('[OIDC] Callback failed:', err);
        res.redirect(stashed.linkUserId ? '/settings?oidc=error' : '/login?error=oidc_unavailable');
    }
};
