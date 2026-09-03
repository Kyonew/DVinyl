import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson, fuzzyCardSearch } from '../../core/helpers';

const BASE_URL = 'https://optcgapi.com/api';

export interface OnePieceCard {
  card_set_id: string;
  card_name: string;
  set_name: string;
  rarity: string;
  card_type: string; // "Leader" | "Character" | "Event" | "Stage"
  card_color: string;
  card_cost: string | null;
  card_power: string | null;
  counter_amount: number | null;
  life: string | null;
  sub_types: string; // space-separated, e.g. "Straw Hat Crew Supernovas"
  card_image: string; // ready-to-use URL, no suffix needed
  card_image_id: string; // uniquely identifies the printing: "OP01-001" vs "OP01-001_p1"
  market_price?: number;
  inventory_price?: number;
}

function toTraits(subTypes: string | undefined): string[] {
  return (subTypes || '').split(/\s+/).filter(Boolean);
}

/**
 * /sets/card/<id>/ returns an ARRAY — the base printing plus alternate/parallel-art
 * printings of the same card_set_id, each with its own price (verified live: OP01-001
 * is $2.35 as the base printing and $568.01 as "_p1", a 240x gap). Only card_image_id
 * distinguishes them, so the external id encodes BOTH as `<card_set_id>::<card_image_id>`
 * — that way a specific printing survives a round trip through the id (search -> confirm
 * -> save -> refresh/estimate), the same way Yu-Gi-Oh!'s `<numericId>::<setCode>` scheme
 * keeps a specific printing addressable. Every caller (apiRoutes.ts, index.ts) treats the
 * id as an opaque string, so the encoding is resolved here and nowhere else. Written down
 * here because the design spec/plan that explain this convention are gitignored and don't
 * ship with the code.
 */
export async function fetchOnePieceCard(encodedId: string): Promise<OnePieceCard> {
  const [cardSetId, imageId] = encodedId.split('::');
  const rows: OnePieceCard[] = await fetchJson(`${BASE_URL}/sets/card/${encodeURIComponent(cardSetId!)}/`);
  return (imageId ? rows.find(r => r.card_image_id === imageId) : undefined) || rows[0]!;
}

export class OptcgapiProvider implements SearchProvider {
  name = 'One Piece TCG API';

  // card_name= / q= / search= / card= all return the API's "used incorrectly" error;
  // card_name= is the confirmed working param (case-insensitive substring match).
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const fetchRows = async (q: string): Promise<OnePieceCard[]> => {
      try {
        return await fetchJson(`${BASE_URL}/sets/filtered/?card_name=${encodeURIComponent(q)}`);
      } catch (err: any) {
        if (err.status === 404) return [];
        throw err;
      }
    };
    const rows = await fuzzyCardSearch(query, fetchRows, card => card.card_name);
    return (rows || []).slice(0, options.limit || 25).map(card => ({
      // Encoded printing id — see fetchOnePieceCard above. The filtered/ search endpoint
      // returns one row per printing and carries card_image_id too (verified live), so
      // alternate-art rows are distinguishable right from the search grid.
      id: `${card.card_set_id}::${card.card_image_id}`,
      title: card.card_name,
      creator: card.set_name,
      cover_image: card.card_image,
      // optcgapi.com's search response already carries rarity on the flat card
      // object (confirmed live) — surfaced here (not just in getDetails) so it's
      // visible in the search-results grid, matching the same addition made to
      // MTG/Yu-Gi-Oh! after a user request; Pokémon can't do this (TCGdex's list
      // endpoint genuinely lacks rarity at search time, only getDetails has it).
      rarity: card.rarity
    }));
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const card = await fetchOnePieceCard(id);
    return {
      title: card.card_name,
      creator: card.set_name,
      cover_image: card.card_image,
      // Store the ENCODED id (what this method was called with), not card.card_set_id —
      // it's what keeps the chosen printing addressable on later refresh/estimate calls.
      op_card_id: id,
      set_name: card.set_name,
      rarity: card.rarity,
      card_type: card.card_type,
      card_color: card.card_color,
      cost: card.card_cost ? parseInt(card.card_cost, 10) : 0,
      power: card.card_power ? parseInt(card.card_power, 10) : 0,
      counter: card.counter_amount || 0,
      life: card.life ? parseInt(card.life, 10) : 0,
      traits: toTraits(card.sub_types)
    };
  }
}
