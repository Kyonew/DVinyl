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

/**
 * Resolves a scanned barcode (EAN-13 / UPC-12) to a product title via UPCitemdb.
 * Returns the cleaned barcode and the title to use as search query (null if not found).
 */
export async function lookupBarcodeTitle(rawQuery: string, noiseTerms: string[] = []): Promise<{ barcode: string; title: string | null }> {
  const barcode = rawQuery.replace(/[- ]/g, '');
  try {
    const upcData = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
    if (upcData.items && upcData.items.length > 0) {
      let title: string = upcData.items[0].title;
      // Strip plugin-declared noise terms (e.g. 'DVD', 'Blu-ray', 'PS5') to sharpen the search query.
      if (noiseTerms.length > 0) {
        const pattern = new RegExp(noiseTerms.map(escapeRegExp).join('|'), 'gi');
        title = title.replace(pattern, '');
      }
      title = title.trim();
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
