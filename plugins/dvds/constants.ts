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

// One season on its own is measured in episodes, not in seasons. Same reasoning as above:
// the word ships with the data so it matches the language the title was fetched in.
const EPISODE_LABELS: Record<string, [string, string]> = {
  fr: ['épisode', 'épisodes'],
  en: ['episode', 'episodes'],
  es: ['episodio', 'episodios'],
  it: ['episodio', 'episodi'],
  de: ['Folge', 'Folgen']
};

/**
 * How a shelf would label what is owned of a show: "Season 2", "Seasons 1 to 4", or the
 * numbers themselves when there are gaps. Returns a translation key and its parameters,
 * since a plugin has no access to the translation files, and null when there is nothing
 * to say.
 *
 * Shared by the collection card and the item page so both phrase it the same way.
 */
export function describeOwnedSeasons(numbers: number[]): { key: string; params: Record<string, any> } | null {
  const owned = numbers.filter(n => typeof n === 'number').sort((a, b) => a - b);
  if (owned.length === 0) return null;
  if (owned.length === 1) return { key: 'dvd_detail.season_number', params: { number: owned[0] } };

  const contiguous = owned[owned.length - 1]! - owned[0]! === owned.length - 1;
  return contiguous
    ? { key: 'dvd_detail.seasons_range', params: { from: owned[0], to: owned[owned.length - 1] } }
    : { key: 'dvd_detail.seasons_list', params: { list: owned.join(', ') } };
}

export function formatEpisodeCount(count: number, lang?: string): string {
  const labels = EPISODE_LABELS[lang || ''] || EPISODE_LABELS.en!;
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? labels[0] : labels[1]}`;
}
