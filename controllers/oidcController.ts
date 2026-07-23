import User from '../models/User';
import { issueSession } from './authController';
import {
    getOidcConfig,
    getOidcRedirectUri,
    getOidcScope,
    getOidcGroupsClaim,
    getOidcAllowedGroup,
    getOidcAdminGroup,
    isOidcSignupEnabled
} from '../config/oidc';

/**
 * Resolve the user's group memberships from the ID token claims, falling back
 * to the UserInfo endpoint when the configured claim is absent from the token
 * (some IdPs only expose groups there). Always returns an array of strings.
 */
const resolveGroups = async (config: any, tokens: any, claims: any): Promise<string[]> => {
    const groupsClaim = getOidcGroupsClaim();
    let groups = claims?.[groupsClaim];

    if (groups === undefined && tokens?.access_token) {
        try {
            const { fetchUserInfo } = await import('openid-client');
            const info = await fetchUserInfo(config, tokens.access_token, claims.sub);
            groups = (info as any)?.[groupsClaim];
        } catch (err) {
            console.warn('[OIDC] Could not fetch UserInfo to resolve groups:', err);
        }
    }

    if (Array.isArray(groups)) return groups.map(String);
    if (typeof groups === 'string') return [groups];
    return [];
};

/**
 * Derive a candidate username from the IdP claims, preferring an explicit
 * preferred_username, then the display name, then the local part of the email.
 * Whitespace is collapsed and the result capped to the User schema limits.
 */
const deriveUsername = (claims: any, email: string): string => {
    const raw = claims?.preferred_username || claims?.name || email.split('@')[0];
    const cleaned = String(raw).trim().replace(/\s+/g, '_').slice(0, 40);
    return cleaned || 'user';
};

/**
 * Create a JIT-provisioned, SSO-only account (no local password). On a username
 * collision a numeric suffix is appended and creation retried; a duplicate email
 * or oidc.sub is a genuine conflict and is allowed to propagate.
 */
const createProvisionedUser = async (
    email: string,
    baseUsername: string,
    sub: string,
    isAdmin: boolean
) => {
    // Backdate lastChange: we issue a JWT immediately after creation, and its
    // `iat` is floored to whole seconds. A same-instant `new Date()` would sit a
    // few hundred ms *after* the token's iat, so authMiddleware's staleness check
    // (iat*1000 < lastChange) would reject the fresh token and bounce to /login.
    const lastChange = new Date(Date.now() - 60_000);

    for (let attempt = 0; attempt < 20; attempt++) {
        const username = attempt === 0 ? baseUsername : `${baseUsername}${attempt + 1}`;
        try {
            return await User.create({
                username,
                email,
                isAdmin,
                oidc: { sub, linkedAt: new Date(), autoProvisioned: true },
                lastChange
            });
        } catch (err: any) {
            if (err?.code === 11000 && err?.keyPattern?.username) {
                continue;
            }
            throw err;
        }
    }
    throw new Error('Could not allocate a unique username for the provisioned account');
};

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
        scope: getOidcScope(),
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

        // Login flow.
        const allowedGroup = getOidcAllowedGroup();
        const user = await User.findOne({ 'oidc.sub': sub });

        if (user) {
            // Re-verify group membership on every login: a user removed from the
            // allowed group in the IdP loses access immediately, even though the
            // account still exists.
            if (allowedGroup) {
                const groups = await resolveGroups(config, tokens, claims);
                if (!groups.includes(allowedGroup)) {
                    console.warn(`[OIDC] Access denied for ${user.email}: not in group "${allowedGroup}"`);
                    return res.redirect('/login?error=oidc_forbidden');
                }
            }
            await issueSession(req, res, user);
            return res.redirect('/');
        }

        // Unknown identity. Without JIT provisioning enabled, the user must have
        // linked the identity from Settings beforehand.
        if (!isOidcSignupEnabled()) {
            return res.redirect('/login?error=oidc_unlinked');
        }

        // Provisioning requires a verified email (used to key the account and to
        // safely link an existing local account).
        // An email is required to key the account (the User schema mandates it).
        // Some IdPs encode email_verified as the string "true" rather than a boolean.
        const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
        const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : undefined;
        if (!email) {
            console.warn('[OIDC] Signup refused: no email claim from the IdP');
            return res.redirect('/login?error=oidc_forbidden');
        }

        const groups = await resolveGroups(config, tokens, claims);
        if (allowedGroup && !groups.includes(allowedGroup)) {
            console.warn(`[OIDC] Signup refused for ${email}: not in group "${allowedGroup}"`);
            return res.redirect('/login?error=oidc_forbidden');
        }

        // Link to an existing local account with the same email rather than
        // creating a duplicate. This is only safe when the IdP has verified the
        // email: linking a merely-claimed address to an existing account would
        // allow account takeover. Group membership was already checked above.
        const existingByEmail = await User.findOne({ email });
        if (existingByEmail) {
            if (!emailVerified) {
                console.warn(`[OIDC] Refusing to link SSO identity to existing account <${email}>: email not verified by the IdP`);
                return res.redirect('/login?error=oidc_forbidden');
            }
            (existingByEmail as any).oidc = { sub, linkedAt: new Date(), autoProvisioned: false };
            await existingByEmail.save();
            await issueSession(req, res, existingByEmail);
            return res.redirect('/');
        }

        const adminGroup = getOidcAdminGroup();
        const isAdmin = !!(adminGroup && groups.includes(adminGroup));
        const newUser = await createProvisionedUser(email, deriveUsername(claims, email), sub, isAdmin);
        console.log(`[OIDC] Provisioned account ${newUser.username} <${email}>${isAdmin ? ' (admin)' : ''} from SSO`);

        await issueSession(req, res, newUser);
        return res.redirect('/');
    } catch (err) {
        console.error('[OIDC] Callback failed:', err);
        res.redirect(stashed.linkUserId ? '/settings?oidc=error' : '/login?error=oidc_unavailable');
    }
};
