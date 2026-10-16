import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson, fuzzyCardSearch } from '../../core/helpers';
import { deriveMtgFormat, expandColors } from './constants';

const BASE_URL = 'https://api.scryfall.com';
// Scryfall requires a descriptive User-Agent on every request — the same convention
// plugins/music/apiRoutes.ts already uses for Discogs, nothing new introduced here.
const HEADERS = { 'User-Agent': 'DVinylApp/2.0', Accept: 'application/json' };

export interface ScryfallCard {
  id: string;
  name: string;
  set_name: string;
  type_line: string;
  rarity: string;
  artist?: string;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  image_uris?: { normal?: string; [size: string]: string | undefined };
  card_faces?: { image_uris?: { normal?: string } }[];
  prices?: { usd?: string; usd_foil?: string; eur?: string; tix?: string };
}

function coverImage(card: ScryfallCard): string {
  return card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
}

export async function fetchScryfallCard(id: string): Promise<ScryfallCard> {
  return fetchJson(`${BASE_URL}/cards/${encodeURIComponent(id)}`, { headers: HEADERS });
}

export class ScryfallProvider implements SearchProvider {
  name = 'Scryfall';

  // Scryfall's own q= search already tokenizes fairly well; fuzzyCardSearch's first-word
  // retry is a no-cost safety net underneath it, for the punctuation-sensitive cases it
  // still misses (a double-faced card's "Fire // Ice", typed without the slashes).
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const fetchRows = async (q: string): Promise<ScryfallCard[]> => {
      try {
        const data = await fetchJson(`${BASE_URL}/cards/search?q=${encodeURIComponent(q)}`, { headers: HEADERS });
        return data.data || [];
      } catch (err: any) {
        // Scryfall returns 404 for "no cards matched" rather than an empty 200 list.
        if (err.status === 404) return [];
        throw err;
      }
    };
    const cards = await fuzzyCardSearch(query, fetchRows, card => card.name);
    return cards.slice(0, options.limit || 25).map(card => ({
      id: card.id,
      title: card.name,
      creator: card.set_name,
      cover_image: coverImage(card),
      rarity: card.rarity
    }));
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const card = await fetchScryfallCard(id);
    return {
      title: card.name,
      creator: card.set_name,
      cover_image: coverImage(card),
      scryfall_id: card.id,
      set_name: card.set_name,
      card_type: deriveMtgFormat(card.type_line),
      rarity: card.rarity,
      artist: card.artist || '',
      mana_cost: card.mana_cost || '',
      power: card.power || '',
      toughness: card.toughness || '',
      colors: expandColors(card.colors)
    };
  }
}
