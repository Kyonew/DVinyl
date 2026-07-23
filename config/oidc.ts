// Instance-wide OIDC configuration (a single identity provider, read from
// environment variables). When the OIDC_* variables are unset the feature is
// fully disabled: no routes are mounted and no button is rendered.

let configPromise: Promise<any> | null = null;

export const isOidcEnabled = (): boolean => {
    return !!(
        process.env.OIDC_ISSUER_URL &&
        process.env.OIDC_CLIENT_ID &&
        process.env.OIDC_CLIENT_SECRET &&
        process.env.OIDC_REDIRECT_URI
    );
};

export const getOidcRedirectUri = (): string => {
    return process.env.OIDC_REDIRECT_URI as string;
};

export const getOidcButtonLabel = (): string | undefined => {
    return process.env.OIDC_BUTTON_LABEL;
};

/**
 * When enabled, an SSO login for an unknown identity provisions a new account
 * automatically (JIT provisioning) instead of being rejected. Opt-in: without
 * OIDC_ALLOW_SIGNUP the historical link-only behaviour is preserved.
 */
export const isOidcSignupEnabled = (): boolean => {
    return isOidcEnabled() && process.env.OIDC_ALLOW_SIGNUP === 'true';
};

/**
 * Name of the token/userinfo claim holding the user's group memberships.
 * Providers differ (Authentik/Keycloak/Authelia); defaults to `groups`.
 */
export const getOidcGroupsClaim = (): string => {
    return process.env.OIDC_GROUPS_CLAIM || 'groups';
};

/**
 * Group a user must belong to in order to sign in. Empty means any user the
 * IdP authenticates is allowed. Enforced both at provisioning time and on
 * every subsequent SSO login.
 */
export const getOidcAllowedGroup = (): string | undefined => {
    const group = process.env.OIDC_ALLOWED_GROUP?.trim();
    return group ? group : undefined;
};

/**
 * Group whose members are granted instance admin (isAdmin) rights. Empty means
 * no automatic admin mapping.
 */
export const getOidcAdminGroup = (): string | undefined => {
    const group = process.env.OIDC_ADMIN_GROUP?.trim();
    return group ? group : undefined;
};

/**
 * OAuth scopes requested at the authorization endpoint. The groups scope is
 * appended when group-based access is in play so the IdP returns the claim.
 */
export const getOidcScope = (): string => {
    const scopes = ['openid', 'email', 'profile'];
    if (isOidcSignupEnabled() || getOidcAllowedGroup()) {
        scopes.push('groups');
    }
    return scopes.join(' ');
};

/**
 * Discover and cache the openid-client Configuration for the configured
 * issuer. Discovery only runs on the first call; on failure the cache is
 * cleared so the next request retries.
 * Note: openid-client is ESM-only while this project compiles to CommonJS,
 * hence the dynamic import.
 */
export const getOidcConfig = async (): Promise<any> => {
    if (!isOidcEnabled()) {
        throw new Error('OIDC is not configured');
    }

    if (!configPromise) {
        configPromise = (async () => {
            const { discovery, allowInsecureRequests } = await import('openid-client');
            // openid-client refuses plain-HTTP endpoints by default. Only when
            // OIDC_ALLOW_INSECURE=true (local/dev against an http:// issuer) do we
            // opt out; passing allowInsecureRequests to discovery also lifts the
            // restriction for every subsequent request made with this config.
            const options = process.env.OIDC_ALLOW_INSECURE === 'true'
                ? { execute: [allowInsecureRequests] }
                : undefined;
            return discovery(
                new URL(process.env.OIDC_ISSUER_URL as string),
                process.env.OIDC_CLIENT_ID as string,
                process.env.OIDC_CLIENT_SECRET as string,
                undefined,
                options
            );
        })().catch((err) => {
            configPromise = null;
            throw err;
        });
    }

    return configPromise;
};
