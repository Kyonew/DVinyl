import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BASE_URL = 'https://api.lorcana-api.com/cards/fetch';

export interface LorcanaCard {
  Name: string; Set_Name: string; Set_ID: string; Card_Num: number; Unique_ID: string;
  Classifications?: string; Color: string; Image: string; Cost: number; Inkable: boolean;
  Type: string; Lore?: number; Rarity: string; Willpower?: number; Strength?: number;
}

function toClassifications(raw: string | undefined): string[] {
  return (raw || '').split(/,\s*/).filter(Boolean);
}

/**
 * The live API's `Type` field is not the neat "Character|Action|Item|Location|Song" this
 * plugin's format enum assumes (verified live: a song comes back as "Action - Song", never
 * bare "Song" — e.g. "Let It Go" and "How Far I'll Go" are both `Type: "Action - Song"`).
 * Storing the raw value would fail the schema's card_type enum outright, so it's folded
 * onto the 5-value badge/format set here, at the one place every caller (search results
 * aside, which don't carry card_type) goes through.
 */
export function normalizeCardType(rawType: string | undefined): string {
  const type = (rawType || '').trim();
  if (type.includes('Song')) return 'Song';
  if (['Character', 'Action', 'Item', 'Location'].includes(type)) return type;
  // Unseen future shape ("X - Y"): keep the leading segment rather than drop the type.
  return type.split(/\s*-\s*/)[0] || 'Character';
}

export async function fetchLorcanaCard(uniqueId: string): Promise<LorcanaCard> {
  const rows: LorcanaCard[] = await fetchJson(`${BASE_URL}?search=unique_id=${encodeURIComponent(uniqueId)}`);
  const card = rows[0];
  if (!card) throw new Error(`Lorcana card not found: ${uniqueId}`);
  return card;
}

export class LorcanaProvider implements SearchProvider {
  name = 'Lorcana API';

  // name~ is a contains match (verified live: "Elsa" returns every "Elsa - ..." printing).
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let rows: LorcanaCard[];
    try {
      rows = await fetchJson(`${BASE_URL}?search=name~${encodeURIComponent(query)}`);
    } catch (err: any) {
      if (err.status === 404) return [];
      throw err;
    }
    return (rows || []).slice(0, options.limit || 25).map(card => ({
      id: card.Unique_ID,
      title: card.Name,
      creator: card.Set_Name,
      cover_image: card.Image,
      rarity: card.Rarity
    }));
  }

  async getDetails(id: string): Promise<ConfirmData> {
    const card = await fetchLorcanaCard(id);
    return {
      title: card.Name,
      creator: card.Set_Name,
      cover_image: card.Image,
      lorcana_card_id: card.Unique_ID,
      set_name: card.Set_Name,
      ink_color: card.Color,
      card_type: normalizeCardType(card.Type),
      cost: card.Cost || 0,
      lore: card.Lore || 0,
      strength: card.Strength || 0,
      willpower: card.Willpower || 0,
      inkable: !!card.Inkable,
      classifications: toClassifications(card.Classifications),
      rarity: card.Rarity
    };
  }
}
