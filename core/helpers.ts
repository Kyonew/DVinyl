import { BASE_URL } from '../config/constants';

/**
 * Fetches JSON data from a URL.
 */
export async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, options);
  if (!response.ok) {
    // The status rides on the error so callers can tell "slow down" from "broken". The
    // message is left word for word: it is what shows up in the logs people paste into
    // bug reports, and it is matched elsewhere.
    const error: any = new Error(`HTTP error! status: ${response.status}`);
    error.status = response.status;
    // Providers that answer 429 usually say when to come back, in seconds.
    const retryAfter = parseInt(response.headers.get('retry-after') || '', 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }
  return response.json();
}

/**
 * Fetches text data from a URL.
 */
export async function fetchText(url: string, options?: RequestInit): Promise<string> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.text();
}

/**
 * Parses raw genres and styles inputs (can be string or array) into arrays of strings.
 */
export function parseGenresAndStyles(genres: any, styles: any): { genres: string[]; styles: string[] } {
  const parse = (input: any): string[] => {
    if (Array.isArray(input)) {
      return input.map((item: any) => String(item).trim()).filter(Boolean);
    }
    if (typeof input === 'string') {
      return input.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    return [];
  };
  
  return {
    genres: parse(genres),
    styles: parse(styles)
  };
}

// Paths that are not pages one can be sent back to: a JSON endpoint, and the two forms
// that lead here in the first place. Landing on the form you just submitted is the one
// destination nobody means, and everything else internal is fair game.
const NON_RETURNABLE = ['/api/', '/edit/', '/save-'];

/**
 * The page to return to once an item has been edited or deleted, or '' when there is
 * nothing worth trusting.
 *
 * Any page of this instance qualifies, since someone reaches an item from the dashboard,
 * a search, a show's season list or a collection alike, and all of them are somewhere they
 * would want to come back to.
 *
 * The candidate comes from a Referer header or from a query string, both of which the
 * caller controls. Following one unchecked would bounce a signed-in user onto another site
 * the moment they saved their work, so what is refused is what does not belong to this
 * instance. `//evil.example` looks like a path and is not one, hence the second test.
 *
 * What comes out of here is a value, and every caller escapes it for wherever it lands.
 * The angle brackets are refused all the same: a real path percent-encodes them, so
 * nothing legitimate carries one, and a path that cannot hold `</script>` cannot end a
 * script block whatever a future caller does with it. Quotes are left alone, since a
 * search term is entitled to an apostrophe and the escaping at each sink covers them.
 */
const UNSAFE_IN_PATH = /[<>\u0000-\u001f\u007f]/;

export function safeReturnPath(candidate: any, host?: string): string {
  const raw = typeof candidate === 'string' ? candidate.trim() : '';
  if (!raw || UNSAFE_IN_PATH.test(raw)) return '';

  let path: string;
  // A second slash, forward or back, makes this an address and not a path: browsers read
  // `/\evil.example` the way they read `//evil.example` and leave the site.
  if (raw.startsWith('/') && !/^\/[\\/]/.test(raw)) {
    path = raw;
  } else {
    // A Referer is a whole URL; it is kept only when it points back here.
    try {
      const url = new URL(raw);
      if (!host || url.host !== host) return '';
      path = url.pathname + url.search;
    } catch {
      return '';
    }
  }

  const route = BASE_URL && path.startsWith(BASE_URL) ? path.slice(BASE_URL.length) : path;
  return NON_RETURNABLE.some(p => route.includes(p)) ? '' : path;
}

/**
 * Builds the key a title is sorted on: lowercased, accent folded, and without a leading
 * article. "The Wall" files under W and "Ámbar" next to "Amber", the way a record shop
 * shelves them.
 *
 * Stored on the document rather than applied to the rendered results, because Mongo sorts
 * before it paginates: normalizing in JS would only reorder the 25 items of the current
 * page. English articles only for now.
 */
export function buildSortTitle(title: string | null | undefined): string {
  const base = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!base) return '';
  // A title made of nothing but an article keeps it, otherwise it would sort as empty.
  return base.replace(/^(?:a|an|the)\s+/, '') || base;
}

/**
 * The two ways an item changes once it exists, kept apart on purpose.
 *
 * What gets written decides which one applies, not who triggered it: a hand edit is
 * someone's decision and records their name, while a provider filling in a cover or a
 * genre is nobody's doing and records only the moment. Merged into one field, a nightly
 * refresh would erase the name of the last person who actually touched the item, which is
 * the only thing anyone wants to read there.
 *
 * Spread into the $set of the update that carries the change, so the stamp and what it
 * describes land in the same write.
 */
