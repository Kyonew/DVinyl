import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';
import { TMDB_LANG_MAP, formatSeasonCount, formatEpisodeCount } from './constants';

/**
 * The episodes of a TMDB season payload, in the shape the item stores.
 *
 * Runtime is left out when TMDB has none rather than written as zero: a season nobody has
 * documented would otherwise claim every episode lasts no time at all.
 */
function toEpisodes(seasonData: any): { number: number; name: string; runtime: number | null; air_date: string; overview: string }[] {
  return (seasonData.episodes || []).map((e: any) => ({
    number: e.episode_number,
    name: e.name || '',
    runtime: typeof e.runtime === 'number' && e.runtime > 0 ? e.runtime : null,
    air_date: e.air_date || '',
    overview: e.overview || ''
  }));
}

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
      ? formatSeasonCount(data.number_of_seasons, lang)
      : `${data.runtime || "?"} min`;

    const show: ConfirmData = {
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

    if (mediaType !== "tv") return show;

    // What the confirm page offers to choose from. Season 0 is TMDB's bin for specials
    // and pilots, which is not what anyone means by owning a season of a show.
    show.seasons = (data.seasons || [])
      .filter((s: any) => s.season_number > 0)
      .map((s: any) => ({
        number: s.season_number,
        name: s.name || `${s.season_number}`,
        episode_count: s.episode_count || 0
      }));

    // No season asked for, or one this show does not have: the whole series, which is
    // what every existing item holds and what the page defaults to.
    const wanted = parseInt(String(options.season ?? ''), 10);
    if (!Number.isInteger(wanted) || !show.seasons.some((s: any) => s.number === wanted)) {
      return show;
    }

    const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${wanted}?api_key=${tmdbApiKey}&language=${tmdbLang}`;
    const seasonData = await fetchJson(seasonUrl);
    const listed = show.seasons.find((s: any) => s.number === wanted);

    // The season's own poster, air date and synopsis where it has them, the show's where
    // it does not: an obscure season with no artwork is better off wearing the show's than
    // a blank frame. The name comes from TMDB in the language the rest was fetched in, so
    // the title reads "Breaking Bad - Season 2" or "- Saison 2" to match.
    return {
      ...show,
      season: wanted,
      title: `${show.title} - ${seasonData.name || listed.name}`,
      year: (seasonData.air_date || '').substring(0, 4) || show.year,
      duration: formatEpisodeCount(
        Array.isArray(seasonData.episodes) && seasonData.episodes.length > 0
          ? seasonData.episodes.length
          : listed.episode_count,
        lang
      ),
      description: seasonData.overview || show.description,
      cover_image: seasonData.poster_path
        ? `https://image.tmdb.org/t/p/w500${seasonData.poster_path}`
        : (show.cover_image || ''),
      episodes: toEpisodes(seasonData)
    };
  }

  /**
   * The episodes of one season, with the show's season list alongside so the page can
   * offer the others.
   *
   * Used where nothing is stored to read from: a series held as one box set, and an item
   * that predates the episodes being kept on the season itself.
   */
  async getSeasonEpisodes(tmdbId: number | string, seasonNumber: number | null, lang?: string): Promise<{
    seasons: { number: number; name: string; episode_count: number }[];
    season: number | null;
    episodes: { number: number; name: string; runtime: number | null; air_date: string; overview: string }[];
  }> {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) throw new Error("TMDB_API_KEY missing");
    const tmdbLang = TMDB_LANG_MAP[lang || ''] || "en-US";

    const show = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${tmdbApiKey}&language=${tmdbLang}`);
    const seasons = (show.seasons || [])
      .filter((s: any) => s.season_number > 0)
      .map((s: any) => ({
        number: s.season_number,
        name: s.name || `${s.season_number}`,
        episode_count: s.episode_count || 0
      }));

    // Whatever was asked for if the show has it, else its first season: landing on an
    // empty page because an item carries a season TMDB has since renumbered helps nobody.
    const asked = Number(seasonNumber);
    const season = seasons.some((s: any) => s.number === asked) ? asked : (seasons[0]?.number ?? null);
    if (season === null) return { seasons, season: null, episodes: [] };

    const data = await fetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${tmdbApiKey}&language=${tmdbLang}`);
    return { seasons, season, episodes: toEpisodes(data) };
  }
}
