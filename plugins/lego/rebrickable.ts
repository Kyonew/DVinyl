import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';
import { REBRICKABLE_BASE, rebrickableHeaders } from './constants';

interface RbTheme {
  id: number;
  parent_id: number | null;
  name: string;
}

interface RbSet {
  set_num: string;
  name: string;
  year: number;
  theme_id: number;
  num_parts: number;
  set_img_url: string | null;
  set_url: string | null;
}

// The themes list is small and stable; fetch it once and cache the whole tree so
// resolving a theme name for each search result costs no extra API call.
let themeCache: Map<number, RbTheme> | null = null;
let themeCachePromise: Promise<Map<number, RbTheme>> | null = null;

async function loadThemes(): Promise<Map<number, RbTheme>> {
  if (themeCache) return themeCache;
  if (themeCachePromise) return themeCachePromise;

  themeCachePromise = (async () => {
    const map = new Map<number, RbTheme>();
    let url: string | null = `${REBRICKABLE_BASE}/themes/?page_size=1000`;
    while (url) {
      const data: any = await fetchJson(url, { headers: rebrickableHeaders() });
      for (const t of data.results || []) {
        map.set(t.id, { id: t.id, parent_id: t.parent_id, name: t.name });
      }
      url = data.next || null;
    }
    themeCache = map;
    return map;
  })();

  try {
    return await themeCachePromise;
  } catch (err) {
    // Let the next call retry instead of caching the failure permanently.
    themeCachePromise = null;
    throw err;
  }
}

// Collectors think in top-level themes ("Star Wars", "Technic", "City") rather than
// the deep sub-theme, so resolve each theme up to its root.
function rootThemeName(themes: Map<number, RbTheme>, themeId: number): string {
  let current = themes.get(themeId);
  if (!current) return '';
  const seen = new Set<number>();
  while (current.parent_id && themes.has(current.parent_id) && !seen.has(current.id)) {
    seen.add(current.id);
    current = themes.get(current.parent_id)!;
  }
  return current.name;
}

export class RebrickableProvider implements SearchProvider {
  name = 'Rebrickable';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const themes = await loadThemes();

    const url = `${REBRICKABLE_BASE}/sets/?search=${encodeURIComponent(query)}&page_size=20&ordering=-year`;
    const data = await fetchJson(url, { headers: rebrickableHeaders() });

    return (data.results || []).map((set: RbSet) => {
      const theme = rootThemeName(themes, set.theme_id);
      return {
        id: set.set_num,
        title: set.name,
        creator: theme,
        theme,
        year: set.year ? String(set.year) : '',
        pieces: set.num_parts || 0,
        cover_image: set.set_img_url || '',
        set_num: set.set_num
      } as SearchResult;
    });
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const themes = await loadThemes();

    const set: RbSet = await fetchJson(`${REBRICKABLE_BASE}/sets/${encodeURIComponent(id)}/`, {
      headers: rebrickableHeaders()
    });

    let minifigs = 0;
    try {
      const mf = await fetchJson(
        `${REBRICKABLE_BASE}/sets/${encodeURIComponent(id)}/minifigs/?page_size=1`,
        { headers: rebrickableHeaders() }
      );
      minifigs = mf.count || 0;
    } catch {
      // Some sets have no minifig endpoint data; keep the count at zero.
    }

    const theme = rootThemeName(themes, set.theme_id);

    return {
      title: set.name,
      creator: theme,
      theme,
      year: set.year ? String(set.year) : '',
      pieces: set.num_parts || 0,
      minifigs,
      cover_image: set.set_img_url || '',
      set_num: set.set_num,
      rebrickable_url: set.set_url || `https://rebrickable.com/sets/${set.set_num}/`,
      description: ''
    };
  }

  async searchImages(query: string): Promise<string[]> {
    const url = `${REBRICKABLE_BASE}/sets/?search=${encodeURIComponent(query)}&page_size=20`;
    const data = await fetchJson(url, { headers: rebrickableHeaders() });
    return (data.results || [])
      .map((set: RbSet) => set.set_img_url)
      .filter((u: string | null): u is string => !!u);
  }
}
