import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

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
  market_price?: number;
  inventory_price?: number;
}

function toTraits(subTypes: string | undefined): string[] {
  return (subTypes || '').split(/\s+/).filter(Boolean);
}

/**
 * /sets/card/<id>/ returns an ARRAY — the base printing plus alternate/parallel-art
 * printings of the same card_set_id, each with its own price. The base (first, cheapest
 * in practice) printing is used for a single-id fetch; search() below surfaces every
 * printing as its own row, same "flatten to one row per printing" need as Yu-Gi-Oh!.
 */
export async function fetchOnePieceCard(cardSetId: string): Promise<OnePieceCard> {
  const rows: OnePieceCard[] = await fetchJson(`${BASE_URL}/sets/card/${encodeURIComponent(cardSetId)}/`);
  return rows[0]!;
}

export class OptcgapiProvider implements SearchProvider {
  name = 'One Piece TCG API';

  // card_name= / q= / search= / card= all return the API's "used incorrectly" error;
  // card_name= is the confirmed working param (case-insensitive substring match).
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let rows: OnePieceCard[];
    try {
      rows = await fetchJson(`${BASE_URL}/sets/filtered/?card_name=${encodeURIComponent(query)}`);
    } catch (err: any) {
      if (err.status === 404) return [];
      throw err;
    }
    return (rows || []).slice(0, options.limit || 25).map(card => ({
      id: card.card_set_id,
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
      op_card_id: card.card_set_id,
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
