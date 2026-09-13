import { XMLParser } from 'fast-xml-parser';
import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchText } from '../../core/helpers';
import { BGG_BASE, bggHeaders } from './constants';

// Elements that can legitimately repeat (designer + publisher + category + mechanic
// links, several search hits, several name variants) must stay arrays even when a
// given response happens to carry only one, or a singleton response silently swaps
// from array to bare object under our feet.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => ['item', 'name', 'link', 'rank'].includes(name)
});

async function bggRequest(path: string): Promise<any> {
  const xml = await fetchText(`${BGG_BASE}${path}`, { headers: bggHeaders() });
  return parser.parse(xml);
}

// BGG descriptions are HTML-escaped text embedded in XML, so they arrive double-encoded
// (e.g. the XML holds "&amp;mdash;"). fast-xml-parser only unescapes the 5 named XML
// entities, which turns that into the literal string "&mdash;" - a real HTML entity that
// still needs decoding, same as the numeric character refs BGG uses for line breaks (&#10;).
const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"
};

function decodeNumericEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-z]+);/g, (m, name) => HTML_ENTITIES[name] ?? m);
}


function primaryName(names: any): string {
  const arr = Array.isArray(names) ? names : names ? [names] : [];
  const primary = arr.find((n: any) => n.type === 'primary') || arr[0];
  return primary ? String(primary.value) : '';
}

function firstLink(links: any, type: string): string {
  const arr = Array.isArray(links) ? links : links ? [links] : [];
  const match = arr.find((l: any) => l.type === type);
  return match ? String(match.value) : '';
}

function formatPlayers(minplayers: any, maxplayers: any): string {
  const min = minplayers ? Number(minplayers.value) : 0;
  const max = maxplayers ? Number(maxplayers.value) : 0;
  if (!min && !max) return '';
  if (min === max || !max) return String(min || max);
  return `${min}-${max}`;
}

function formatPlaytime(minplaytime: any, maxplaytime: any, playingtime: any): string {
  const max = maxplaytime ? Number(maxplaytime.value) : 0;
  if (max > 0) return String(max);
  return playingtime ? String(playingtime.value) : '';
}

function mapThing(it: any): ConfirmData & { bgg_id: string } {
  const title = primaryName(it.name);
  const designer = firstLink(it.link, 'boardgamedesigner');
  const publisher = firstLink(it.link, 'boardgamepublisher');
  const ratingRaw = it.statistics?.ratings?.average?.value;

  return {
    id: String(it.id),
    bgg_id: String(it.id),
    title,
    creator: designer || publisher,
    designer,
    publisher,
    year: it.yearpublished ? String(it.yearpublished.value) : '',
    players: formatPlayers(it.minplayers, it.maxplayers),
    playtime: formatPlaytime(it.minplaytime, it.maxplaytime, it.playingtime),
    min_age: it.minage ? Number(it.minage.value) : 0,
    cover_image: it.image || it.thumbnail || '',
    description: typeof it.description === 'string' ? decodeNumericEntities(it.description) : '',
    bgg_rating: ratingRaw ? Math.round(Number(ratingRaw) * 10) / 10 : 0,
    quantity: 1
  };
}

export class BggProvider implements SearchProvider {
  name = 'BoardGameGeek';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const searchData = await bggRequest(`/search?query=${encodeURIComponent(query)}&type=boardgame,boardgameexpansion`);
    const hits: any[] = searchData?.items?.item || [];
    const ids = hits.slice(0, 20).map((it: any) => String(it.id));
    if (ids.length === 0) return [];

    // /search omits images/designer/publisher; batch a single /thing call for the
    // shortlist instead of one round trip per hit.
    const thingData = await bggRequest(`/thing?id=${ids.join(',')}`);
    const things: any[] = thingData?.items?.item || [];

    return things.map((it: any) => mapThing(it) as unknown as SearchResult);
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const data = await bggRequest(`/thing?id=${encodeURIComponent(id)}&stats=1`);
    const it = (data?.items?.item || [])[0];
    if (!it) throw new Error('Board game not found on BoardGameGeek');
    return mapThing(it);
  }

  async searchImages(query: string): Promise<string[]> {
    const results = await this.search(query, {});
    return results.map(r => r.cover_image).filter((u): u is string => !!u);
  }
}
