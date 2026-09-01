import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';
import { cacheYugiohImage } from './imageCache';
import { deriveYugiohFormat } from './constants';

const BASE_URL = 'https://db.ygoprodeck.com/api/v7';

export interface YgoCardSet {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_price?: string;
}

export interface YgoCard {
  id: number;
  name: string;
  type: string;
  race: string;
  attribute?: string;
  atk?: number;
  def?: number;
  level?: number;
  card_sets?: YgoCardSet[];
  card_images: { id: number; image_url: string }[];
  card_prices?: { tcgplayer_price?: string; cardmarket_price?: string; ebay_price?: string; amazon_price?: string; coolstuffinc_price?: string }[];
}

export async function fetchYgoprodeckCard(numericId: string): Promise<YgoCard> {
  const data = await fetchJson(`${BASE_URL}/cardinfo.php?id=${encodeURIComponent(numericId)}`);
  return data.data[0];
}

/**
 * Resolves the printing an encoded id refers to.
 *
 * A card_sets[] set_code is NOT always unique — some cards have two entries with the
 * same set_code but a different set_rarity, and a large price gap between them (verified
 * live: Dark Magician's RA05-EN083 appears as both Starlight Rare and Ultra Rare; so do
 * DTP1-EN002, RA03-EN080, RA04-EN106, SBCB-EN001 and YSYR-EN001 on the same card). The
 * printing's index within card_sets[] disambiguates those; encoded ids carry it as a
 * third `::`-separated segment. The set_code is still checked against the indexed entry
 * so that if YGOPRODeck's array order ever shifts, the lookup degrades to a plain
 * set_code search instead of silently returning an unrelated printing. Ids written before
 * this scheme have no index segment and take the same set_code-only path.
 *
 * Written down here because the design docs that explain this are gitignored and don't
 * ship with the code.
 */
export function findPrinting(card: YgoCard, setCode: string, idx?: number): YgoCardSet | undefined {
  const sets = card.card_sets || [];
  if (idx !== undefined && sets[idx] && sets[idx]!.set_code === setCode) return sets[idx];
  return sets.find(s => s.set_code === setCode);
}

/** Splits an encoded `<numericId>::<setCode>[::<index>]` id into its parts. */
export function parseYugiohId(encodedId: string): { numericId: string; setCode: string; idx: number | undefined } {
  const [numericId, setCode, idxStr] = String(encodedId).split('::');
  const idx = idxStr !== undefined && idxStr !== '' ? parseInt(idxStr, 10) : undefined;
  return {
    numericId: numericId || '',
    setCode: setCode || '',
    idx: idx !== undefined && Number.isFinite(idx) ? idx : undefined
  };
}

export class YgoprodeckProvider implements SearchProvider {
  name = 'YGOPRODeck';

  // One YGOPRODeck card bundles every set printing under card_sets[]; this flattens
  // that into one SearchResult per (card, printing), the same "pick one card = one
  // printing" shape every other plugin's confirm flow expects. cardinfo.php doubles
  // as both search and detail (returns full card_sets[] already), so no second call
  // is needed here.
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let data: any;
    try {
      data = await fetchJson(`${BASE_URL}/cardinfo.php?fname=${encodeURIComponent(query)}`);
    } catch (err: any) {
      if (err.status === 400) return []; // YGOPRODeck 400s on "no cards matched"
      throw err;
    }
    const cards: YgoCard[] = data.data || [];
    const rows: SearchResult[] = [];
    const limit = options.limit || 25;
    // A single card can carry dozens of printings (Dark Magician: 59, verified live).
    // Flattening them all before the overall `limit` cutoff filled the entire results
    // grid with one card and hid every other match, so each card contributes at most
    // this many rows.
    const maxPrintingsPerCard = 5;
    for (const card of cards) {
      const allPrintings = card.card_sets && card.card_sets.length ? card.card_sets : [undefined];
      // Taking a PREFIX of card_sets[] keeps `i` below equal to the printing's index in
      // the original, unsliced array — which is exactly what the encoded id records and
      // what findPrinting() indexes back into on a later fetch. Any other subsetting
      // (filtering, sorting) would have to carry the original index explicitly.
      const printings = allPrintings.slice(0, maxPrintingsPerCard);
      for (let i = 0; i < printings.length; i++) {
        if (rows.length >= limit) break;
        const printing = printings[i];
        rows.push({
          id: printing ? `${card.id}::${printing.set_code}::${i}` : `${card.id}::`,
          title: card.name,
          creator: printing?.set_name || '',
          // Search-grid previews are NOT cached (unlike getDetails/refreshItem/
          // imageSearchProvider, which persist a cover_image) — they're transient and
          // most are never picked, so caching all of them would multiply network calls
          // for no benefit.
          cover_image: card.card_images?.[0]?.image_url || '',
          rarity: printing?.set_rarity || ''
        });
      }
      if (rows.length >= limit) break;
    }
    return rows;
  }

  async getDetails(encodedId: string): Promise<ConfirmData> {
    const { numericId, setCode, idx } = parseYugiohId(encodedId);
    const card = await fetchYgoprodeckCard(numericId);
    const printing = findPrinting(card, setCode, idx) || card.card_sets?.[0];
    const remoteImage = card.card_images?.[0]?.image_url || '';
    const cover_image = await cacheYugiohImage(String(card.id), remoteImage);

    return {
      title: card.name,
      creator: printing?.set_name || '',
      cover_image,
      ygo_card_id: encodedId,
      set_name: printing?.set_name || '',
      rarity: printing?.set_rarity || '',
      card_type: deriveYugiohFormat(card.type),
      race: card.race || '',
      attribute: card.attribute || '',
      atk: card.atk || 0,
      def: card.def || 0,
      level: card.level || 0
    };
  }
}
