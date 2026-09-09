import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { igdbRequest } from './igdbHelper';

export class IGDBProvider implements SearchProvider {
  name = 'IGDB';

  private formatIGDBResult(game: any): any {
    if (!game || !game.id) return null;

    let cover = '/ressources/logo.png';
    if (game.cover && game.cover.url) {
      cover = game.cover.url.replace('t_thumb', 't_cover_big');
      if (cover.startsWith('//')) cover = 'https:' + cover;
    }

    const platforms = game.platforms || [];
    const platforms_text = platforms.map((p: any) => p.name).join(', ');

    let year = '';
    if (game.first_release_date) {
      year = new Date(game.first_release_date * 1000).getFullYear().toString();
    }

    let developer = '';
    let publisher = '';
    if (game.involved_companies) {
      const devCompany = game.involved_companies.find((ic: any) => ic.developer);
      const pubCompany = game.involved_companies.find((ic: any) => ic.publisher);
      if (devCompany && devCompany.company) developer = devCompany.company.name;
      if (pubCompany && pubCompany.company) publisher = pubCompany.company.name;
    }

    return {
      id: String(game.id),
      igdb_id: game.id,
      title: game.name || 'Untitled',
      creator: developer || publisher || 'Unknown',
      developer,
      publisher,
      year,
      platforms,
      platforms_text,
      cover_image: cover,
      // `description` is the standard field the core persists/displays (confirm sidebar + detail block)
      description: game.summary || '',
      genres: game.genres ? game.genres.map((g: any) => g.name) : []
    };
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const results = await igdbRequest('games',
      `search "${query.replace(/"/g, '\\"')}";
      fields name, cover.url, platforms.name, first_release_date, 
             involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
             genres.name, summary;
      limit 24;`
    );

    return results.map((g: any) => this.formatIGDBResult(g)).filter(Boolean);
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const results = await igdbRequest('games',
      `where id = ${id};
      fields name, cover.url, platforms.name, platforms.id, first_release_date,
             involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
             genres.name, summary;
      limit 1;`
    );

    if (!results || results.length === 0) {
      throw new Error("Game not found on IGDB");
    }

    const formatted = this.formatIGDBResult(results[0]);
    if (!formatted) {
      throw new Error("Formatting failed");
    }

    Object.assign(formatted, await this.getCompletionTimes(id));

    return formatted;
  }

  // IGDB's own completion-time estimates (the same "hastily/normally/completely" data
  // HowLongToBeat shows), pulled from its own endpoint rather than an unofficial scraper.
  // A separate call keyed by game_id, not a field on `games`; absent for games nobody has
  // timed yet, so a missing key stays undefined instead of a fabricated 0. Best-effort: a
  // failure here shouldn't break search/confirm/refresh over supplementary data.
  private async getCompletionTimes(id: string): Promise<Record<string, number | undefined>> {
    try {
      const results = await igdbRequest('game_time_to_beats',
        `where game_id = ${id}; fields hastily, normally, completely; limit 1;`
      );
      const row = results && results[0];
      if (!row) return {};

      const toHours = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;
      return {
        completionHastily: typeof row.hastily === 'number' ? toHours(row.hastily) : undefined,
        completionNormally: typeof row.normally === 'number' ? toHours(row.normally) : undefined,
        completionCompletely: typeof row.completely === 'number' ? toHours(row.completely) : undefined
      };
    } catch (err: any) {
      console.error('[ERR] IGDB time-to-beat:', err.message);
      return {};
    }
  }
}
