import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BASE_URL = 'https://api.tcgdex.net/v2/en/cards';

export interface TcgdexPriceVariant {
  type: string; // 'normal' | 'reverse' | 'holo' | ...
  pricing?: {
    tcgplayer?: { unit: string; updated: string; [variantKey: string]: any };
    cardmarket?: { unit: string; updated: string; avg?: number; [key: string]: any };
  };
}

export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: 'Pokemon' | 'Trainer' | 'Energy';
  rarity?: string;
  illustrator?: string;
  hp?: number;
  types?: string[];
  set?: { id: string; name: string };
  variants_detailed?: TcgdexPriceVariant[];
}

interface TcgdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

/** TCGdex image URLs carry no extension; a quality+format suffix must be appended. */
function coverImageUrl(rawImage?: string): string {
  return rawImage ? `${rawImage}/high.webp` : '';
}

export async function fetchTcgdexCard(id: string): Promise<TcgdexCard> {
  return fetchJson(`${BASE_URL}/${encodeURIComponent(id)}`);
}

export class TcgdexProvider implements SearchProvider {
  name = 'TCGdex';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const results: TcgdexCardBrief[] = await fetchJson(
      `${BASE_URL}?name=like:${encodeURIComponent(query)}`
    );
    // TCGdex's list endpoint returns only id/localId/name/image (no set info), unlike
    // Discogs/Rebrickable whose search endpoints already carry a creator field. The
    // creator column stays blank at this stage; getDetails() fills in set_name once a
    // result is picked, matching the CardBrief/Card split TCGdex's own API makes.
    return (results || []).slice(0, options.limit || 25).map(card => ({
      id: card.id,
      title: card.name,
      creator: '',
      cover_image: coverImageUrl(card.image)
    }));
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const card = await fetchTcgdexCard(id);
    return {
      title: card.name,
      creator: card.set?.name || '',
      cover_image: coverImageUrl(card.image),
      pokemon_card_id: card.id,
      set_name: card.set?.name || '',
      card_number: card.localId || '',
      category: card.category || 'Pokemon',
      rarity: card.rarity || '',
      artist: card.illustrator || '',
      hp: card.hp || 0,
      types: card.types || []
    };
  }
}
