import { CsvRow } from '../core/csvImport';
import { ImportField } from '../core/types';

/**
 * Shared knowledge of the Libib (libib.com) CSV export, used by the per-plugin
 * `libib-*` importers. A Libib export is a single flat file mixing every media type,
 * with 30 columns of which each type only fills a handful:
 *
 *   item_type,title,creators,first_name,last_name,collection,ean_isbn13,upc_isbn10,
 *   description,publisher,publish_date,group,tags,notes,price,length,number_of_discs,
 *   number_of_players,age_group,ensemble,aspect_ratio,esrb,rating,review,review_date,
 *   status,began,completed,added,copies
 *
 * Each plugin filters on `item_type` and maps the columns onto its own schema, so a
 * user picks "import my movies" / "import my games" one file drop at a time.
 */

/** Values of the `item_type` column, one per DVinyl plugin that can receive them. */
export const LIBIB_TYPE_BOOK = 'book';
export const LIBIB_TYPE_MUSIC = 'music';
export const LIBIB_TYPE_MOVIE = 'movie';
export const LIBIB_TYPE_VIDEOGAME = 'videogame';

/** Columns any Libib export must expose for the file to be recognized as one. */
export const LIBIB_REQUIRED_COLUMNS = ['item_type', 'title'];

/** Returns a row matcher for one Libib media type. */
export function libibTypeFilter(itemType: string) {
  return (row: CsvRow): boolean => (row['item_type'] || '').trim().toLowerCase() === itemType;
}

/** Author / artist / director / studio, from `creators` or the first+last name pair. */
export function libibCreator(row: CsvRow): string {
  const creators = (row['creators'] || '').trim();
  if (creators) return creators;
  return [row['first_name'], row['last_name']].map(p => (p || '').trim()).filter(Boolean).join(' ');
}

/** Release year, extracted from the ISO-ish `publish_date` (empty when absent). */
export function libibYear(row: CsvRow): string {
  const match = (row['publish_date'] || '').match(/\d{4}/);
  return match ? match[0] : '';
}

/** EAN-13 first, UPC/ISBN-10 as fallback, stripped of separators. */
export function libibBarcode(row: CsvRow): string {
  const raw = (row['ean_isbn13'] || '').trim() || (row['upc_isbn10'] || '').trim();
  return raw.replace(/[-\s]/g, '');
}

/** Libib tags (comma-separated) reused as the item's taxonomy. */
export function libibTags(row: CsvRow): { genre: string; genres: string[] } {
  const genres = (row['tags'] || '').split(',').map(t => t.trim()).filter(Boolean);
  return { genre: genres[0] || '', genres };
}

/** Personal rating, clamped to the 0-5 range every plugin uses. */
export function libibRating(row: CsvRow): number {
  const value = parseFloat((row['rating'] || '').replace(',', '.'));
  if (isNaN(value)) return 0;
  return Math.min(5, Math.max(0, value));
}

/** Number of copies owned, mapped onto the base Item `quantity`. */
export function libibQuantity(row: CsvRow): number {
  const copies = parseInt(row['copies'] || '', 10);
  return copies > 0 ? copies : 1;
}

/** Date the item entered the Libib library, kept as the DVinyl `added_at`. */
export function libibAddedAt(row: CsvRow): Date {
  const raw = (row['added'] || '').trim();
  if (!raw) return new Date();
  const date = new Date(raw);
  return isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Reading/watching/playing progress, derived from the `began`/`completed` dates.
 * Each plugin translates it to its own status enum (readingStatus, watchStatus...).
 */
export function libibProgress(row: CsvRow): 'done' | 'started' | 'none' {
  if ((row['completed'] || '').trim()) return 'done';
  if ((row['began'] || '').trim()) return 'started';
  return 'none';
}

/** A labelled extra line to append to the comments (label already translated). */
export interface LibibNote {
  label: string;
  value: string;
}

/**
 * Assembles the item comments: the user's own notes and review first, then the
 * labelled extras a plugin wants to keep (price, cast, aspect ratio...) because its
 * schema has no dedicated field for them.
 */
export function libibComments(row: CsvRow, extras: LibibNote[] = []): string {
  const parts: string[] = [];

  const notes = (row['notes'] || '').trim();
  if (notes) parts.push(notes);

  const review = (row['review'] || '').trim();
  if (review) parts.push(review);

  for (const extra of extras) {
    const value = (extra.value || '').trim();
    if (value) parts.push(`${extra.label}: ${value}`);
  }

  return parts.join('\n\n');
}

/** Purchase price as exported (no currency in the file), for the comments block. */
export function libibPrice(row: CsvRow): string {
  const price = (row['price'] || '').trim();
  return (!price || price === '0' || price === '0.00') ? '' : price;
}

/**
 * Fields of the import modal, shared by the four `libib-*` importers: the file, the
 * target (collection/wishlist), the plugin's default format (Libib exports no
 * support/edition at all) and the enrichment mode.
 *
 * `extraFields` are inserted right after the format one (e.g. the games platform).
 */
export function libibImportFields(formatField: ImportField, extraFields: ImportField[] = []): ImportField[] {
  return [
    { name: 'csv', label: 'admin.libib.file_label', type: 'file', accept: '.csv', fileEncoding: 'text', required: true },
    {
      name: 'type', label: 'admin.import.type_label', type: 'select', default: 'collection', options: [
        { value: 'collection', label: 'admin.import.collection' },
        { value: 'wishlist', label: 'admin.import.wantlist' }
      ]
    },
    formatField,
    ...extraFields,
    {
      name: 'enrich', label: 'admin.libib.mode_label', type: 'select', default: 'false', hint: 'admin.libib.mode_hint', options: [
        { value: 'false', label: 'admin.libib.mode_fast' },
        { value: 'true', label: 'admin.libib.mode_enriched' }
      ]
    }
  ];
}

/** Help steps shown in every Libib modal (how to get the export out of Libib). */
export const LIBIB_HELP_STEPS = ['admin.libib.step1', 'admin.libib.step2', 'admin.libib.step3'];
