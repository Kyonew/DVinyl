import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BASE_URL = 'https://goagain.dev/v1';

export interface FabPrinting {
  id: string; set_id: string; rarity: string; image_url: string;
}

export interface FabCard {
  unique_id: string; name: string; color: string; pitch: string; cost: string;
  power: string; defense: string; types: string[]; type_text: string;
  printings: FabPrinting[];
}

/**
 * `/v1/cards?name=` returns one row per CARD with every printing nested — alternate
 * arts/reprints each carry their own rarity and art, exactly the same shape One Piece's
 * optcgapi.com API has. The encoded id `<unique_id>::<printing_id>` is what keeps a
 * specific printing addressable through search -> confirm -> save -> refresh, the same
 * technique `plugins/onepiece/optcgapi.ts` uses (see that file's comment for the full
 * rationale). Every caller treats the id as opaque; only this module decodes it.
 */
export async function fetchFabCard(encodedId: string): Promise<{ card: FabCard; printing: FabPrinting }> {
  const [uniqueId, printingId] = encodedId.split('::');
  const card: FabCard = await fetchJson(`${BASE_URL}/cards/${encodeURIComponent(uniqueId!)}`);
  const printing = (printingId ? card.printings.find(p => p.id === printingId) : undefined) || card.printings[0];
  if (!printing) throw new Error(`Flesh and Blood card has no printings: ${encodedId}`);
  return { card, printing };
}

export class FabProvider implements SearchProvider {
  name = 'Flesh and Blood API';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let payload: { data: FabCard[] };
    try {
      payload = await fetchJson(`${BASE_URL}/cards?name=${encodeURIComponent(query)}`);
    } catch (err: any) {
      if (err.status === 404) return [];
      throw err;
    }
    const results: SearchResult[] = [];
    for (const card of payload.data || []) {
      for (const printing of card.printings || []) {
        results.push({
          id: `${card.unique_id}::${printing.id}`,
          title: card.name,
          creator: printing.set_id,
          cover_image: printing.image_url,
          rarity: printing.rarity
        });
        if (results.length >= (options.limit || 25)) return results;
      }
    }
    return results;
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const { card, printing } = await fetchFabCard(id);
    return {
      title: card.name,
      creator: printing.set_id,
      cover_image: printing.image_url,
      fab_card_id: id,
      set_name: printing.set_id,
      card_type: card.type_text,
      card_color: card.color || '',
      pitch: parseInt(card.pitch, 10) || 0,
      cost: parseInt(card.cost, 10) || 0,
      power: parseInt(card.power, 10) || 0,
      defense: parseInt(card.defense, 10) || 0,
      rarity: printing.rarity
    };
  }
}
