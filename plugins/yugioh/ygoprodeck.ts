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

function findPrinting(card: YgoCard, setCode: string): YgoCardSet | undefined {
  return (card.card_sets || []).find(s => s.set_code === setCode);
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
    for (const card of cards) {
      const printings = card.card_sets && card.card_sets.length ? card.card_sets : [undefined];
      for (const printing of printings) {
        if (rows.length >= limit) break;
        rows.push({
          id: printing ? `${card.id}::${printing.set_code}` : `${card.id}::`,
          title: card.name,
          creator: printing?.set_name || '',
          cover_image: card.card_images?.[0]?.image_url || ''
        });
      }
      if (rows.length >= limit) break;
    }
    return rows;
  }

  async getDetails(encodedId: string): Promise<ConfirmData> {
    const [numericId, setCode] = encodedId.split('::');
    const card = await fetchYgoprodeckCard(numericId!);
    const printing = findPrinting(card, setCode || '') || card.card_sets?.[0];
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
