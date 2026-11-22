/**
 * What a board game goes for, read off BoardGameGeek's marketplace.
 *
 * `/thing?marketplace=1` returns, with each game, the copies on sale on the GeekMarket:
 * an asking price in the seller's own currency and the state of the copy. That is all
 * BGG publishes about prices (no sold history, no suggested value), so an estimate is
 * drawn from those asking prices.
 */

import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../../core/helpers';
import { BGG_BASE, bggHeaders } from './constants';

export interface MarketListing {
  price: number;
  currency: string;
  /** BGG's own wording: new, likenew, verygood, good, acceptable. */
  condition: string;
}

export interface MarketEstimate {
  value: number;
  /** How many listings the value was drawn from. */
  count: number;
}

// A response carrying one game, or a game with one copy on sale, must still read as lists.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => name === 'item' || name === 'listing'
});

/** The listings of every game in a `/thing?marketplace=1` response, by BGG id. */
export function parseMarketplace(xml: string): Map<string, MarketListing[]> {
  // BGG closes its answer with </items>. An error page, an empty body or an answer cut
  // short, served with a 200 by something on the way, is not a list of games, and must
  // not be remembered as games nobody is selling.
  if (!/<\/items>\s*$/.test(xml)) throw new Error('BoardGameGeek did not answer with a list of games');

  const byId = new Map<string, MarketListing[]>();
  for (const game of parser.parse(xml)?.items?.item || []) {
    const listings: MarketListing[] = [];
    // A game nobody is selling comes without the element altogether.
    for (const listing of game.marketplacelistings?.listing || []) {
      const price = Number(listing.price?.value);
      const currency = String(listing.price?.currency || '').toUpperCase();
      if (!Number.isFinite(price) || price <= 0 || !currency) continue;
      listings.push({ price, currency, condition: String(listing.condition?.value || '') });
    }
    byId.set(String(game.id), listings);
  }
  return byId;
}

// The states a copy that has been opened is sold in. Board games carry no condition of
// their own here, and a shelf is mostly played copies: sealed ones ("new") are priced
// like the shop's, so they only count when nothing else is on sale.
const USED = new Set(['likenew', 'verygood', 'good', 'acceptable']);

/**
 * One value for a game, out of its listings: the median asking price of the copies
 * priced in `currency`. The median rather than the lowest or the average, because the
 * cheapest copy is often incomplete and the dearest ones are the ones that never sell.
 *
 * Nothing is converted, as everywhere else in the app: a copy priced in another currency
 * is left out, and a game with none in the reader's currency has no estimate.
 */
export function estimateFromListings(listings: MarketListing[], currency: string): MarketEstimate | null {
  let pool = listings.filter(listing => listing.currency === currency && listing.price > 0);

  const used = pool.filter(listing => USED.has(listing.condition));
  if (used.length > 0) pool = used;

  if (pool.length === 0) return null;

  const prices = pool.map(listing => listing.price).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[middle]! : (prices[middle - 1]! + prices[middle]!) / 2;
  return { value: Math.round(median * 100) / 100, count: prices.length };
}

/**
 * A BGG id is a positive number, written the way BGG writes it (it answers "007" with
 * game 7). Anything else (an id typed by hand) is never sent to BGG.
 */
export const isBggId = (value: unknown): boolean => /^[1-9]\d{0,9}$/.test(String(value ?? ''));

async function fetchListings(ids: string[]): Promise<Map<string, MarketListing[]>> {
  const xml = await fetchText(`${BGG_BASE}/thing?id=${ids.join(',')}&marketplace=1`, {
    headers: bggHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  return parseMarketplace(xml);
}

// How many games /thing answers for in one call (one more and it answers with a 400).
const BATCH_SIZE = 20;
// Twenty games with their listings take BGG a second or two.
const TIMEOUT_MS = 15 * 1000;
// Asking prices move slowly: a second run within the hour reads the same listings.
const CACHE_MS = 60 * 60 * 1000;
// BGG fails a call now and then: it is tried once more, after a moment.
const RETRY_MS = 2 * 1000;
// How long BGG is left alone once the second try has failed too: the time the run takes
// to get past the batch that failed (twenty games, half a second apart), so that the
// next call is for the next batch and one failure costs the run one batch.
const PAUSE_MS = 10 * 1000;

/**
 * Listings kept for a while, and fetched a batch at a time.
 *
 * The estimate asks for one game after another, half a second apart, where BGG asks
 * applications to keep their calls few and suggests five seconds between them. So the
 * first game that is not known yet takes the next ones of the run along in the same
 * call, and those are then answered from memory: one call every twenty games.
 */
export function createMarketplace(fetchBatch = fetchListings, clock: () => number = Date.now, retryMs = RETRY_MS) {
  const cache = new Map<string, { at: number; listings: MarketListing[] }>();
  let pausedUntil = 0;

  const known = (id: string): MarketListing[] | null => {
    const entry = cache.get(id);
    return entry && clock() - entry.at < CACHE_MS ? entry.listings : null;
  };

  /**
   * The listings of one game. `run` is the ids of the run it belongs to, in the order
   * they will be asked for.
   */
  async function listingsFor(id: string, run: string[] = []): Promise<MarketListing[]> {
    const hit = known(id);
    if (hit) return hit;

    // The next game of the run arrives half a second later: without this, every one of
    // them would send again the call BGG keeps turning down.
    if (clock() < pausedUntil) throw new Error('BoardGameGeek marketplace unavailable');

    const batch = [id];
    for (const next of run.slice(run.indexOf(id) + 1)) {
      if (batch.length >= BATCH_SIZE) break;
      if (!batch.includes(next) && !known(next)) batch.push(next);
    }

    try {
      const found = await fetchBatch(batch).catch(async () => {
        await new Promise(resolve => setTimeout(resolve, retryMs));
        return fetchBatch(batch);
      });
      // A game with nothing on sale is remembered as such, or it would be asked for
      // again with every batch.
      const at = clock();
      for (const one of batch) cache.set(one, { at, listings: found.get(one) || [] });
      return found.get(id) || [];
    } catch (err) {
      pausedUntil = clock() + PAUSE_MS;
      throw err;
    }
  }

  return { listingsFor };
}
