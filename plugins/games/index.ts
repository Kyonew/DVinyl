import { PluginDefinition } from '../../core/types';
import { IGDBProvider } from './igdb';
import { escapeRegExp, fetchJson } from '../../core/helpers';
import { igdbRequest } from './igdbHelper';
import Item from '../../models/Item';

const igdbProvider = new IGDBProvider();

export const gamesPlugin: PluginDefinition = {
  id: 'games',
  kind: 'Game',
  label: 'media.games',
  i18nKey: 'game',
  order: 40,
  externalIdField: 'igdb_id',
  creatorSearchFields: ['publisher'],
  summaryField: { label: 'confirm_game.publisher_label', field: 'publisher' },
  externalLink(item: any) {
    return item.igdb_id ? { label: 'IGDB', url: `https://www.igdb.com/games/${item.igdb_id}` } : null;
  },
  icon: 'gamepad',
  routePrefix: '/game',
  collectionType: 'games',
  creatorField: 'developer',
  extraSearchFields: ['platform', 'publisher'],
  supportsBarcodeSearch: true,
  barcodeNoiseTerms: ['Nintendo', 'PlayStation', 'Xbox', 'PS2', 'PS3', 'PS4', 'PS5', 'Switch', 'Wii U', 'Wii', 'Series X', 'Series S', 'One'],
  searchProvider: igdbProvider,
  imageSearchType: 'game',
  requiredEnvKeys: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
  duplicateCheckFields: ['platform', 'region', 'format'],
  partialsPath: 'plugins/games/partials',
  detailZones: [
    { id: 'badge', partial: 'game-status.ejs' },
    { id: 'sidebar', partial: 'status-blocks.ejs' }
  ],

  fastAddOptions: [
    { value: 'game', label: 'media.games', icon: 'fa-gamepad', color: 'peer-checked:bg-emerald-600', url: '/add-games' }
  ],

  imageSearchProvider: {
    async search(query: string, options?: { language?: string }): Promise<string[]> {
      const fetchOptions = { headers: { 'User-Agent': 'DVinylApp/2.0' }, signal: AbortSignal.timeout(10000) };

      // 1. IGDB assets (covers + artworks + screenshots)
      const igdbResults = await igdbRequest('games',
        `search "${query.replace(/"/g, '\\"')}";
        fields cover.url, artworks.url, screenshots.url;
        limit 5;`
      );

      let urls: string[] = [];
      igdbResults.forEach((g: any) => {
        if (g.cover && g.cover.url) urls.push(g.cover.url);
        if (g.artworks) g.artworks.forEach((a: any) => urls.push(a.url));
        if (g.screenshots) g.screenshots.forEach((sc: any) => urls.push(sc.url));
      });
      urls = urls.map((u) => {
        let r = u.replace('t_thumb', 't_cover_big');
        if (r.startsWith('//')) r = 'https:' + r;
        return r;
      });

      // 2. TMDB fallback
      const tmdbApiKey = process.env.TMDB_API_KEY;
      if (tmdbApiKey) {
        const langMap: Record<string, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', it: 'it-IT', de: 'de-DE' };
        const tmdbLang = langMap[options?.language || ''] || 'en-US';
        const tmdbData = await fetchJson(
          `https://api.themoviedb.org/3/search/multi?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&language=${tmdbLang}`,
          fetchOptions
        );
        urls = urls.concat((tmdbData.results || [])
          .filter((item: any) => item.poster_path)
          .map((item: any) => `https://image.tmdb.org/t/p/w500${item.poster_path}`));
      }

      // 3. iTunes software fallback
      const itunesData = await fetchJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&limit=5`,
        fetchOptions
      );
      urls = urls.concat((itunesData.results || [])
        .filter((item: any) => item.artworkUrl100)
        .map((item: any) => item.artworkUrl100.replace('100x100bb', '512x512bb')));

      return [...new Set(urls)];
    }
  },

  navbarShortcuts: [
    { id: 'games', label: 'media.games', url: '/collection?type=games' },
    { id: 'game_physical', label: 'media.physical', url: '/collection?type=games&format=physical' },
    { id: 'game_collector', label: 'media.collector', url: '/collection?type=games&format=collector' },
    { id: 'game_limited', label: 'media.limited', url: '/collection?type=games&format=limited' },
    { id: 'game_steelbook', label: 'media.steelbook', url: '/collection?type=games&format=steelbook' },
    { id: 'game_digital', label: 'media.digital', url: '/collection?type=games&format=digital' }
  ],

  statsWidgets: [
    { id: 'game_total', label: 'stats.games_total_label', icon: 'fa-gamepad', color: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600', kind: 'count' },
    { id: 'game_physical', label: 'media.physical', icon: 'fa-box', color: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600', kind: 'count' },
    { id: 'game_collector', label: 'media.collector', icon: 'fa-gem', color: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600', kind: 'count' },
    { id: 'game_limited', label: 'media.limited', icon: 'fa-star', color: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600', kind: 'count' },
    { id: 'game_steelbook', label: 'media.steelbook', icon: 'fa-shield', color: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-600', kind: 'count' },
    { id: 'game_digital', label: 'media.digital', icon: 'fa-cloud', color: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600', kind: 'count' },
    { id: 'game_developer', label: 'stats.top_developer_label', icon: 'fa-code', color: 'bg-emerald-100 dark:bg-emerald-500/20', kind: 'top' },
    { id: 'game_publisher', label: 'stats.top_game_publisher_label', icon: 'fa-building-columns', color: 'bg-teal-100 dark:bg-teal-500/20', kind: 'top' },
    { id: 'game_platform', label: 'stats.top_platform_label', icon: 'fa-tv', color: 'bg-indigo-100 dark:bg-indigo-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    developer: { type: String, default: '' },
    publisher: { type: String, default: '' },
    platform: { type: String, default: 'other' },
    igdb_id: Number,
    region: { type: String, default: '' },
    format: {
      type: String,
      enum: ['physical', 'collector', 'limited', 'steelbook', 'digital'],
      default: 'physical'
    },
    playStatus: {
      type: String,
      enum: ['to_play', 'playing', 'played'],
      default: 'to_play'
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
    { value: 'physical', label: 'media.physical', color: 'bg-emerald-600/90' },
    { value: 'collector', label: 'media.collector', color: 'bg-amber-600/90' },
    { value: 'limited', label: 'media.limited', color: 'bg-purple-600/90' },
    { value: 'steelbook', label: 'media.steelbook', color: 'bg-sky-600/90' },
    { value: 'digital', label: 'media.digital', color: 'bg-cyan-600/90' }
  ],

  formFields: [
    {
      name: 'title',
      label: 'confirm_game.field_title',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'developer',
      label: 'confirm_game.field_developer',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'publisher',
      label: 'confirm_game.field_publisher',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'year',
      label: 'confirm_game.field_year',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.year'
    },
    {
      name: 'platform',
      label: 'confirm_game.field_platform',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      options: [
        { value: 'PC', label: 'PC' },
        { value: 'PlayStation 5', label: 'PlayStation 5' },
        { value: 'PlayStation 4', label: 'PlayStation 4' },
        { value: 'Xbox Series X/S', label: 'Xbox Series X/S' },
        { value: 'Nintendo Switch', label: 'Nintendo Switch' },
        { value: 'other', label: 'other' }
      ]
    },
    {
      name: 'region',
      label: 'confirm_game.field_region',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'confirm_game.region_placeholder'
    },
    {
      name: 'format',
      label: 'confirm_game.field_format',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      options: [
        { value: 'physical', label: 'media.physical' },
        { value: 'collector', label: 'media.collector' },
        { value: 'limited', label: 'media.limited' },
        { value: 'steelbook', label: 'media.steelbook' },
        { value: 'digital', label: 'media.digital' }
      ]
    },
    {
      name: 'barcode',
      label: 'confirm_game.field_barcode',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'Code-barres...'
    },
    {
      name: 'quantity',
      label: 'confirm_game.field_quantity',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main'
    },
    {
      name: 'playStatus',
      label: 'confirm_game.field_status',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      options: [
        { value: 'to_play', label: 'confirm_game.status_to_play' },
        { value: 'playing', label: 'confirm_game.status_playing' },
        { value: 'played', label: 'confirm_game.status_played' }
      ]
    },
    {
      name: 'user_rating',
      label: 'confirm_game.field_rating',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: 4'
    },
    {
      name: 'comments',
      label: 'confirm_game.field_comments',
      type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Comments'
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

  cardBadge(item: any) {
    const fmt = (item.format || 'physical').toLowerCase();
    const opt = this.formats.find((f: any) => f.value === fmt);
    return { label: item.platform || 'Game', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
  },

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
      game_total: items.reduce((acc, i) => acc + Number(i.quantity || 1), 0),
      game_physical: countByFormat('physical'),
      game_collector: countByFormat('collector'),
      game_limited: countByFormat('limited'),
      game_steelbook: countByFormat('steelbook'),
      game_digital: countByFormat('digital'),
      game_developer: getTop('developer'),
      game_publisher: getTop('publisher'),
      game_platform: getTop('platform')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      developer: obj.developer || 'Unknown',
      cover_image: obj.cover_image || '/ressources/logo.png',
      publisher: obj.publisher || '',
      year: obj.year || '',
      region: obj.region || '',
      playStatus: obj.playStatus || 'to_play',
      user_rating: obj.user_rating || 0,
      location: obj.location || '',
      genre: obj.genre || '',
      quantity: obj.quantity || 1
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const igdbId = data.igdb_id;
    const matchPlatform = data.platform || 'other';
    const matchFormat = data.format || 'physical';
    const matchRegion = (data.region || '').trim();
    const matchBarcode = (data.barcode || '').trim();

    // A different-region edition (PAL/NTSC, etc.) or a different (non-empty) barcode is a
    // distinct copy, not a duplicate: it gets its own entry instead of bumping the first one's
    // quantity. An item with no region/barcode yet still matches (and gets those backfilled).
    const applyVariant = (query: any) => {
      if (matchRegion) {
        query.region = { $regex: new RegExp(`^${escapeRegExp(matchRegion)}$`, 'i') };
      }
      const and: any[] = [];
      if (!matchRegion) {
        and.push({ $or: [{ region: { $exists: false } }, { region: '' }] });
      }
      if (matchBarcode) {
        and.push({ $or: [{ barcode: { $exists: false } }, { barcode: '' }, { barcode: matchBarcode }] });
      }
      if (and.length) query.$and = and;
    };

    if (igdbId) {
      const query: any = {
        collection: collectionId,
        in_wishlist: false,
        kind: 'Game',
        igdb_id: parseInt(igdbId)
      };
      if (matchPlatform) {
        query.platform = matchPlatform;
      }
      if (matchFormat) {
        query.format = matchFormat;
      }
      applyVariant(query);
      const item = await Item.findOne(query);
      if (item) return item;
    }

    const matchTitle = (data.title || '').trim();

    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      kind: 'Game',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };

    if (matchPlatform) {
      query.platform = matchPlatform;
    }
    if (matchFormat) {
      query.format = matchFormat;
    }
    applyVariant(query);
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.igdb_id) {
      or.push({ igdb_id: parseInt(data.igdb_id) });
    }
    const title = (data.title || '').trim();
    if (title) {
      or.push({ title: { $regex: new RegExp(`^${escapeRegExp(title)}$`, 'i') } });
    }
    if (or.length === 0) return [];
    return Item.find({
      collection: collectionId,
      in_wishlist: false,
      kind: 'Game',
      $or: or
    }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return await Item.find({
      collection: item.collection,
      in_wishlist: false,
      kind: 'Game',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.igdb_id) {
      throw new Error('No IGDB ID to refresh');
    }

    const formatted = await igdbProvider.getDetails(String(item.igdb_id), {});
    const genres = formatted.genres || [];

    const updateData: any = {
      cover_image: formatted.cover_image,
      genres,
      genre: genres[0] || '',
      year: formatted.year,
      developer: formatted.developer || item.developer,
      publisher: formatted.publisher || item.publisher,
      // `description` holds the IGDB summary shown on the detail page — persist it on refresh too
      description: formatted.description || item.description
    };

    await Item.updateOne({ _id: item._id }, { $set: updateData });
    return updateData;
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '',
      developer: '',
      publisher: '',
      year: '',
      barcode: '',
      platform: 'other',
      region: '',
      format: 'physical',
      quantity: 1,
      playStatus: 'to_play',
      user_rating: 0,
      comments: '',
      location: '',
      cover_image: '/ressources/logo.png',
      user_image: ''
    };
  }
};

export default gamesPlugin;
