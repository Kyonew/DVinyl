/**
 * The language what a source returns is asked in: titles, synopses, genres.
 *
 * By default that is the language of whoever is adding or refreshing the item. A collection
 * may fix it instead, which suits members reading the interface in one language and wanting
 * their shelf in another (an English interface over Polish titles), and keeps a shared
 * collection from changing language with whoever refreshed it last.
 *
 * Wider than the interface languages on purpose: a source like TMDB knows far more of them
 * than DVinyl is translated into. A source that has no notion of language ignores it.
 */

export const METADATA_LANGUAGES = [
  'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'es-MX', 'fi', 'fr', 'fr-CA', 'he', 'hi',
  'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'nl', 'no', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk',
  'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW'
] as const;

export const isMetadataLanguage = (value: unknown): value is string =>
  typeof value === 'string' && (METADATA_LANGUAGES as readonly string[]).includes(value);

/** The language to ask sources in for this request: the collection's choice, else the reader's. */
export function metadataLanguage(req: any): string {
  const chosen = req?.res?.locals?.settings?.metadataLanguage;
  return isMetadataLanguage(chosen) ? chosen : (req?.language || 'en');
}

/** The language alone, without its region: 'pt-BR' gives 'pt'. */
export const baseLanguage = (code: string | undefined): string => String(code || '').split('-')[0]!.toLowerCase();

// Where a language's usual region is not the language code in capitals.
const USUAL_REGION: Record<string, string> = {
  en: 'US', ar: 'SA', ca: 'ES', cs: 'CZ', da: 'DK', el: 'GR', he: 'IL', hi: 'IN',
  ja: 'JP', ko: 'KR', sl: 'SI', sr: 'RS', sv: 'SE', uk: 'UA', vi: 'VN', zh: 'CN'
};

/** The language with a region, the form TMDB expects: 'fr' gives 'fr-FR', 'en' gives 'en-US'. */
export function withRegion(code: string | undefined): string {
  const value = String(code || '').trim();
  if (/^[a-z]{2}-[A-Z]{2}$/.test(value)) return value;
  const base = baseLanguage(value);
  if (!/^[a-z]{2}$/.test(base)) return 'en-US';
  return `${base}-${USUAL_REGION[base] || base.toUpperCase()}`;
}
