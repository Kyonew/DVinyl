import { fetchJson } from '../../core/helpers';

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
