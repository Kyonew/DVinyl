import { PluginImporter } from '../../core/types';
import { CsvImportContext, CsvRow, runCsvImport } from '../../core/csvImport';
import { registry } from '../../core/registry';
import { escapeRegExp } from '../../core/helpers';
import {
  LIBIB_HELP_STEPS, LIBIB_REQUIRED_COLUMNS, LIBIB_TYPE_VIDEOGAME, libibAddedAt, libibBarcode,
  libibComments, libibCreator, libibImportFields, libibPrice, libibProgress, libibQuantity,
  libibRating, libibTags, libibTypeFilter, libibYear
} from '../../utils/libib';

/**
 * Libib has no platform column for video games: the console is only ever mentioned in
 * the title ("It Takes Two SWITCH | ... | Nintendo Switch") or dumped in the creators
 * column. Patterns are ordered most-specific first, and spell the console the way IGDB
 * does, so an imported row and a searched one agree on the same wording.
 */
const PLATFORM_PATTERNS: { pattern: RegExp; platform: string }[] = [
  { pattern: /\b(nintendo switch|switch)\b/i, platform: 'Nintendo Switch' },
  { pattern: /\b(playstation 5|ps5)\b/i, platform: 'PlayStation 5' },
  { pattern: /\b(playstation 4|ps4)\b/i, platform: 'PlayStation 4' },
  { pattern: /\b(xbox series|series x|series s)\b/i, platform: 'Xbox Series X/S' },
  { pattern: /\b(pc|steam|windows)\b/i, platform: 'PC' }
];

function detectPlatform(text: string): string | null {
  for (const { pattern, platform } of PLATFORM_PATTERNS) {
    if (pattern.test(text)) return platform;
  }
  return null;
}

/**
 * Libib titles for games are shop listings, where the game name is followed by the
 * console and the shop's own qualifiers, pipe-separated and in the store's language.
 * The stored title stays untouched (it is the user's own export), but the enrichment
 * lookup needs the game name alone: the first segment, minus the console names the
 * plugin already declares for its barcode lookups.
 */
function cleanGameTitle(title: string, noiseTerms: string[]): string {
  const firstSegment = (title.split('|')[0] || title).trim();
  if (noiseTerms.length === 0) return firstSegment || title;

  const pattern = new RegExp(`\\b(${noiseTerms.map(escapeRegExp).join('|')})\\b`, 'gi');
  const cleaned = firstSegment.replace(pattern, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned || firstSegment || title;
}

// LIBIB CSV IMPORT (videogame rows of the export)
async function importLibibGames(req: any, res: any) {
  // Read from the registry rather than importing index.ts, which imports this file.
  const plugin = registry.get('games')!;

  return runCsvImport(req, res, {
    plugin,
    requiredColumns: LIBIB_REQUIRED_COLUMNS,
    accepts: libibTypeFilter(LIBIB_TYPE_VIDEOGAME),
    searchQuery: (_row: CsvRow, data: Record<string, any>) => cleanGameTitle(data.title, plugin.barcodeNoiseTerms || []),
    mapRow(row: CsvRow, ctx: CsvImportContext) {
      const title = (row['title'] || '').trim();
      if (!title) return null;

      const creator = libibCreator(row);
      const progress = libibProgress(row);
      const { genre, genres } = libibTags(row);

      // Libib users routinely put the console in `creators`; that is a platform, not a
      // developer, so it must not end up in the developer field.
      const creatorPlatform = creator ? detectPlatform(creator) : null;
      const platform = detectPlatform(title) || creatorPlatform || ctx.body.default_platform || 'other';

      return {
        title,
        developer: creatorPlatform ? '' : creator,
        publisher: (row['publisher'] || '').trim(),
        platform,
        year: libibYear(row),
        barcode: libibBarcode(row),
        // Libib exports no edition (standard/collector...), so the whole file lands on
        // the format the admin picked in the modal.
        format: ctx.body.default_format || 'physical',
        user_rating: libibRating(row),
        playStatus: progress === 'done' ? 'played' : (progress === 'started' ? 'playing' : 'to_play'),
        description: (row['description'] || '').trim(),
        genre,
        genres,
        // Age rating has no path on this plugin: kept as a comment rather than dropped.
        comments: libibComments(row, [
          { label: ctx.req.t('admin.libib.note_price'), value: libibPrice(row) },
          { label: ctx.req.t('admin.libib.note_age_rating'), value: (row['esrb'] || '').trim() || (row['age_group'] || '').trim() }
        ]),
        added_at: libibAddedAt(row),
        quantity: libibQuantity(row)
      };
    }
  });
}

export const gamesImporters: PluginImporter[] = [
  {
    id: 'libib-games',
    requireAdmin: true,
    handler: importLibibGames,
    ui: {
      label: 'admin.libib.title_games',
      icon: 'fa-file-csv',
      description: 'admin.libib.subtitle_games',
      color: 'emerald',
      help: LIBIB_HELP_STEPS,
      fields: libibImportFields(
        {
          name: 'default_format', label: 'admin.libib.default_format', type: 'select', default: 'physical', hint: 'admin.libib.default_format_hint', options: [
            { value: 'physical', label: 'media.physical' },
            { value: 'collector', label: 'media.collector' },
            { value: 'limited', label: 'media.limited' },
            { value: 'steelbook', label: 'media.steelbook' },
            { value: 'digital', label: 'media.digital' }
          ]
        },
        [
          {
            // Free text for the same reason the plugin's own platform field is: a list
            // shipped here cannot keep up with the consoles that exist.
            name: 'default_platform', label: 'admin.libib.default_platform', type: 'text', default: 'other', hint: 'admin.libib.default_platform_hint'
          }
        ]
      ),
      submitLabel: 'admin.libib.btn_import'
    }
  }
];
