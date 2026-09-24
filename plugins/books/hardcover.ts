import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BOOK_GENRES_WHITELIST: string[] = [
  'Fiction', 'Non-Fiction', 'Fantasy', 'Sci-Fi', 'Science Fiction', 'Mystery',
  'Thriller', 'Horror', 'Historical', 'Romance', 'Comedy', 'Young Adult',
  'Children', 'Biography', 'Autobiography', 'Memoir', 'Poetry', 'Essay',
  'Self Help', 'Yuri', 'Slice of life', 'Adventure', 'Action', 'Drama', 'Crime',
  'LGBTQ', 'LGBTQIA', 'LGBTQIA+'
];

// What each edition row carries, shared by the confirm page and the refresh so both read
// the same print of a book the same way.
const EDITION_FIELDS = `
  id
  isbn_13
  isbn_10
  publisher { name }
  language { language }
  pages
  release_date
  edition_format
  physical_format
  image { url }
`;

/** An ISBN-10 or ISBN-13 without separators, or '' when the value is not one. */
export function normalizeIsbn(raw: unknown): string {
  const clean = String(raw ?? '').replace(/[- ]/g, '').toUpperCase();
  return /^(\d{13}|\d{9}[\dX])$/.test(clean) ? clean : '';
}

/**
 * The GraphQL pieces that fetch a book's editions: the most read ones, plus, given an
 * ISBN, the edition carrying it under `picked`. That edition is often absent from the
 * most read ones (a French pocket edition of an English novel), and it is the one the
 * person holds in hand.
 */
export function editionsQuery(isbn: string): { variables: string; selection: string } {
  const most = `editions(limit: 20, order_by: { users_count: desc }) { ${EDITION_FIELDS} }`;
  if (!isbn) return { variables: '', selection: most };
  return {
    variables: ', $isbn: String!',
    selection: `${most}
      picked: editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }, limit: 1) { ${EDITION_FIELDS} }`
  };
}

/**
 * Moves the `picked` edition to the front of the book's editions, where
 * formatHardcoverBook() and the edition picker take their default from. Returns whether
 * an edition matched the ISBN at all.
 */
export function preferPickedEdition(book: any): boolean {
  const picked = Array.isArray(book?.picked) ? book.picked[0] : null;
  if (!picked) return false;
  const others = (book.editions || []).filter((e: any) => e?.id !== picked.id);
  book.editions = [picked, ...others];
  return true;
}

export class HardcoverProvider implements SearchProvider {
  name = 'Hardcover';

  private formatHardcoverBook(book: any): any {
    if (!book || !book.id) return null;

    let authors = 'Unknown';
    if (book.author_names?.length > 0) {
      authors = book.author_names.join(', ');
    } else if (book.cached_contributors) {
      let contributors = book.cached_contributors;
      if (typeof contributors === 'string') {
        try { contributors = JSON.parse(contributors); } catch (e) { contributors = null; }
      }
      if (Array.isArray(contributors)) {
        const names = contributors.map(c => c?.author?.name || c?.name).filter(Boolean);
        if (names.length > 0) authors = names.join(', ');
      } else if (contributors && typeof contributors === 'object') {
        const names = Object.values(contributors).filter(Boolean);
        if (names.length > 0) authors = names.join(', ');
      }
    }

    let cover = '/ressources/no_book.png';
    if (book.image) {
      cover = typeof book.image === 'string' ? book.image : (book.image.url || cover);
    }

    const bestEdition = book.editions?.[0];

    let parsedTags: string[] = [];
    if (Array.isArray(book.taggings)) {
      parsedTags = book.taggings.map((bt: any) => bt.tag?.tag).filter(Boolean);
    } else if (Array.isArray(book.cached_tags)) {
      parsedTags = book.cached_tags;
    } else if (typeof book.cached_tags === 'string') {
      try { parsedTags = JSON.parse(book.cached_tags); }
      catch (e) { parsedTags = book.cached_tags.split(',').map((s: string) => s.trim()); }
    } else if (Array.isArray(book.tags)) {
      parsedTags = book.tags.map((t: any) => t.tag?.name || t.name).filter(Boolean);
    }

    const whitelistLower = BOOK_GENRES_WHITELIST.map((g: string) => g.toLowerCase());
    const filteredGenres = parsedTags
      .filter(Boolean)
      .filter((tag: any) => whitelistLower.includes(tag.toLowerCase()))
      .map((tag: any) => {
        const index = whitelistLower.indexOf(tag.toLowerCase());
        return BOOK_GENRES_WHITELIST[index];
      });

    return {
      id: String(book.id),
      hardcover_id: book.id,
      hardcover_slug: book.slug || '',
      title: book.title || 'Untitled',
      creator: authors,
      author: authors,
      publisher: bestEdition?.publisher?.name || '',
      // The edition's own print year where it's known (getDetails() fetches it), so the
      // year shown here matches the edition the other fields (publisher, ISBN, pages)
      // already came from, instead of the original work's first-ever publication year.
      year: (bestEdition?.release_date || '').slice(0, 4) || String(book.release_year || ''),
      isbn: bestEdition?.isbn_13 || bestEdition?.isbn_10 || '',
      barcode: bestEdition?.isbn_13 || bestEdition?.isbn_10 || '',
      pages: bestEdition?.pages || book.pages || 0,
      language: bestEdition?.language?.language || '',
      cover_image: cover,
      description: book.description || '',
      genres: [...new Set(filteredGenres)] as string[]
    };
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.HARDCOVER_API_KEY || '';
    const cleanQuery = query.replace(/[- ]/g, '');
    // An ISBN-10 may end in an X check digit, which normalizeIsbn accepts and uppercases
    const isIsbn = normalizeIsbn(cleanQuery) !== '';

    let graphqlQuery = '';
    let variables: any = {};

    if (isIsbn) {
      graphqlQuery = `
        query SearchByIsbn($isbn: String!) {
          editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn } }] }, limit: 5) {
            book {
              id
              title
              cached_contributors
              release_year
              pages
              image { url }
            }
          }
        }
      `;
      variables = { isbn: normalizeIsbn(cleanQuery) };
    } else {
      graphqlQuery = `
        query SearchByTitle($searchTerm: String!) {
          search(query: $searchTerm, query_type: "Book", per_page: 24) {
            results
          }
        }
      `;
      variables = { searchTerm: query };
    }

    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    const dataRes = await fetchJson('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables })
    });

