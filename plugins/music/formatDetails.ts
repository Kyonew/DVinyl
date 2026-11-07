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
  return out;
}

/** Same, for one Discogs format object ({ name, qty, descriptions, text }). */
export function physicalFromDiscogs(format: any): PhysicalDetails {
  if (!format) return {};
  const words = [...(format.descriptions || []), ...String(format.text || '').split(',')];
  return physicalFrom(words, format.qty);
}

/** Splits a stored format or edition line back into its words. */
export const wordsOf = (...lines: unknown[]): string[] =>
  lines.flatMap(line => String(line ?? '').split(',')).map(w => w.trim()).filter(Boolean);
