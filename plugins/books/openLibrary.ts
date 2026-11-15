import { fetchJson } from '../../core/helpers';
import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { BOOK_GENRES_WHITELIST, normalizeIsbn } from './hardcover';

export interface OpenLibraryEdition {
  /** First publisher of the edition, '' when Open Library has none. */
  publisher: string;
  /** MARC language code of the edition ('eng', 'fre'...), '' when Open Library has none. */
  languageCode: string;
}

/**
 * Publisher and language of one edition, read from the Open Library Editions API
 * (https://openlibrary.org/dev/docs/api/books). The edition record is the one that carries
 * `languages`: the legacy Books API (/api/books?jscmd=data) never returns a language.
 * Resolves to null when Open Library has no edition for this ISBN.
 */
export async function fetchOpenLibraryEdition(isbn: string, signal: AbortSignal): Promise<OpenLibraryEdition | null> {
  let edition: any;
  try {
    // Open Library answers with a redirect to the edition (/books/OL...M.json), which fetch follows.
    edition = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`, { signal });
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }

  const rawPublisher = edition?.publishers?.[0];
  const publisher = typeof rawPublisher === 'string'
    ? rawPublisher.trim()
    : (typeof rawPublisher?.name === 'string' ? rawPublisher.name.trim() : '');
  const languageCode = String(edition?.languages?.[0]?.key || edition?.languages?.[0] || '').split('/').pop() || '';
  return { publisher, languageCode };
}

// Open Library asks the programs calling it to say who they are.
const HEADERS = { 'User-Agent': 'DVinyl (https://github.com/Kyonew/DVinyl)' };
const TIMEOUT_MS = 10_000;
const COVER = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
// The ids Open Library hands out: an edition (one print), a work (the book), an author.
const EDITION_KEY = /^OL\d+M$/;
const keyOf = (value: unknown) => String(value || '').split('/').pop() || '';

// MARC 21 language codes, the ones Open Library records, to the two letters everything else uses.
const MARC_LANGUAGES: Record<string, string> = {
  eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt',
  dut: 'nl', nld: 'nl', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', rus: 'ru', pol: 'pl',
  swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', cze: 'cs', ces: 'cs', gre: 'el', ell: 'el',
  tur: 'tr', ara: 'ar', heb: 'he', hun: 'hu', rum: 'ro', ron: 'ro', ukr: 'uk', cat: 'ca'
};

/** A MARC language code as two letters ('fre' gives 'fr'), the code itself when unknown. */
export const languageFromMarc = (code: string): string => MARC_LANGUAGES[code] || code;

/** The language's English name, which is how Hardcover words the same field ('fre' gives 'French'). */
function languageName(marc: string): string {
  const code = languageFromMarc(marc);
  try {
    return (code.length === 2 && new Intl.DisplayNames(['en'], { type: 'language' }).of(code)) || '';
  } catch {
    return '';
  }
}

const get = (path: string) => fetchJson(`https://openlibrary.org${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });

/** "Harry Potter, #1" as a series and a volume number. */
export function parseSeries(raw: unknown): { series: string; volume: number | null } {
  const text = String(raw || '').trim();
  const match = text.match(/^(.*?)[\s,;]*(?:#|vol\.?\s*|volume\s*|tome\s*)(\d+)\s*$/i);
  return match ? { series: match[1]!.trim(), volume: parseInt(match[2]!, 10) } : { series: text, volume: null };
}

async function authorNames(keys: string[]): Promise<string> {
  const names = await Promise.all(keys.slice(0, 3).map(async key => {
    try {
      return String((await get(`/authors/${key}.json`))?.name || '').trim();
    } catch {
      return '';
    }
  }));
  return names.filter(Boolean).join(', ');
}

/**
 * Open Library as a source of its own, so a book Hardcover does not know can still be added:
 * Hardcover misses many editions printed outside the US. Needs no key.
 *
 * What gets added is an edition, the print someone holds, so results are identified by their
 * edition key. The edition carries the print (publisher, pages, ISBN, language); the work it
 * belongs to carries the rest (synopsis, subjects, often the authors).
 */
export class OpenLibraryProvider implements SearchProvider {
  name = 'Open Library';

  async search(query: string, _options: SearchOptions): Promise<SearchResult[]> {
    const isbn = normalizeIsbn(query);
    if (isbn) {
      try {
        const details = await this.getDetails(keyOf((await get(`/isbn/${isbn}.json`))?.key), {});
        return [{ ...details, id: details.source_id, confirmQuery: { isbn } } as any];
      } catch (err: any) {
        if (err.status === 404) return [];
        throw err;
      }
    }

    const fields = 'title,author_name,first_publish_year,cover_i,cover_edition_key,edition_key';
    const data = await get(`/search.json?q=${encodeURIComponent(query)}&fields=${fields}&limit=24`);
    return (data?.docs || []).flatMap((doc: any) => {
      const id = [doc.cover_edition_key, ...(doc.edition_key || [])].find((key: any) => EDITION_KEY.test(String(key)));
      if (!id) return [];
      const author = (doc.author_names || doc.author_name || []).join(', ');
      return [{
        id,
        title: doc.title || 'Untitled',
        creator: author,
        author,
        year: doc.first_publish_year ? String(doc.first_publish_year) : '',
        cover_image: doc.cover_i ? COVER(doc.cover_i) : '/ressources/no_book.png'
      }];
    });
  }

  async getDetails(id: string, _options: any): Promise<ConfirmData> {
    if (!EDITION_KEY.test(id)) throw new Error('Invalid Open Library edition id');
    const edition = await get(`/books/${id}.json`);
    const workKey = keyOf(edition?.works?.[0]?.key);
    const work = workKey ? await get(`/works/${workKey}.json`).catch(() => null) : null;

    const authorKeys = (Array.isArray(edition?.authors) && edition.authors.length > 0
      ? edition.authors.map((a: any) => keyOf(a?.key))
      : (work?.authors || []).map((a: any) => keyOf(a?.author?.key))).filter(Boolean);
    const author = (await authorNames(authorKeys)) || 'Unknown';

    const description = typeof work?.description === 'string' ? work.description : (work?.description?.value || '');
    const cover = [...(edition?.covers || []), ...(work?.covers || [])].find((c: any) => Number.isInteger(c) && c > 0);
    const isbn = String(edition?.isbn_13?.[0] || edition?.isbn_10?.[0] || '');
    const rawPublisher = edition?.publishers?.[0];
    const { series, volume } = parseSeries(edition?.series?.[0]);
    const subjects: string[] = (work?.subjects || []).map((s: any) => String(s).toLowerCase());
    const genres = BOOK_GENRES_WHITELIST.filter(g => subjects.includes(g.toLowerCase()));

    return {
      source_id: id,
      title: [edition?.title, edition?.subtitle].filter(Boolean).join(': ') || work?.title || 'Untitled',
      creator: author,
      author,
      publisher: typeof rawPublisher === 'string' ? rawPublisher.trim() : String(rawPublisher?.name || '').trim(),
      year: (String(edition?.publish_date || '').match(/\d{4}/) || [''])[0],
      isbn,
      barcode: isbn,
      pages: Number.isInteger(edition?.number_of_pages) ? edition.number_of_pages : 0,
      language: languageName(keyOf(edition?.languages?.[0]?.key)),
      ...(series ? { series } : {}),
      ...(volume ? { volume } : {}),
      cover_image: cover ? COVER(cover) : '/ressources/no_book.png',
      description: String(description).trim(),
      genres: [...new Set(genres)]
    };
  }
}