    if (dataRes.errors) {
      console.error("[ERR] Hardcover Search GraphQL Errors:", dataRes.errors);
      throw new Error(dataRes.errors[0]?.message || "GraphQL Search Error");
    }

    const data = dataRes.data;
    let rawResults: any[] = [];

    if (isIsbn) {
      const books = data?.editions?.map((e: any) => e.book).filter(Boolean) || [];
      rawResults = Array.from(new Map(books.map((b: any) => [b.id, b])).values());
    } else {
      const hits = data?.search?.results?.hits || [];
      rawResults = hits
        .map((hit: any) => hit?.document)
        .filter((doc: any) => doc && doc.id);
    }

    const results = rawResults.map(b => this.formatHardcoverBook(b)).filter(Boolean);
    // Searching an ISBN names one edition, not just the book: carried to the confirm
    // page so getDetails() preselects that edition instead of the most read one.
    const isbn = isIsbn ? normalizeIsbn(cleanQuery) : '';
    if (isbn) results.forEach(r => { r.confirmQuery = { isbn }; });
    return results;
  }

  // A book's own editions, formatted for the confirm page's edition picker: what
  // differs between prints of the "same" book (publisher, format, page count, ISBN),
  // in the order Hardcover considers most likely to be the one someone owns. Index 0
  // is also what formatHardcoverBook() falls back to when nobody picks one.
  private formatEditionOptions(editions: any[]): any[] {
    return (editions || []).map((e: any) => ({
      id: e.id,
      isbn: e.isbn_13 || e.isbn_10 || '',
      publisher: e.publisher?.name || '',
      language: e.language?.language || '',
      pages: e.pages || null,
      year: (e.release_date || '').slice(0, 4) || '',
      physical_format: e.physical_format || '',
      edition_format: e.edition_format || '',
      // Not every edition has its own cover on Hardcover; left empty rather than falling
      // back to the book's, so the picker knows not to touch the gallery when there's
      // nothing edition-specific to show.
      cover_image: e.image?.url || ''
    })).filter((e: any) => e.id);
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const apiKey = process.env.HARDCOVER_API_KEY || '';
    const isbn = normalizeIsbn(options?.isbn);
    const editions = editionsQuery(isbn);

    const graphqlQuery = `
      query GetBook($id: Int!${editions.variables}) {
        books_by_pk(id: $id) {
          id
          slug
          title
          description
          cached_contributors
          release_year
          pages
          image { url }
          taggings {
            tag { tag }
          }
          ${editions.selection}
        }
      }
    `;

    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    const dataRes = await fetchJson('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: isbn ? { id: parseInt(id), isbn } : { id: parseInt(id) } })
    });

    if (dataRes.errors) {
      console.error("[ERR] Hardcover Detail GraphQL Errors:", dataRes.errors);
      throw new Error(dataRes.errors[0]?.message || "GraphQL Detail Error");
    }

    if (!dataRes?.data?.books_by_pk) {
      throw new Error("Book not found on Hardcover");
    }

    const book = dataRes.data.books_by_pk;
    const matchedIsbn = preferPickedEdition(book);
    const formatted = this.formatHardcoverBook(book);
    if (!formatted) {
      throw new Error("Formatting failed");
    }
    // The edition searched by its ISBN shows its own cover when it has one: it is the
    // print being added, not the work in general.
    if (matchedIsbn && book.editions[0]?.image?.url) {
      formatted.cover_image = book.editions[0].image.url;
    }

    // Offered on the confirm page only when there is an actual choice to make; a
    // single-edition book (or one Hardcover has no edition rows for at all) picks
    // nothing different by showing a picker with one option in it.
    const editionOptions = this.formatEditionOptions(book.editions);
    if (editionOptions.length > 1) {
      formatted.editions = editionOptions;
    }

    return formatted;
  }
}