export function editStamp(userId: any): { modified_at: Date; modified_by: any } {
  return { modified_at: new Date(), modified_by: userId };
}

export function syncStamp(): { synced_at: Date } {
  return { synced_at: new Date() };
}

/**
 * Turns a UPC database entry into something a title search can match.
 *
 * What comes back is a retail listing, not the name of a work: "Nightlife [blu-ray] By
 * Verhoeven, Simon | Dvd | Condition". Handed over as-is it matches nothing, since TMDB
 * and IGDB index titles. Same cleanup the Libib CSV importer already does on shop titles.
 */
export function cleanProductTitle(rawTitle: string, noiseTerms: string[] = []): string {
  let title = String(rawTitle || '');

  // Listings pile their qualifiers after a pipe; the work is in the first segment.
  title = title.split('|')[0] || title;
  // Bracketed groups hold the edition or the seller's condition, never the title.
  title = title.replace(/[\[(][^\])]*[\])]/g, ' ');
  // Amazon-style attribution: "<title> By Verhoeven, Simon".
  title = title.replace(/\s+By\s+.+$/i, ' ');
  // Sellers quote the product name inside a longer listing. The quotes carry no meaning
  // for a provider, and some of them read them as a phrase operator.
  title = title.replace(/["\u201c\u201d\u00ab\u00bb]/g, ' ');

  // Word boundaries matter: an unanchored 'One' eats the middle of "Gone Home".
  if (noiseTerms.length > 0) {
    const pattern = new RegExp(`\\b(?:${noiseTerms.map(escapeRegExp).join('|')})\\b`, 'gi');
    title = title.replace(pattern, ' ');
  }

  // Whatever the removals left behind: doubled spaces, and the separator that used to
  // introduce the part just deleted ("Breath of the Wild -").
  return title.replace(/\s{2,}/g, ' ').replace(/[\s\-:,;./]+$/, '').trim();
}

/**
 * Resolves a scanned barcode (EAN-13 / UPC-12) to a product title via UPCitemdb.
 * Returns the cleaned barcode and the title to use as search query (null if not found).
 *
 * Note the endpoint is the free trial one, capped at 100 lookups a day per IP: a null
 * title means "not resolved", which covers an unknown barcode and an exhausted quota
 * alike. Callers must not fall back to searching the digits, which never matches.
 */
export async function lookupBarcodeTitle(rawQuery: string, noiseTerms: string[] = []): Promise<{ barcode: string; title: string | null }> {
  const barcode = rawQuery.replace(/[- ]/g, '');
  try {
    const upcData = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
    if (upcData.items && upcData.items.length > 0) {
      const title = cleanProductTitle(upcData.items[0].title, noiseTerms);
      return { barcode, title: title || null };
    }
  } catch (upcErr: any) {
    console.error('[ERR] UPC Lookup:', upcErr.message);
  }
  return { barcode, title: null };
}

/** Attempts before giving up, the untouched title included. */
const TITLE_FALLBACK_ATTEMPTS = 6;
/** Under that, what is left matches anything and the results are noise. */
const TITLE_FALLBACK_MIN_WORDS = 3;

/**
 * Runs a search on a resolved product title, dropping trailing words until something
 * comes back. Seller titles carry a marketing tail the noise list cannot enumerate
 * ("... Disney N 17 Blister Pack"), and providers match on the title alone, so the full
 * string finds nothing while its first words find the work.
 *
 * Only for a title that came from a barcode lookup: silently truncating what a user
 * typed themselves would answer a question they did not ask.
 *
 * Returns the query that produced the results, so the page can show what was actually
 * searched instead of the string nobody matched.
 */
export async function searchWithTitleFallback<T>(
  title: string,
  search: (query: string) => Promise<T[]>
): Promise<{ results: T[]; query: string }> {
  const words = title.split(/\s+/).filter(Boolean);

  let query = title;
  let results = await search(query);

  for (let dropped = 1; dropped < TITLE_FALLBACK_ATTEMPTS && results.length === 0; dropped++) {
    const kept = words.length - dropped;
    if (kept < TITLE_FALLBACK_MIN_WORDS) break;
    query = words.slice(0, kept).join(' ');
    results = await search(query);
  }

  return { results, query };
}

/** Lowercased, punctuation collapsed to single spaces, so "Mulan Reflecting" and
 * "Mulan - Reflecting" compare equal regardless of the separator either side used. */
export function normalizeCardName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Runs a card search as typed; if that finds nothing, retries on just the query's first
 * word and narrows that wider set with a punctuation-insensitive contains check instead
 * of trusting the provider's own literal one.
 *
 * Several trading-card APIs store a multi-part name with an internal separator the card
 * itself doesn't show on the box (Lorcana's "Mulan - Reflecting", SWU's "Boba Fett -
 * Special Ops") — typing the name as printed, without that punctuation, is not a literal
 * substring of the stored field, so a provider whose own search only does exact
 * containment (not every one does — Scryfall and YGOPRODeck already tokenize) finds
 * nothing. This recovers that case without a fuzzy-search dependency, at the cost of one
 * extra request, and only when the first attempt already came back empty.
 */
export async function fuzzyCardSearch<T>(
  query: string,
  fetchByQuery: (q: string) => Promise<T[]>,
  getName: (row: T) => string
): Promise<T[]> {
  const rows = await fetchByQuery(query);
  if (rows.length > 0) return rows;

  const words = query.trim().split(/\s+/).filter(Boolean);
  const firstWord = words[0];
  if (words.length < 2 || !firstWord) return rows;

  const broad = await fetchByQuery(firstWord);
  const needle = normalizeCardName(query);
  return broad.filter(row => normalizeCardName(getName(row)).includes(needle));
}

/**
 * Returns true when a search query looks like a scanned product barcode.
 */
export function isBarcodeQuery(query: string): boolean {
  return /^\d{12,13}$/.test(query.replace(/[- ]/g, ''));
}

/**
 * Escapes special characters for use in regular expressions.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Separators a CSV export in the wild may use, in detection order. */
export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;

export type CsvDelimiter = typeof CSV_DELIMITERS[number];

/**
 * Guesses the separator of a CSV text from its header line: the one splitting it into
 * the most columns wins. Comma stays the tie-breaker, so a single-column file (no
 * separator at all) keeps the historical behavior.
 *
 * Quoted headers may legitimately contain any of the candidates ("Author, first name"),
 * hence counting outside quotes only.
 */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  let best: CsvDelimiter = ',';
  let bestCount = 0;

  for (const delimiter of CSV_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (c === '\n' || c === '\r')) break;
      else if (!inQuotes && c === delimiter) count++;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Parses RFC-4180-ish CSV text into a matrix (quoted fields, doubled quotes, embedded
 * newlines and CRLF handled). Shared by every CSV importer: exports from Libib,
 * Musik-Sammler & co. all ship multi-line quoted descriptions.
 */
export function parseCsv(text: string, delimiter: string = ','): string[][] {
  const lines: string[][] = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] = (row[row.length - 1] ?? '') + '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] = (row[row.length - 1] ?? '') + c;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  return lines;
}

