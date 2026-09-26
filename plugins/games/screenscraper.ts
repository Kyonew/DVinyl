import fs from 'fs';
import path from 'path';
import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { BASE_URL } from '../../config/constants';
import { isJpegBuffer, storeItemImage, MAX_ITEM_IMAGE_UPLOAD_BYTES } from '../../core/itemImageStorage';

// Read from package.json so ScreenScraper can tell one release from the next, which is
// what it blacklists a misbehaving scraper by.
const pkg = require('../../package.json');

/**
 * ScreenScraper (screenscraper.fr), the database retro collectors scrape their libraries
 * from: it knows the MS-DOS, arcade and 8-bit catalogues far better than IGDB does.
 *
 * Its API takes two pairs of credentials. The developer pair identifies the software and
 * is issued by ScreenScraper to whoever publishes it, never to its users. The member pair
 * is the user's own free account: optional, but the quotas are per member, so an instance
 * without one shares the smallest allowance there is.
 *
 * Everything that comes back carries those credentials: the address of every picture
 * embeds the developer password. None of them may reach a browser, so images are only
 * ever fetched here, either copied into the instance's own uploads (the cover of an item
 * being added) or relayed through a route of the plugin (the thumbnails of a search).
 */

const API_BASE = 'https://api.screenscraper.fr/api2';
const SOFT_NAME = `DVinyl-${pkg.version}`;
// jeuRecherche routinely takes 10 to 20 seconds to answer, so anything shorter cuts off
// searches that were about to succeed.
const REQUEST_TIMEOUT_MS = 45000;
const MEDIA_TIMEOUT_MS = 20000;
// jeuRecherche answers up to 30 games ranked by likelihood. Each shown result costs a
// thumbnail request against the member's quota, and past the first dozen the ranking has
// long stopped being about what was typed.
const MAX_RESULTS = 12;
// Wide enough for a sharp cover on a detail page, small enough to stay far below the
// upload cap once re-encoded as JPEG.
const COVER_MAX_WIDTH = 1000;
const THUMBNAIL_MAX_WIDTH = 300;

// The media a cover is taken from, best first: the front of the box, then a render of it,
// then the title screen or a screenshot for the many games that never had a box scanned.
const COVER_MEDIA_TYPES = ['box-2D', 'box-3D', 'sstitle', 'ss'];

// Which region's title, release date and box to prefer for a given interface language.
// ScreenScraper's own region codes: `sp` is Spain, `wor` the worldwide release, `ss` the
// database's internal name.
const REGION_PRIORITIES: Record<string, string[]> = {
  fr: ['fr', 'eu', 'wor', 'us', 'ss', 'uk', 'jp'],
  de: ['de', 'eu', 'wor', 'us', 'ss', 'uk', 'jp'],
  es: ['sp', 'eu', 'wor', 'us', 'ss', 'uk', 'jp'],
  it: ['it', 'eu', 'wor', 'us', 'ss', 'uk', 'jp'],
  en: ['us', 'wor', 'eu', 'uk', 'ss', 'jp']
};

export function regionPriorities(language?: string): string[] {
  return REGION_PRIORITIES[(language || '').slice(0, 2)] || REGION_PRIORITIES.en!;
}

export function languagePriorities(language?: string): string[] {
  const own = (language || '').slice(0, 2);
  return [...new Set([own, 'en', 'fr'].filter(Boolean))];
}

// The official image carries DVinyl's own developer pair, written at build time from the
// repository's CI secrets. It only fills in what the environment leaves unset, so an
// instance with a pair of its own keeps using it, and a build without the secrets (a fork,
// a local `docker build`, a run from source) simply has no file here.
const BUNDLED_DEV_CREDENTIALS = path.join(__dirname, 'screenscraper.dev.json');

function loadBundledDevCredentials(): void {
  if (process.env.SCREENSCRAPER_DEV_ID && process.env.SCREENSCRAPER_DEV_PASSWORD) return;
  try {
    const { id, password } = JSON.parse(fs.readFileSync(BUNDLED_DEV_CREDENTIALS, 'utf8'));
    if (typeof id === 'string' && id && typeof password === 'string' && password) {
      process.env.SCREENSCRAPER_DEV_ID = id;
      process.env.SCREENSCRAPER_DEV_PASSWORD = password;
    }
  } catch {
    // No bundled pair: the source stays off unless the environment provides one.
  }
}

