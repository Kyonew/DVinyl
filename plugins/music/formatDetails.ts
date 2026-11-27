/**
 * The physical facts Discogs writes among a format's descriptions, as fields of their own:
 * the size of the disc, the speed it plays at, what kind of release it is, and how many
 * discs it holds. Read from the same words the format line is built from, so an item
 * added before these fields existed gets them from what it already stores.
 */

export const DISC_SIZES = ['7"', '10"', '12"'];
export const SPEEDS = ['33 ⅓ RPM', '45 RPM', '78 RPM'];
// In the order a record is said to be one: a single that Discogs also files as an album
// is a single, an LP that is also a compilation is an LP.
export const RELEASE_TYPES = ['Single', 'Maxi-Single', 'EP', 'Mini-Album', 'LP', 'Album', 'Compilation'];

export interface PhysicalDetails {
  disc_size?: string;
  speed?: string;
  release_type?: string;
  disc_count?: number;
}

// Discogs spells a few of these more than one way ("33 1/3 RPM", 12'').
const normalizeWord = (word: string): string => String(word || '')
  .trim()
  .replace(/[”″'']{1,2}$/, '"')
  .replace(/^33\s*1\/3/i, '33 ⅓')
  .replace(/\s+rpm$/i, ' RPM');

/** The words of a format (Discogs descriptions, or a stored "Vinyl, 12\", LP" line). */
export function physicalFrom(words: unknown[], quantity?: unknown): PhysicalDetails {
  const list = words.map(w => normalizeWord(String(w ?? ''))).filter(Boolean);
  const has = (value: string) => list.some(w => w.toLowerCase() === value.toLowerCase());
  const out: PhysicalDetails = {};
  const size = DISC_SIZES.find(has);
  if (size) out.disc_size = size;
  const speed = SPEEDS.find(has);
  if (speed) out.speed = speed;
  const type = RELEASE_TYPES.find(has);
  if (type) out.release_type = type;
  // The quantity Discogs gives, else a "2x" a stored line starts with ("2xLP", "2 x Vinyl").
  const prefixed = list.map(w => /^(\d+)\s*x/i.exec(w)?.[1]).find(Boolean);
  const count = parseInt(String(quantity ?? prefixed ?? ''), 10);
  if (Number.isInteger(count) && count > 0) out.disc_count = count;
  // Discogs' rules have a vinyl LP name neither its size nor its speed, the word LP
  // standing for 12" at 33 ⅓. A size or speed it does give (a 10" LP) wins. A line from
  // a Discogs CSV export names no medium at all ("LP, Album"), hence "no other medium"
  // rather than "Vinyl".
  const otherMedium = list.some(w => !['', 'vinyl'].includes(mediaOfFormat(w)));
  if (out.release_type === 'LP' && !otherMedium) {
    out.disc_size ??= '12"';
    out.speed ??= '33 ⅓ RPM';
  }
  return out;
}

/** Same, for one Discogs format object ({ name, qty, descriptions, text }). */
export function physicalFromDiscogs(format: any): PhysicalDetails {
  if (!format) return {};
  const words = [format.name, ...(format.descriptions || []), ...String(format.text || '').split(',')];
  return physicalFrom(words, format.qty);
}

/**
 * The details that apply to a copy filed as `media`: a size and a speed belong to a disc
 * on a turntable, so a CD taken from a vinyl-only release ("Vinyl, LP") gets neither.
 * No media at all reads as vinyl, the plugin's default.
 */
export function physicalForMedium(details: PhysicalDetails, media: unknown): PhysicalDetails {
  if (!media || media === 'vinyl') return details;
  const { disc_size, speed, ...rest } = details;
  return rest;
}

/** Which of the plugin's media a Discogs format name is, or '' for none of them (a DVD, a box). */
export function mediaOfFormat(name: unknown): string {
  const lower = String(name || '').trim().toLowerCase();
  // "Cass" is how a Discogs CSV export spells it.
  return lower.includes('cassette') || lower === 'cass' ? 'cassette'
    : /\b(cd|cdr|sacd|hybrid)\b/.test(lower) ? 'cd'
    : /vinyl|lathe|flexi|acetate|shellac/.test(lower) ? 'vinyl'
    : lower === 'file' ? 'digital'
    : '';
}

/**
 * The media type a copy is filed as, from the name of its Discogs format: a "File"
 * release is digital, not a vinyl. Vinyl for a name that is none of the plugin's media,
 * as it always was.
 */
export const mediaTypeOfFormat = (name: unknown): string => mediaOfFormat(name) || 'vinyl';

/**
 * The media a Discogs release comes in besides the one this copy is filed as: the CD of
 * a "Vinyl + CD" release, the download card of a vinyl. Names that are none of the
 * plugin's media (a DVD, a box) are left out.
 */
export function otherMediaFromDiscogs(formats: any[] | undefined, own: string): string[] {
  const out: string[] = [];
  for (const format of formats || []) {
    const media = mediaOfFormat(format?.name);
    if (media && media !== own && !out.includes(media)) out.push(media);
  }
  return out;
}

/** Splits a stored format or edition line back into its words. */
export const wordsOf = (...lines: unknown[]): string[] =>
  lines.flatMap(line => String(line ?? '').split(',')).map(w => w.trim()).filter(Boolean);
