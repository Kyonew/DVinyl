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
