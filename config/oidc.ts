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
            const { discovery } = await import('openid-client');
            return discovery(
                new URL(process.env.OIDC_ISSUER_URL as string),
                process.env.OIDC_CLIENT_ID as string,
                process.env.OIDC_CLIENT_SECRET as string
            );
        })().catch((err) => {
            configPromise = null;
            throw err;
        });
    }

    return configPromise;
};
