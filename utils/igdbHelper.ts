let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

export async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt) {
        return cachedToken;
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET missing from .env');
    }

    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
    });

    const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, {
        method: 'POST'
    });

    if (!response.ok) {
        throw new Error(`Twitch OAuth failed: ${response.statusText}`);
    }

    const data = await response.json() as any;

    cachedToken = data.access_token;
    // Refresh 5 minutes before actual expiry
    tokenExpiresAt = now + (data.expires_in * 1000) - 300000;

    console.log('🎮 IGDB/Twitch token obtained, expires in', Math.round(data.expires_in / 3600), 'hours');
    return cachedToken;
}

/**
 * Make a request to the IGDB API.
 * @param {string} endpoint - IGDB endpoint (e.g. 'games', 'platforms', 'covers')
 * @param {string} body - APICalypse query body
 * @returns {Promise<Array>} The response data
 */
export async function igdbRequest(endpoint: string, body: string) {
    const token = await getAccessToken();
    const clientId = process.env.TWITCH_CLIENT_ID;

    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: {
            'Client-ID': clientId || '',
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'text/plain'
        },
        body: body
    });

    if (!response.ok) {
        throw new Error(`IGDB request failed: ${response.statusText}`);
    }

    return await response.json();
}
