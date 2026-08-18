// BoardGameGeek XML API2 (https://boardgamegeek.com/wiki/page/BGG_XML_API2). Since July 2025
// BGG requires a registered application token on every request (see
// https://boardgamegeek.com/using_the_xml_api), passed as a Bearer token - unauthenticated
// calls now come back 401.
export const BGG_BASE = 'https://boardgamegeek.com/xmlapi2';

export function bggHeaders(): Record<string, string> {
  const apiKey = process.env.BGG_API_KEY;
  if (!apiKey) throw new Error('BGG_API_KEY missing');
  return {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'DVinylApp/2.0 (+https://github.com/Kyonew/DVinyl)',
    Accept: 'application/xml'
  };
}