// Before the registry first asks whether the source's keys are set.
loadBundledDevCredentials();

/** True when the developer pair this source cannot run without is set. */
export function isScreenScraperConfigured(): boolean {
  return !!(process.env.SCREENSCRAPER_DEV_ID && process.env.SCREENSCRAPER_DEV_PASSWORD);
}

function credentials(): URLSearchParams {
  const params = new URLSearchParams({
    devid: process.env.SCREENSCRAPER_DEV_ID || '',
    devpassword: process.env.SCREENSCRAPER_DEV_PASSWORD || '',
    softname: SOFT_NAME
  });
  if (process.env.SCREENSCRAPER_USER && process.env.SCREENSCRAPER_PASSWORD) {
    params.set('ssid', process.env.SCREENSCRAPER_USER);
    params.set('sspassword', process.env.SCREENSCRAPER_PASSWORD);
  }
  return params;
}

// ---------------------------------------------------------------------------------------
// Quota and threads. ScreenScraper requires the software to keep within them itself: a
// member has so many requests a day and so many at once, and says how many in the
// `ssuser` block of every answer.

const quota = { day: '', used: 0, max: 0, exhausted: false, threads: 1 };
let active = 0;
const waiting: (() => void)[] = [];

// ScreenScraper's day is the French one.
function quotaDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function noteUser(ssuser: any): void {
  if (!ssuser || typeof ssuser !== 'object') return;
  const used = parseInt(ssuser.requeststoday, 10);
  const max = parseInt(ssuser.maxrequestsperday, 10);
  const threads = parseInt(ssuser.maxthreads, 10);
  quota.day = quotaDay();
  if (Number.isFinite(used)) quota.used = used;
  if (Number.isFinite(max)) quota.max = max;
  if (Number.isFinite(threads) && threads > 0) quota.threads = threads;
}

function quotaSpent(): boolean {
  if (quota.day !== quotaDay()) {
    quota.exhausted = false;
    return false;
  }
  return quota.exhausted || (quota.max > 0 && quota.used >= quota.max);
}