/**
 * Parses CSV text into header-keyed records (BOM stripped, headers trimmed, values
 * trimmed). Rows shorter than the header keep the missing columns as empty strings,
 * so callers can read any column without index juggling.
 */
export function parseCsvRecords(text: string, delimiter: string = ','): Record<string, string>[] {
  const rows = parseCsv(text, delimiter);
  const headerRow = rows[0];
  if (!headerRow) return [];

  const headers = headerRow.map(h => h.replace(/^\uFEFF/, '').trim());

  const records: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    // Trailing newline of the file: a single empty cell is not a record.
    if (row.length === 1 && !row[0]) continue;

    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header) record[header] = (row[i] ?? '').trim();
    });
    records.push(record);
  }
  return records;
}

/**
 * Serializes a matrix of cells into RFC-4180 CSV text (CRLF rows, quoting only where a
 * cell actually needs it). The counterpart to parseCsv(), for the spreadsheet export.
 *
 * A cell opening with =, +, -, @, tab or CR is neutralized with a leading apostrophe:
 * spreadsheet apps read such a cell as a formula, and an item title or comment is a
 * value the user typed, not something they meant Excel to execute.
 */
export function stringifyCsv(rows: string[][]): string {
  const FORMULA_PREFIX = /^[=+\-@\t\r]/;
  const escapeCell = (cell: string): string => {
    let value = cell ?? '';
    if (FORMULA_PREFIX.test(value)) value = "'" + value;
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return rows.map(row => row.map(escapeCell).join(',')).join('\r\n');
}

/**
 * Thrown by a plugin's refreshItem when no amount of waiting can make the call succeed:
 * the item carries no external id, or the API key is not configured. The bulk refresh
 * skips its retries for these, since the next attempt would fail for the same reason.
 */
export class PermanentRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentRefreshError';
  }
}
