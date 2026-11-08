import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { igdbRequest } from './igdbHelper';

/**
 * Consoles, from IGDB's platforms. Each model a platform lists (the original PlayStation 2,
 * the Slimline) is a result of its own, since that is the object on the shelf; a platform
 * with a single model is one result. IGDB knows no accessories, and the companies it ties
 * to a model come back unusable, so the manufacturer is left to the owner.
 */

const FIELDS = `fields name, slug, summary, platform_logo.url, platform_type.name,
  versions.name, versions.platform_logo.url, versions.platform_version_release_dates.y;`;

// IGDB names the first model of every platform this way, which says nothing to a reader.
const INITIAL_VERSION = /^initial version$/i;

function imageUrl(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  const sized = url.replace('t_thumb', 't_720p');
  return sized.startsWith('//') ? `https:${sized}` : sized;
}

/** One result per model, or one for the platform when it lists none. */
export function consolesFromPlatform(platform: any): any[] {
  if (!platform || !platform.id) return [];
  const versions: any[] = Array.isArray(platform.versions) && platform.versions.length > 0 ? platform.versions : [null];
  const named = versions.filter(v => v && !INITIAL_VERSION.test(String(v.name || '')));

  return versions.map(version => {
    const years = (version?.platform_version_release_dates || [])
      .map((d: any) => Number(d?.y))
      .filter((y: number) => Number.isInteger(y) && y > 1900);
    const modelName = version && !INITIAL_VERSION.test(String(version.name || '')) ? String(version.name).trim() : '';
    const title = modelName ? `${platform.name} (${modelName})` : platform.name;
    const cover = imageUrl(version?.platform_logo?.url) || imageUrl(platform.platform_logo?.url) || '/ressources/logo.png';
    return {
      // The model, when the platform has more than the first one, so it can be found again.
      id: version && named.length > 0 ? `${platform.id}-${version.id}` : String(platform.id),
      title,
      creator: '',
      year: years.length > 0 ? String(Math.min(...years)) : '',
      cover_image: cover,
      item_kind: 'console',
      platform: platform.name,
      platforms_text: platform.platform_type?.name || '',
      description: platform.summary || '',
      igdb_platform_slug: platform.slug || ''
    };
  });
}

export class IGDBPlatformsProvider implements SearchProvider {
  name = 'IGDB Consoles';

  async search(query: string, _options: SearchOptions): Promise<SearchResult[]> {
    const results = await igdbRequest('platforms', `search "${query.replace(/"/g, '\\"')}"; ${FIELDS} limit 12;`);
    return (results || []).flatMap((p: any) => consolesFromPlatform(p)).slice(0, 30);
  }

  async getDetails(id: string, _options: any): Promise<ConfirmData> {
    const match = /^(\d+)(?:-(\d+))?$/.exec(String(id));
    if (!match) throw new Error(`Invalid IGDB platform id: ${id}`);
    const [, platformId, versionId] = match;
    const results = await igdbRequest('platforms', `where id = ${platformId}; ${FIELDS} limit 1;`);
    const consoles = consolesFromPlatform(results && results[0]);
    const found = consoles.find(c => c.id === String(id)) || (versionId ? null : consoles[0]);
    if (!found) throw new Error('Console not found on IGDB');
    return found;
  }
}
