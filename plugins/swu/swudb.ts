import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BASE_URL = 'https://api.swu-db.com';

export interface SwuCard {
  Set: string;
  Number: string;
  Name: string;
  Subtitle?: string;
  Type: string; // "Leader" | "Base" | "Unit" | "Event"
  Aspects?: string[];
  Traits?: string[];
  Arenas?: string[];
  Cost?: string;
  Power?: string;
  HP?: string;
  Rarity: string;
  Unique?: boolean;
  Keywords?: string[];
  FrontArt?: string;
  MarketPrice?: string;
  FoilPrice?: string;
  LowPrice?: string;
}

function displayTitle(card: SwuCard): string {
  return card.Subtitle ? `${card.Name} - ${card.Subtitle}` : card.Name;
}

/**
 * A card's identity is `<Set>-<Number>` (e.g. "SOR-010"), split back apart here for the
 * single-card endpoint, which addresses a card by its two parts rather than one combined id.
 */
export async function fetchSwuCard(cardId: string): Promise<SwuCard> {
  const [set, number] = cardId.split('-');
  if (!set || !number) throw new Error(`Invalid SWU card id: ${cardId}`);
  return fetchJson(`${BASE_URL}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}?format=json`);
}

export class SwuProvider implements SearchProvider {
  name = 'SWU-DB';

  // The `q` param takes a `field:value` filter expression (verified live); `name:` is the
  // one this plugin needs. Only the value itself is percent-encoded, not the `name:` prefix.
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let payload: { data: SwuCard[] };
    try {
      payload = await fetchJson(`${BASE_URL}/cards/search?q=name:${encodeURIComponent(query)}&format=json`);
    } catch (err: any) {
      if (err.status === 404) return [];
      throw err;
    }
    return (payload.data || []).slice(0, options.limit || 25).map(card => ({
      id: `${card.Set}-${card.Number}`,
      title: displayTitle(card),
      creator: card.Set,
      cover_image: card.FrontArt || '',
      rarity: card.Rarity
    }));
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const card = await fetchSwuCard(id);
    return {
      title: displayTitle(card),
      creator: card.Set,
      cover_image: card.FrontArt || '',
      swu_card_id: `${card.Set}-${card.Number}`,
      set_name: card.Set,
      card_type: card.Type,
      rarity: card.Rarity,
      cost: card.Cost ? parseInt(card.Cost, 10) : 0,
      power: card.Power ? parseInt(card.Power, 10) : 0,
      hp: card.HP ? parseInt(card.HP, 10) : 0,
      aspects: card.Aspects || [],
      traits: card.Traits || [],
      arenas: card.Arenas || [],
      unique: !!card.Unique
    };
  }
}
