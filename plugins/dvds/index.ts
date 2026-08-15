import { PluginDefinition } from '../../core/types';
import { TMDBProvider } from './tmdb';
import { dvdImporters } from './importers';
import { escapeRegExp, fetchJson, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { TMDB_LANG_MAP, formatSeasonCount } from './constants';

export const dvdPlugin: PluginDefinition = {
  id: 'dvd',
  kind: 'Dvd',
  label: 'media.dvd_gen',
  i18nKey: 'dvd',
  order: 30,
  externalIdField: 'tmdb_id',
  creatorSearchFields: ['studio'],
  summaryField: { label: 'confirm_dvd.studio_label', field: 'studio' },
  externalLink(item: any) {
    return item.tmdb_id ? { label: 'TMDB', url: `https://www.themoviedb.org/${item.media_type === 'tv' ? 'tv' : 'movie'}/${item.tmdb_id}` } : null;
  },
  icon: 'film',
  routePrefix: '/dvd',
  collectionType: 'dvd',
  creatorField: 'director',
  extraSearchFields: ['studio'],
  supportsBarcodeSearch: true,
  barcodeNoiseTerms: ['DVD', 'Blu-ray', 'Blu Ray', 'Bluray', '4K', 'UHD', 'Ultra HD', 'Coffret', 'Edition', 'Édition', 'Steelbook', 'Combo'],
  searchProvider: new TMDBProvider(),
  imageSearchType: 'movie',
  requiredEnvKeys: ['TMDB_API_KEY'],
  duplicateCheckFields: ['format', 'zone'],
  importers: dvdImporters,
  partialsPath: 'plugins/dvds/partials',
  detailZones: [
    { id: 'badge', partial: 'dvd-status.ejs' },
    { id: 'sidebar', partial: 'status-blocks.ejs' }
  ],

  fastAddOptions: [
    { value: 'dvd', label: 'media.dvd_gen', icon: 'fa-film', color: 'peer-checked:bg-red-600', url: '/add-dvd' }
  ],

  imageSearchProvider: {
    async search(query: string, options?: { language?: string }): Promise<string[]> {
      const tmdbApiKey = process.env.TMDB_API_KEY;
      if (!tmdbApiKey) throw new Error('Missing TMDB API Key');
      const tmdbLang = TMDB_LANG_MAP[options?.language || ''] || 'en-US';
      const data = await fetchJson(
        `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&language=${tmdbLang}`,
        { headers: { 'User-Agent': 'DVinylApp/2.0' }, signal: AbortSignal.timeout(10000) }
      );
      return (data.results || [])
        .filter((item: any) => item.poster_path)
        .map((item: any) => `https://image.tmdb.org/t/p/w500${item.poster_path}`);
    }
  },

  navbarShortcuts: [
    { id: 'dvd', label: 'media.dvd_gen', url: '/collection?type=dvd' },
    { id: 'dvd_dvd', label: 'media.dvd', url: '/collection?type=dvd&format=dvd' },
    { id: 'dvd_bluray', label: 'media.bluray', url: '/collection?type=dvd&format=bluray' },
    { id: 'dvd_4k', label: 'media.4k', url: '/collection?type=dvd&format=4k' },
    { id: 'dvd_vhs', label: 'media.vhs', url: '/collection?type=dvd&format=vhs' },
    { id: 'dvd_laserdisc', label: 'media.laserdisc', url: '/collection?type=dvd&format=laserdisc' },
    { id: 'dvd_digital', label: 'media.digital', url: '/collection?type=dvd&format=digital' }
  ],

  statsWidgets: [
    { id: 'dvd_total', label: 'stats.dvd_total_label', icon: 'fa-film', color: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600', kind: 'count' },
    { id: 'dvd_dvd', label: 'media.dvds', icon: 'fa-compact-disc', color: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-600', kind: 'count' },
    { id: 'dvd_bluray', label: 'media.blurays', icon: 'fa-circle-dot', color: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-600', kind: 'count' },
    { id: 'dvd_4k', label: 'media.4k_pl', icon: 'fa-wand-magic-sparkles', color: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600', kind: 'count' },
    { id: 'dvd_vhs', label: 'media.vhss', icon: 'fa-tape', color: 'bg-stone-100 dark:bg-stone-900/30', text: 'text-stone-600', kind: 'count' },
    { id: 'dvd_laserdisc', label: 'media.laserdiscs', icon: 'fa-compact-disc', color: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-600', kind: 'count' },
    { id: 'dvd_digital', label: 'media.digital', icon: 'fa-cloud', color: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600', kind: 'count' },
    { id: 'director', label: 'stats.top_director_label', icon: 'fa-clapperboard', color: 'bg-red-100 dark:bg-red-500/20', kind: 'top' },
    { id: 'studio', label: 'stats.top_studio_label', icon: 'fa-video', color: 'bg-rose-100 dark:bg-rose-500/20', kind: 'top' }
  ],

  defaultCardFields: ['director'],

  schemaDefinition: {
    director: { type: String, required: true },
    studio: String,
    duration: String,
    rating: String,
    zone: String,
    tmdb_id: Number,
    media_type: {
      type: String,
      enum: ['movie', 'tv'],
      default: 'movie'
    },
    format: {
      type: String,
      enum: ['dvd', 'bluray', '4k', 'vhs', 'laserdisc', 'digital'],
      default: 'dvd'
    },
    is_boxset: { type: Boolean, default: false },
    watchStatus: {
      type: String,
      enum: ['to_watch', 'watching', 'watched'],
      default: 'to_watch'
    },
    user_rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] },
    styles: { type: [String], default: [] },
    description: { type: String, default: '' }
  },

  formats: [
    { value: 'dvd', label: 'media.dvd', color: 'bg-sky-600/90' },
    { value: 'bluray', label: 'media.bluray', color: 'bg-indigo-700/90' },
    { value: '4k', label: 'media.4k', color: 'bg-red-600/90' },
    { value: 'vhs', label: 'media.vhs', color: 'bg-amber-600/90' },
    { value: 'laserdisc', label: 'media.laserdisc', color: 'bg-purple-600/90' },
    { value: 'digital', label: 'media.digital', color: 'bg-cyan-600/90' }
  ],

  formFields: [
    {
      name: 'title',
      label: 'confirm_dvd.field_title',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'director',
      label: 'confirm_dvd.field_director',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'studio',
      label: 'confirm_dvd.field_studio',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'confirm_dvd.field_studio'
    },
    {
      name: 'year',
      label: 'confirm_dvd.field_year',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.year'
    },
    {
      name: 'barcode',
      label: 'confirm_dvd.barcode_label',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'EAN...'
    },
    {
      name: 'format',
      label: 'confirm_dvd.field_format',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      options: [
        { value: 'dvd', label: 'media.dvd' },
        { value: 'bluray', label: 'media.bluray' },
        { value: '4k', label: 'media.4k' },
        { value: 'vhs', label: 'media.vhs' },
        { value: 'laserdisc', label: 'media.laserdisc' },
        { value: 'digital', label: 'media.digital' }
      ]
    },
    {
      name: 'media_type',
      label: 'confirm_dvd.field_media_type',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      options: [
        { value: 'movie', label: 'confirm_dvd.media_type_movie' },
        { value: 'tv', label: 'confirm_dvd.media_type_tv' }
      ]
    },
    {
      name: 'quantity',
      label: 'confirm_dvd.field_quantity',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main'
    },
    {
      name: 'duration',
      label: 'confirm_dvd.field_duration',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: 120 min'
    },
    {
      name: 'zone',
      label: 'confirm_dvd.field_zone',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: Zone B'
    },
    {
      name: 'is_boxset',
      label: 'confirm_dvd.field_is_boxset',
      type: 'boolean',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata'
    },
    {
      name: 'watchStatus',
      label: 'confirm_dvd.field_watch_status',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      options: [
        { value: 'to_watch', label: 'confirm_dvd.status_to_watch' },
        { value: 'watching', label: 'confirm_dvd.status_watching' },
        { value: 'watched', label: 'confirm_dvd.status_watched' }
      ]
    },
    {
      name: 'user_rating',
      label: 'confirm_dvd.field_rating',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: 4'
    },
    {
      name: 'comments',
      label: 'confirm_dvd.field_comments',
      type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'confirm_dvd.comments_placeholder'
    },
    {
      name: 'location',
      label: 'common.location',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.location'
    }
  ],

  getStats(items: any[]): Record<string, any> {
    const countByFormat = (format: string) => {
      return items
        .filter(i => (i.format || '').toLowerCase() === format.toLowerCase())
        .reduce((acc, i) => acc + Number(i.quantity || 1), 0);
    };

    const getTop = (field: string) => {
      const map: Record<string, number> = {};
      let topName = 'N/A';
      let topCount = 0;
      items.forEach(item => {
        const name = item[field];
        if (name) {
          map[name] = (map[name] || 0) + 1;
          if (map[name] > topCount) {
            topCount = map[name];
            topName = name;
          }
        }
      });
      return { name: topName, count: topCount };
    };

    return {
      dvd_total: items.reduce((acc, i) => acc + Number(i.quantity || 1), 0),
      dvd_dvd: countByFormat('dvd'),
      dvd_bluray: countByFormat('bluray'),
      dvd_4k: countByFormat('4k'),
      dvd_vhs: countByFormat('vhs'),
      dvd_laserdisc: countByFormat('laserdisc'),
      dvd_digital: countByFormat('digital'),
      director: getTop('director'),
      studio: getTop('studio')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      director: obj.director || 'Unknown',
      // media_type holds the movie/tv distinction (used by externalLink + the edit select);
      // the physical format lives in `format` and drives the badges via the views.
      media_type: obj.media_type || 'movie',
      cover_image: obj.cover_image || '/ressources/logo.png',
      studio: obj.studio || '',
      year: obj.year || '',
      duration: obj.duration || '',
      zone: obj.zone || '',
      watchStatus: obj.watchStatus || 'to_watch',
      user_rating: obj.user_rating || 0,
      is_boxset: obj.is_boxset || false,
      location: obj.location || '',
      genre: obj.genre || '',
      quantity: obj.quantity || 1
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const tmdbId = data.tmdb_id;
    const matchFormat = data.format || 'dvd';
    const matchZone = (data.zone || '').trim();
    const matchBarcode = (data.barcode || '').trim();

    // A different-zone edition or a different (non-empty) barcode is a distinct copy, not a
    // duplicate: it gets its own entry. An item with no zone/barcode yet still matches
    // (and gets those backfilled).
    const applyVariant = (query: any) => {
      if (matchZone) {
        query.zone = { $regex: new RegExp(`^${escapeRegExp(matchZone)}$`, 'i') };
      }
      const and: any[] = [];
      if (!matchZone) {
        and.push({ $or: [{ zone: { $exists: false } }, { zone: '' }] });
      }
      if (matchBarcode) {
        and.push({ $or: [{ barcode: { $exists: false } }, { barcode: '' }, { barcode: matchBarcode }] });
      }
      if (and.length) query.$and = and;
    };

    if (tmdbId) {
      const query: any = {
        collection: collectionId,
        in_wishlist: false,
        kind: 'Dvd',
        tmdb_id: parseInt(tmdbId)
      };
      if (matchFormat) {
        query.format = matchFormat;
      }
      applyVariant(query);
      const item = await Item.findOne(query);
      if (item) return item;
    }

    const matchTitle = (data.title || '').trim();
    const matchDirector = (data.director || data.creator || '').trim();

    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      kind: 'Dvd',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') },
      director: { $regex: new RegExp(`^${escapeRegExp(matchDirector)}$`, 'i') }
    };

    if (matchFormat) {
      query.format = matchFormat;
    }
    applyVariant(query);
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.tmdb_id) {
      or.push({ tmdb_id: parseInt(data.tmdb_id) });
    }
    const title = (data.title || '').trim();
    const director = (data.director || data.creator || '').trim();
    if (title && director) {
      or.push({
        title: { $regex: new RegExp(`^${escapeRegExp(title)}$`, 'i') },
        director: { $regex: new RegExp(`^${escapeRegExp(director)}$`, 'i') }
      });
    }
    if (or.length === 0) return [];
    return Item.find({
      collection: collectionId,
      in_wishlist: false,
      kind: 'Dvd',
      $or: or
    }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return await Item.find({
      collection: item.collection,
      in_wishlist: false,
      kind: 'Dvd',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') },
      director: { $regex: new RegExp(`^${escapeRegExp(item.director)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '',
      director: '',
      studio: '',
      year: '',
      barcode: '',
      format: 'dvd',
      media_type: 'movie',
      quantity: 1,
      duration: '',
      zone: '',
      is_boxset: false,
      watchStatus: 'to_watch',
      user_rating: 0,
      comments: '',
      location: '',
      cover_image: '/ressources/logo.png',
      user_image: ''
    };
  },

  async refreshItem(item: any, req: any): Promise<Record<string, any>> {
    if (!item.tmdb_id) {
      throw new PermanentRefreshError('No TMDB ID to refresh');
    }

    const tmdbApiKey = process.env.TMDB_API_KEY;
    if (!tmdbApiKey) throw new PermanentRefreshError("TMDB_API_KEY missing");
    const lang = req.language || 'fr';
    const tmdbLang = TMDB_LANG_MAP[lang] || "en-US";

    const mediaType = item.media_type || 'movie';
    const url = `https://api.themoviedb.org/3/${mediaType}/${item.tmdb_id}?api_key=${tmdbApiKey}&language=${tmdbLang}&append_to_response=credits`;
    const data = await fetchJson(url);

    let director = "Unknown";
    if (mediaType === "movie" && data.credits && data.credits.crew) {
      const dirObj = data.credits.crew.find((member: any) => member.job === "Director");
      if (dirObj) director = dirObj.name;
    } else if (mediaType === "tv" && data.created_by && data.created_by.length > 0) {
      director = data.created_by.map((c: any) => c.name).join(", ");
    }

    const studio = data.production_companies && data.production_companies.length > 0
      ? data.production_companies[0].name
      : "";

    const year = mediaType === "tv"
      ? (data.first_air_date || "").substring(0, 4)
      : (data.release_date || "").substring(0, 4);

    const duration = mediaType === "tv"
      ? formatSeasonCount(data.number_of_seasons, lang)
      : `${data.runtime || "?"} min`;

    const cover = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : "";

    const refreshedGenres = data.genres ? data.genres.map((g: any) => g.name) : [];
    return {
      cover_image: cover,
      description: data.overview || "",
      genres: refreshedGenres,
      // keep the singular `genre` in sync so the genre filter/distinct queries don't go stale
      genre: refreshedGenres[0] || "",
      director,
      studio,
      year,
      duration
    };
  }
};

export default dvdPlugin;
