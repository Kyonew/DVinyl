import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BASE_URL = 'https://digimoncard.io/api-public/search';
// Without a User-Agent, digimoncard.io has been observed to 301-redirect oddly instead
// of answering directly — sent on every request to this API, search and lookup alike.
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export interface DigimonCard {
  name: string;
  type: string; // "Digimon" | "Tamer" | "Option" | "Digi-Egg"
  id: string; // e.g. "BT1-010"
  level: number | null; // Digimon only
  play_cost: number | null;
  evolution_cost: number | null;
  color: string | null;
  color2: string | null;
  digi_type: string | null; // Digimon only
  form: string | null; // Digimon only
  dp: number | null; // Digimon only
  attribute: string | null; // Digimon only
  rarity: string;
  stage: string | null; // Digimon only
  main_effect: string;
  source_effect: string;
  set_name: string[]; // always an array, first element used as the single set_name
}

/**
 * Images are not part of the API payload at all — built directly from the card id,
 * the same "construct, don't trust a field" precedent as Yu-Gi-Oh!'s imageCache.ts,
 * except this CDN allows direct hotlinking (confirmed live: returns
 * content-type: image/jpeg with no documented restriction), so no local caching is
 * needed here — just the URL string.
 */
function cardImageUrl(id: string): string {
  return `https://images.digimoncard.io/images/cards/${encodeURIComponent(id)}.jpg`;
}

/**
 * `card=<id>` is confirmed to return exactly one row (verified live). Still indexed
 * as `rows[0]` rather than assumed to be the bare object, since every other endpoint
 * on this API answers with an array.
 */
export async function fetchDigimonCard(id: string): Promise<DigimonCard> {
  const rows: DigimonCard[] = await fetchJson(
    `${BASE_URL}?series=${encodeURIComponent('Digimon Card Game')}&card=${encodeURIComponent(id)}`,
    { headers: HEADERS }
  );
  const card = rows[0];
  if (!card) throw new Error(`Digimon card not found: ${id}`);
  return card;
}

export class DigimonProvider implements SearchProvider {
  name = 'DigimonCard.io';

  // n= is the confirmed working param for a partial name match (case-insensitive
  // substring, verified live). name=/q=/search= all return the ENTIRE ~9300-card
  // database unfiltered instead of erroring, so using the wrong one silently breaks
  // search rather than failing loudly — do not "fix" this to a more obvious param.
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let rows: DigimonCard[];
    try {
      rows = await fetchJson(
        `${BASE_URL}?series=${encodeURIComponent('Digimon Card Game')}&n=${encodeURIComponent(query)}`,
        { headers: HEADERS }
      );
    } catch (err: any) {
      if (err.status === 404) return [];
      throw err;
    }
    // Alternate-art/parallel printings repeat the same id as separate rows; only the
    // first occurrence of each id is kept, matching the plugin's one-row-per-id model
    // (there is no per-printing external id scheme here, unlike One Piece/Yu-Gi-Oh!).
    const seen = new Set<string>();
    const deduped: DigimonCard[] = [];
    for (const card of rows || []) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      deduped.push(card);
    }
    return deduped.slice(0, options.limit || 25).map(card => ({
      id: card.id,
      title: card.name,
      creator: (card.set_name || [])[0] || '',
      cover_image: cardImageUrl(card.id),
      rarity: card.rarity
    }));
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const card = await fetchDigimonCard(id);
    return {
      title: card.name,
      creator: (card.set_name || [])[0] || '',
      cover_image: cardImageUrl(card.id),
      digimon_card_id: card.id,
      // set_name is always an array (possibly of several reprints); only the first
      // element is kept as this plugin's single set_name string, an accepted
      // simplification for a card that has been reprinted across multiple sets.
      set_name: (card.set_name || [])[0] || '',
      card_type: card.type,
      card_color: card.color || '',
      level: card.level || 0,
      dp: card.dp || 0,
      play_cost: card.play_cost || 0,
      form: card.form || '',
      attribute: card.attribute || '',
      digi_type: card.digi_type || '',
      rarity: card.rarity
    };
  }
}
