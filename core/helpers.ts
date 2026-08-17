import { BASE_URL } from '../config/constants';

/**
 * Fetches JSON data from a URL.
 */
export async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
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
 */
export function safeReturnPath(candidate: any, host?: string): string {
  const raw = typeof candidate === 'string' ? candidate.trim() : '';
  if (!raw) return '';

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
