import path from 'path';

export const BASE_URL: string = process.env.BASE_URL
  ? (process.env.BASE_URL.startsWith('/') ? process.env.BASE_URL : `/${process.env.BASE_URL}`)
  : ''

/**
 * The shortest password a local account accepts. Checked by the record rules, and by
 * every route that hashes a chosen password before storing it, since a hash says nothing
 * about the length of what it was made from.
 */
export const MIN_PASSWORD_LENGTH = 6;

export const SQLITE_PATH: string = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'dvinyl.sqlite');

/**
 * Languages the app ships. Also the values the User schema accepts, so anything
 * stored on a user has to be one of these exact codes.
 */
export const SUPPORTED_LANGUAGES = ['fr', 'en', 'de', 'es', 'it', 'ru', 'pl'] as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/**
 * What a browser asking only for languages the app does not ship (Dutch, Polish...) gets,
 * and the fallback of a missing key. English, the one most visitors can read whatever
 * their own language.
 */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/**
 * Each language under its own name, the way someone looking for theirs recognises it.
 */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  // The language's own name, as it appears on a Russian interface: `Русский`, not `Russian`.
  ru: 'Русский',
  pl: 'Polski'
};

/**
 * Currencies a user can pick for prices, which the User schema also accepts. Each one is
 * labelled by currencyLabel, in the reader's language.
 */
// The currencies Discogs prices records in (its curr_abbr), so a music estimate always
// comes back in the one picked. The card sources only answer in US dollars or euros: an
// amount in any other currency is left out of a total rather than converted or mislabeled.
// Not the ruble, which Discogs refuses.
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'AUD', 'BRL', 'CAD', 'CHF', 'JPY', 'MXN', 'NZD', 'SEK', 'ZAR'] as const;

/** A currency as the reader's language names it, with its symbol: "Australian Dollar (A$)". */
export function currencyLabel(code: string, language: string): string {
  const locale = dateLocaleFor(language);
  try {
    const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code;
    const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
      .formatToParts(0).find(part => part.type === 'currency')?.value;
    const named = name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    return symbol && symbol !== code ? `${named} (${symbol})` : `${named} (${code})`;
  } catch {
    return code;
  }
}

/**
 * Reduces any language tag to a supported code, dropping the region a browser
 * sends ('fr-FR' -> 'fr'). Unknown tags fall back to the default rather than
 * being passed through: the value ends up in an enum-checked schema path.
 */
export function normalizeLanguage(value: any): SupportedLanguage {
  const base = String(value || '').toLowerCase().split('-')[0] as SupportedLanguage;
  return SUPPORTED_LANGUAGES.includes(base) ? base : DEFAULT_LANGUAGE;
}

const DATE_LOCALES: Record<SupportedLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
  ru: 'ru-RU',
  pl: 'pl-PL'
};

/**
 * Regional tag toLocaleDateString expects, from the interface language.
 *
 * Resolved here rather than per view: the same date has to read the same way on a card
 * and on the item page, and an omitted locale silently falls back to the one of the
 * host, which is en-US in a container and turns 01/06 into 6/1 for everyone.
 */
export function dateLocaleFor(value: any): string {
  return DATE_LOCALES[normalizeLanguage(value)];
}

