import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';
import { TMDB_LANG_MAP } from './constants';

export class TMDBProvider implements SearchProvider {
  name = 'TMDB';

  private formatTMDBItem(item: any): SearchResult | null {
    if (!item) return null;
    let cover = '';
    if (item.poster_path) {
      cover = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
    }
    const year = (item.release_date || item.first_air_date || '').substring(0, 4);

    return {
      id: `${item.media_type}_${item.id}`,
      title: item.title || item.name || 'Untitled',
      creator: '', // Will be resolved on details
      year,
      cover_image: cover,
      media_type: item.media_type
    };
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) throw new Error("TMDB_API_KEY missing");
    const lang = options.language || 'fr';
    const tmdbLang = TMDB_LANG_MAP[lang] || "en-US";

    const [page1, page2] = await Promise.all([
      fetchJson(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&language=${tmdbLang}&page=1`),
      fetchJson(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&language=${tmdbLang}&page=2`)
    ]);

    const allResults = [
      ...(page1.results || []),
      ...(page2.results || [])
    ];

    const filtered = allResults.filter(item => item.media_type === "movie" || item.media_type === "tv");
    return filtered.map(item => this.formatTMDBItem(item)).filter(Boolean) as SearchResult[];
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) throw new Error("TMDB_API_KEY missing");
    const lang = options.language || 'fr';
    const tmdbLang = TMDB_LANG_MAP[lang] || "en-US";

    const [mediaType, tmdbId] = id.split('_');
    if (!mediaType || !tmdbId) throw new Error("Invalid TMDB format ID (expected mediaType_tmdbId)");

    const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbApiKey}&language=${tmdbLang}&append_to_response=credits`;
    const data = await fetchJson(url);

    let director = "Unknown";
    if (mediaType === "movie" && data.credits && data.credits.crew) {
      const dirObj = data.credits.crew.find((member: any) => member.job === "Director");
      if (dirObj) director = dirObj.name;
    } else if (mediaType === "tv" && data.created_by && data.created_by.length > 0) {
      director = data.created_by.map((c: any) => c.name).join(", ");
    }

    const studio = data.production_companies && data.production_companies.length > 0
      ? data.production_companies[0].name
      : "";

    const year = mediaType === "tv"
      ? (data.first_air_date || "").substring(0, 4)
      : (data.release_date || "").substring(0, 4);

    const duration = mediaType === "tv"
      ? `${data.number_of_seasons} Saison(s)`
      : `${data.runtime || "?"} min`;

    return {
      title: mediaType === "tv" ? data.name : data.title,
      creator: director,
      director,
      studio,
      year,
      duration,
      cover_image: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "",
      description: data.overview || "",
      genres: data.genres ? data.genres.map((g: any) => g.name) : [],
      tmdb_id: data.id,
      media_type: mediaType
    };
  }
}