async function withThread<T>(run: () => Promise<T>): Promise<T> {
  while (active >= quota.threads) {
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

// What each refusal means, from ScreenScraper's own table of HTTP errors. The body of the
// answer is never echoed: it is written for their forum, and nothing about the request
// (whose address holds the credentials) may end up in a log.
const STATUS_MESSAGES: Record<number, string> = {
  400: 'ScreenScraper rejected the request as malformed',
  401: 'ScreenScraper is closed to non-members right now (server overloaded)',
  403: 'ScreenScraper refused the credentials',
  423: 'ScreenScraper API is closed',
  426: 'ScreenScraper no longer accepts this DVinyl version',
  429: 'ScreenScraper thread limit reached, slow down',
  430: 'ScreenScraper daily quota exceeded'
};

function statusError(status: number): Error {
  const error: any = new Error(STATUS_MESSAGES[status] || `ScreenScraper answered HTTP ${status}`);
  // Carried like fetchJson does, so the CSV import backs off on 429 as it does elsewhere.
  error.status = status;
  return error;
}

// In practice the API often refuses with a 200 and a line of plain text rather than with
// the status its documentation lists (bad credentials come back that way). Those lines are
// fixed strings of ScreenScraper's protocol, in French whatever the caller's language, so
// they are recognised by a word each and turned into the status they stand for.
const TEXT_REFUSALS: [RegExp, number][] = [
  [/identifiants|login/i, 403],
  [/quota/i, 430],
  [/thread/i, 429],
  [/blacklist/i, 426],
  [/ferm/i, 423]
];

function textRefusal(body: string): Error {
  const known = TEXT_REFUSALS.find(([pattern]) => pattern.test(body));
  if (known?.[1] === 430) {
    quota.day = quotaDay();
    quota.exhausted = true;
  }
  return known ? statusError(known[1]) : new Error('ScreenScraper sent an unreadable answer');
}

async function call(endpoint: string, params: Record<string, string>, timeoutMs: number): Promise<Response> {
  if (!isScreenScraperConfigured()) throw new Error('ScreenScraper is not configured');
  if (quotaSpent()) throw statusError(430);

  const query = credentials();
  for (const [key, value] of Object.entries(params)) query.set(key, value);

  return withThread(async () => {
    const response = await fetch(`${API_BASE}/${endpoint}?${query.toString()}`, {
      headers: { 'User-Agent': SOFT_NAME },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (response.status === 430) {
      quota.day = quotaDay();
      quota.exhausted = true;
    }
    return response;
  });
}

async function requestJson(endpoint: string, params: Record<string, string>): Promise<any> {
  const response = await call(endpoint, { ...params, output: 'json' }, REQUEST_TIMEOUT_MS);
  // Nothing matched: a normal answer to a lookup, not a failure.
  if (response.status === 404) return null;
  if (!response.ok) throw statusError(response.status);

  const body = await response.text();
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    throw textRefusal(body);
  }
  noteUser(data?.response?.ssuser);
  return data?.response || null;
}

/**
 * One image of a game, as bytes, or null when ScreenScraper has none. `media` is the
 * name jeuInfos lists it under, region included (`box-2D(eu)`).
 */
export async function fetchScreenScraperMedia(
  systemId: string,
  gameId: string,
  media: string,
  maxWidth: number
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const response = await call('mediaJeu.php', {
    systemeid: systemId,
    jeuid: gameId,
    media,
    maxwidth: String(maxWidth),
    outputformat: 'jpg'
  }, MEDIA_TIMEOUT_MS);
  if (response.status === 404) return null;
  if (!response.ok) throw statusError(response.status);

  // A missing picture comes back as the text NOMEDIA with a 200, not as an error; any
  // other text is a refusal worded the same way the JSON endpoints word theirs.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    const body = (await response.text()).trim();
    if (body === '' || /^NOMEDIA/i.test(body)) return null;
    throw textRefusal(body);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_ITEM_IMAGE_UPLOAD_BYTES) return null;
  return { buffer, contentType };
}

// ---------------------------------------------------------------------------------------
// Reading a game. Names, dates and media come as lists tagged by region, the synopsis and
// genre names as lists tagged by language: each is read in the reader's own order.

type Tagged = { region?: string; langue?: string; text?: string };

export function pickTagged(list: unknown, key: 'region' | 'langue', order: string[]): string {
  if (!Array.isArray(list)) return '';
  const entries = list.filter((e: any) => e && typeof e.text === 'string' && e.text.trim()) as Tagged[];
  for (const wanted of order) {
    const hit = entries.find(e => e[key] === wanted);
    if (hit) return hit.text!.trim();
  }
  return entries[0]?.text?.trim() || '';
}

/** The media name to ask mediaJeu.php for, for the best cover the game has. */
export function coverMediaName(medias: unknown, regions: string[]): string | null {
  if (!Array.isArray(medias)) return null;
  for (const type of COVER_MEDIA_TYPES) {
    const ofType = medias.filter((m: any) => m && m.type === type);
    if (ofType.length === 0) continue;
    const media: any = regions.map(r => ofType.find((m: any) => m.region === r)).find(Boolean) || ofType[0];
    return media.region ? `${media.type}(${media.region})` : media.type;
  }
  return null;
}

const text = (value: any): string =>
  value && typeof value === 'object' ? String(value.text ?? '').trim() : String(value ?? '').trim();

/**
 * A ScreenScraper game in the shape the add and confirm pages read. Never copies any of
 * the game's media addresses: those carry the credentials.
 */
export function formatScreenScraperGame(game: any, language?: string): ConfirmData | null {
  if (!game || !game.id) return null;
  const regions = regionPriorities(language);
  const languages = languagePriorities(language);

  const developer = text(game.developpeur);
  const publisher = text(game.editeur);
  const platform = text(game.systeme);
  const date = pickTagged(game.dates, 'region', regions);
  const genres = [...new Set(
    (Array.isArray(game.genres) ? game.genres : [])
      .map((g: any) => pickTagged(g?.noms, 'langue', languages))
      .filter(Boolean)
  )] as string[];

  return {
    id: String(game.id),
    title: pickTagged(game.noms, 'region', regions) || text(game.nom) || 'Untitled',
    creator: developer || publisher || 'Unknown',
    developer,
    publisher,
    year: (date.match(/^\d{4}/) || [''])[0],
    // A ScreenScraper game belongs to one system, so the platform is known outright.
    platform,
    platforms: platform ? [{ name: platform }] : [],
    platforms_text: platform,
    description: pickTagged(game.synopsis, 'langue', languages),
    genres
  };
}

/** Address of the plugin route that relays a thumbnail, so the browser never sees ScreenScraper's. */
function thumbnailUrl(game: any, regions: string[]): string {
  const media = coverMediaName(game.medias, regions);
  const systemId = text(game.systeme?.id ?? game.systemeid);
  if (!media || !/^\d+$/.test(systemId)) return '';
  const params = new URLSearchParams({ system: systemId, game: String(game.id), media });
  return `${BASE_URL}/api/games/screenscraper/media?${params.toString()}`;
}

export class ScreenScraperProvider implements SearchProvider {
  name = 'ScreenScraper';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const response = await requestJson('jeuRecherche.php', { recherche: query });
    // An empty search answers with a single empty game rather than an empty list.
    const games = (Array.isArray(response?.jeux) ? response.jeux : []).filter((g: any) => g && g.id);
    const regions = regionPriorities(options.language);

    return games.slice(0, MAX_RESULTS).map((game: any) => {
      const formatted = formatScreenScraperGame(game, options.language)!;
      return { ...formatted, cover_image: thumbnailUrl(game, regions) } as SearchResult;
    });
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    if (!/^\d+$/.test(String(id))) throw new Error(`Invalid ScreenScraper id: ${id}`);

    const response = await requestJson('jeuInfos.php', { gameid: String(id) });
    const game = response?.jeu;
    const formatted = formatScreenScraperGame(game, options?.language);
    if (!formatted) throw new Error('Game not found on ScreenScraper');

    // Copied into the instance's own uploads rather than linked to: ScreenScraper's
    // address would expose the credentials, and every later page view would count
    // against the member's quota. An upload the user ends up not saving is swept with
    // the other abandoned ones.
    formatted.cover_image = '';
    const media = coverMediaName(game.medias, regionPriorities(options?.language));
    const systemId = text(game.systeme?.id ?? game.systemeid);
    if (media && /^\d+$/.test(systemId)) {
      try {
        const image = await fetchScreenScraperMedia(systemId, String(game.id), media, COVER_MAX_WIDTH);
        if (image && isJpegBuffer(image.buffer)) formatted.cover_image = await storeItemImage(image.buffer);
      } catch (err: any) {
        // A missing cover never costs the user the rest of the details.
        console.error('[ERR] ScreenScraper cover:', err.message);
      }
    }
    return formatted;
  }
}

/**
 * GET /api/games/screenscraper/media?system=&game=&media= : a search result's thumbnail,
 * fetched here with the credentials and handed to the browser as a plain image.
 */
export async function screenScraperMediaRoute(req: any, res: any): Promise<void> {
  const system = String(req.query.system || '');
  const game = String(req.query.game || '');
  const media = String(req.query.media || '');
  // Only what a search result could have produced: two ids and a media name such as
  // `box-2D(eu)`. Anything else never reaches ScreenScraper.
  if (!/^\d+$/.test(system) || !/^\d+$/.test(game) || !/^[A-Za-z0-9-]{1,40}(\([a-z]{2,3}\))?$/.test(media)) {
    res.status(400).end();
    return;
  }

  try {
    const image = await fetchScreenScraperMedia(system, game, media, THUMBNAIL_MAX_WIDTH);
    if (!image) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', image.contentType);
    res.set('X-Content-Type-Options', 'nosniff');
    // The same result card comes back on every search for the same words.
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(image.buffer);
  } catch (err: any) {
    console.error('[ERR] ScreenScraper thumbnail:', err.message);
    res.status(err?.status === 429 || err?.status === 430 ? 429 : 502).end();
  }
}
