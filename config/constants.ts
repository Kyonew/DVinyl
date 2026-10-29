export const BASE_URL: string = process.env.BASE_URL
  ? (process.env.BASE_URL.startsWith('/') ? process.env.BASE_URL : `/${process.env.BASE_URL}`)
  : ''

/**
 * Languages the app ships. Also the values the User schema accepts, so anything
 * stored on a user has to be one of these exact codes.
 */
export const SUPPORTED_LANGUAGES = ['fr', 'en', 'de', 'es', 'it'] as const;

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
  it: 'Italiano'
};

/**
 * Currencies a user can pick for prices, which the User schema also accepts. Each one is
 * labelled by the `settings.currency_<code in lower case>` key.
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP'] as const;

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
  it: 'it-IT'
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
