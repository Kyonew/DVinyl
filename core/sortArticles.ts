/**
 * The words a title may start with that its sort ignores, chosen per collection.
 *
 * "The Wall" files under W in an English collection, and "Les Misérables" under M in a
 * French one only if that collection says so: an article in one language is a real word
 * in another ("Die Hard", "La Bamba"), so no list suits everyone and none is guessed.
 *
 * Held in memory because the sort key is written by the storage layer itself, on every
 * write, with no request around it to read the collection's settings from. Kept free of
 * any database import for the same reason; core/sortTitles.ts fills it.
 */

/** What a collection that never chose sorts with, which is what DVinyl always did. */
export const DEFAULT_SORT_ARTICLES: readonly string[] = ['the', 'a', 'an'];

const MAX_ARTICLES = 40;
const MAX_LENGTH = 20;

const byCollection = new Map<string, readonly string[]>();

/** One article in the form titles are compared in: accent folded, lowercase, one apostrophe. */
export function normalizeArticle(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The list an admin typed, cleaned: split on commas, semicolons or new lines, deduped,
 * bounded. An empty answer is a real choice, "ignore nothing".
 */
export function parseSortArticles(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\n]/);
  const seen = new Set<string>();
  for (const part of parts) {
    const article = normalizeArticle(part).slice(0, MAX_LENGTH);
    if (article) seen.add(article);
    if (seen.size >= MAX_ARTICLES) break;
  }
  return [...seen];
}

/** What a stored setting means: absent is the default, a list (even empty) is a choice. */
export function articlesFromSetting(value: unknown): readonly string[] {
  return Array.isArray(value) ? parseSortArticles(value) : DEFAULT_SORT_ARTICLES;
}

/** The articles a collection's titles are sorted without. */
export function sortArticlesFor(collectionId: unknown): readonly string[] {
  if (collectionId == null) return DEFAULT_SORT_ARTICLES;
  return byCollection.get(String(collectionId)) ?? DEFAULT_SORT_ARTICLES;
}

export function rememberSortArticles(collectionId: unknown, setting: unknown): void {
  if (collectionId == null) return;
  byCollection.set(String(collectionId), articlesFromSetting(setting));
}

export function forgetAllSortArticles(): void {
  byCollection.clear();
}
