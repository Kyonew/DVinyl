import { PluginImporter } from '../../core/types';
import { CsvImportContext, CsvRow, runCsvImport } from '../../core/csvImport';
import { registry } from '../../core/registry';
import {
  LIBIB_HELP_STEPS, LIBIB_REQUIRED_COLUMNS, LIBIB_TYPE_MOVIE, libibAddedAt, libibBarcode,
  libibComments, libibCreator, libibImportFields, libibPrice, libibProgress, libibQuantity,
  libibRating, libibTags, libibTypeFilter, libibYear
} from '../../utils/libib';

// LIBIB CSV IMPORT (movie rows of the export)
async function importLibibMovies(req: any, res: any) {
  // Read from the registry rather than importing index.ts, which imports this file.
  const plugin = registry.get('dvd')!;

  return runCsvImport(req, res, {
    plugin,
    requiredColumns: LIBIB_REQUIRED_COLUMNS,
    accepts: libibTypeFilter(LIBIB_TYPE_MOVIE),
    searchQuery: (_row: CsvRow, data: Record<string, any>) => data.title,
    mapRow(row: CsvRow, ctx: CsvImportContext) {
      const title = (row['title'] || '').trim();
      if (!title) return null;

      const progress = libibProgress(row);
      const { genre, genres } = libibTags(row);
      const discs = parseInt(row['number_of_discs'] || '', 10) || 1;
      const minutes = parseInt(row['length'] || '', 10) || 0;

      return {
        title,
        director: libibCreator(row) || 'Unknown',
        studio: (row['publisher'] || '').trim(),
        year: libibYear(row),
        barcode: libibBarcode(row),
        duration: minutes > 0 ? `${minutes} min` : '',
        // Libib exports no support (DVD/Blu-ray/4K...), so the whole file lands on the
        // format the admin picked in the modal.
        format: ctx.body.default_format || 'dvd',
        media_type: 'movie',
        is_boxset: discs > 1,
        // `rating` is the age classification on this plugin; the personal score is user_rating.
        rating: (row['esrb'] || '').trim() || (row['age_group'] || '').trim(),
        user_rating: libibRating(row),
        watchStatus: progress === 'done' ? 'watched' : (progress === 'started' ? 'watching' : 'to_watch'),
        description: (row['description'] || '').trim(),
        genre,
        genres,
        // Cast and aspect ratio have no path on this plugin: kept as comments rather
        // than dropped.
        comments: libibComments(row, [
          { label: ctx.req.t('admin.libib.note_price'), value: libibPrice(row) },
          { label: ctx.req.t('admin.libib.note_cast'), value: (row['ensemble'] || '').trim() },
          { label: ctx.req.t('admin.libib.note_aspect_ratio'), value: (row['aspect_ratio'] || '').trim() }
        ]),
        added_at: libibAddedAt(row),
        quantity: libibQuantity(row)
      };
    }
  });
}

export const dvdImporters: PluginImporter[] = [
  {
    id: 'libib-dvd',
    requireAdmin: true,
    handler: importLibibMovies,
    ui: {
      label: 'admin.libib.title_movies',
      icon: 'fa-file-csv',
      description: 'admin.libib.subtitle_movies',
      color: 'red',
      help: LIBIB_HELP_STEPS,
      fields: libibImportFields({
        name: 'default_format', label: 'admin.libib.default_format', type: 'select', default: 'dvd', hint: 'admin.libib.default_format_hint', options: [
          { value: 'dvd', label: 'media.dvd' },
          { value: 'bluray', label: 'media.bluray' },
          { value: '4k', label: 'media.4k' },
          { value: 'vhs', label: 'media.vhs' },
          { value: 'laserdisc', label: 'media.laserdisc' },
          { value: 'digital', label: 'media.digital' }
        ]
      }),
      submitLabel: 'admin.libib.btn_import'
    }
  }
];
