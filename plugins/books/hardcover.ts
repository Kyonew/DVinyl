import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

const BOOK_GENRES_WHITELIST: string[] = [
  'Fiction', 'Non-Fiction', 'Fantasy', 'Sci-Fi', 'Science Fiction', 'Mystery',
  'Thriller', 'Horror', 'Historical', 'Romance', 'Comedy', 'Young Adult',
  'Children', 'Biography', 'Autobiography', 'Memoir', 'Poetry', 'Essay',
  'Self Help', 'Yuri', 'Slice of life', 'Adventure', 'Action', 'Drama', 'Crime',
  'LGBTQ', 'LGBTQIA', 'LGBTQIA+'
];

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
      year: String(book.release_year || ''),
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
    const isIsbn = /^\d{10,13}$/.test(cleanQuery);

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
      variables = { isbn: cleanQuery };
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

    return rawResults.map(b => this.formatHardcoverBook(b)).filter(Boolean);
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    const apiKey = process.env.HARDCOVER_API_KEY || '';

    const graphqlQuery = `
      query GetBook($id: Int!) {
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
          editions(limit: 5, order_by: { users_count: desc }) {
            isbn_13
            isbn_10
            publisher { name }
            language { language }
            pages
            reading_format_id
          }
        }
      }
    `;

    const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    const dataRes = await fetchJson('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables: { id: parseInt(id) } })
    });

    if (dataRes.errors) {
      console.error("[ERR] Hardcover Detail GraphQL Errors:", dataRes.errors);
      throw new Error(dataRes.errors[0]?.message || "GraphQL Detail Error");
    }

    if (!dataRes?.data?.books_by_pk) {
      throw new Error("Book not found on Hardcover");
    }

    const formatted = this.formatHardcoverBook(dataRes.data.books_by_pk);
    if (!formatted) {
      throw new Error("Formatting failed");
    }

    return formatted;
  }
}
