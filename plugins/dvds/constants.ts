// TMDB language codes, dvd-specific.
export const TMDB_LANG_MAP: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
  it: 'it-IT',
  de: 'de-DE'
};

// A show's duration is a season count, and it is stored already formatted, next to the
// "120 min" of a film. Plugins have no access to the translation files, so the word lives
// here, in the same languages TMDB is queried in: the string then matches the title and
// the synopsis fetched alongside it, instead of being French whatever the user reads.
const SEASON_LABELS: Record<string, [string, string]> = {
  fr: ['saison', 'saisons'],
  en: ['season', 'seasons'],
  es: ['temporada', 'temporadas'],
  it: ['stagione', 'stagioni'],
  de: ['Staffel', 'Staffeln']
};

export function formatSeasonCount(count: number, lang?: string): string {
  const labels = SEASON_LABELS[lang || ''] || SEASON_LABELS.en!;
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? labels[0] : labels[1]}`;
}
