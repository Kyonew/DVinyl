import { PluginDefinition } from '../../core/types';
import { DiscogsProvider } from './discogs';
import { musicImporters } from './importers';
import { musicApiRoutes } from './apiRoutes';
import { escapeRegExp, fetchJson, PermanentRefreshError, syncStamp } from '../../core/helpers';
import Item from '../../models/Item';

export const musicPlugin: PluginDefinition = {
  id: 'music',
  kind: 'Music',
  label: 'media.music',
  i18nKey: 'vinyl',
  order: 10,
  enabledByDefault: true,
  externalIdField: 'discogs_id',
  matchesLegacyItems: true,
  pathAliases: ['vinyl', 'cd', 'cassette', 'discogs'],
  creatorSearchFields: ['label'],
  summaryField: { label: 'confirm_vinyl.label_label', field: 'label' },
  bulkRefreshDelayMs: 1500,
  supportsPriceEstimate: true,
  externalLink(item: any) {
    return item.discogs_id ? { label: 'Discogs', url: `https://www.discogs.com/release/${item.discogs_id}` } : null;
  },
  icon: 'record-vinyl',
  routePrefix: '/album',
  collectionType: 'music',
  creatorField: 'artist',
  extraSearchFields: ['tracklist.title', 'tracklist.tags'],
  supportsBarcodeSearch: false,
  aspectRatioClass: 'aspect-square',
  supportsUserImage: true,
  secondaryImageSearchPath: '/api/search-discogs-gallery',
  secondaryImageIcon: 'fa-compact-disc',
  imageLabels: { main: 'detail.official_cover', secondary: 'detail.additional_image' },
  duplicateCheckFields: ['media_type', 'variant_color'],

  fastAddOptions: [
    { value: 'vinyl', label: 'media.vinyls', icon: 'fa-record-vinyl', color: 'peer-checked:bg-green-600', url: '/add-music?format=vinyl' },
    { value: 'cd', label: 'media.cds', icon: 'fa-compact-disc', color: 'peer-checked:bg-blue-600', url: '/add-music?format=cd' },
    { value: 'cassette', label: 'media.cassettes', icon: 'fa-tape', color: 'peer-checked:bg-orange-600', url: '/add-music?format=cassette' }
  ],

  // Collection-level buttons, rendered generically by the core (see CollectionAction).
  collectionActions: [
    {
      id: 'estimate',
      label: 'index.btn_estimate',
      icon: 'fa-calculator',
      tooltip: 'index.btn_estimate',
      behavior: 'estimate',
      estimate: {
        idsEndpoint: '/api/collection/ids',
        estimateEndpoint: '/api/estimate',
        idField: 'discogs_id',
        maxMultiplier: 1.3
      }
    },
    {
      id: 'discogs-sync',
      label: 'collection.refresh',
      icon: 'fa-sync',
      tooltip: 'collection.refresh_tooltip',
      behavior: 'importer-sync',
      importerId: 'discogs',
      requiresUserData: 'discogsUsername'
    }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const data = await fetchJson(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=12`,
        { headers: { 'User-Agent': 'DVinylApp/2.0' }, signal: AbortSignal.timeout(10000) }
      );
      return (data.results || []).map((item: any) => item.artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg'));
    }
  },

  navbarShortcuts: [
    { id: 'music', label: 'media.music', url: '/collection?type=music' },
    { id: 'music_vinyl', label: 'media.vinyls', url: '/collection?type=music&format=vinyl' },
    { id: 'music_cd', label: 'media.cds', url: '/collection?type=music&format=cd' },
    { id: 'music_cassette', label: 'media.cassettes', url: '/collection?type=music&format=cassette' },
    { id: 'music_digital', label: 'media.digital', url: '/collection?type=music&format=digital' }
  ],

  statsWidgets: [
    { id: 'vinyl', label: 'media.vinyls', icon: 'fa-record-vinyl', color: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-600', kind: 'count' },
    { id: 'cd', label: 'media.cds', icon: 'fa-compact-disc', color: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600', kind: 'count' },
    { id: 'cassette', label: 'media.cassettes', icon: 'fa-tape', color: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600', kind: 'count' },
    { id: 'digital', label: 'media.digital', icon: 'fa-cloud', color: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600', kind: 'count' },
    { id: 'artist', label: 'stats.top_artist_label', icon: 'fa-crown', color: 'bg-purple-100 dark:bg-purple-500/20', kind: 'top' },
    { id: 'music_genre', label: 'stats.top_genre_label', icon: 'fa-music', color: 'bg-pink-100 dark:bg-pink-500/20', kind: 'top' },
    { id: 'label', label: 'stats.top_label_label', icon: 'fa-building', color: 'bg-emerald-100 dark:bg-emerald-500/20', kind: 'top' }
  ],

  defaultCardFields: ['artist', 'format_type', 'variant_color'],
  cardFieldStyles: { format_type: 'pill', variant_color: 'dot' },

  // format_type comes from Discogs as a full descriptor ("Vinyl, LP, Album, Reissue").
  // The card only has room for what distinguishes this copy, and the media badge right
  // above already says vinyl or CD, so those words are dropped.
  cardFieldValue(name: string, item: any): string | null {
    if (name !== 'format_type' || !item.format_type) return null;
    const noise = ['vinyl', 'album', 'reissue', 'repress', 'cd', 'cassette'];
    const kept = String(item.format_type)
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => !noise.includes(s.toLowerCase()))
      .join(', ');
    // Nothing left means the value said no more than the badge above it, which is what a
    // hand-added record with the plain "Vinyl" default looks like. The line is dropped.
    return kept;
  },

  schemaDefinition: {
    artist: { type: String, required: true },
    label: String,
    catalog_number: String,
    media_type: {
      type: String,
      enum: ['vinyl', 'cd', 'cassette', 'digital'],
      default: 'vinyl'
    },
    format_type: { type: String, default: 'Vinyl' },
    variant_color: String,
    sleeve_condition: { type: String, default: '' },
    discogs_id: Number,
    country: { type: String, default: '' },
    // Base Item paths, redeclared like the other native plugins do: the collection page
    // reads schemaDefinition to know which taxonomies a type actually uses, and Discogs
    // fills all three.
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] },
    styles: { type: [String], default: [] },
    tracklist: [{
      position: String,
      title: String,
      duration: String,
      rating: { type: Number, min: 0, max: 5 },
      tags: [String],
      notes: String,
      bpm: Number,
      key: String,
      lyrics: String
    }]
  },

  formats: [
    { value: 'vinyl', label: 'media.vinyl', color: 'bg-green-600/90' },
    { value: 'cd', label: 'media.cd', color: 'bg-blue-600/90' },
    { value: 'cassette', label: 'media.cassette', color: 'bg-orange-600/90' },
    { value: 'digital', label: 'media.digital', color: 'bg-cyan-600/90' },
  ],

  // Field order drives the layout (2-column pairs):
  // album info (main) -> tracklist -> images -> storage/condition (metadata)
  formFields: [
    {
      name: 'title',
      label: 'confirm_vinyl.field_title',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'artist',
      label: 'confirm_vinyl.field_artist',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'year',
      label: 'confirm_vinyl.year_label',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.year'
    },
    {
      name: 'media_type',
      label: 'confirm_vinyl.field_media_type',
      type: 'radio-cards',
      options: [
        { value: 'vinyl', label: 'media.vinyl', icon: 'fa-record-vinyl' },
        { value: 'cd', label: 'media.cd', icon: 'fa-compact-disc' },
        { value: 'cassette', label: 'media.cassette', icon: 'fa-tape' },
        { value: 'digital', label: 'media.digital', icon: 'fa-cloud' }
      ],
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      default: 'vinyl'
    },
    {
      name: 'format_type',
      label: 'confirm_vinyl.field_format',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main'
    },
    {
      name: 'variant_color',
      label: 'confirm_vinyl.field_edition',
      type: 'text',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main'
    },
    {
      name: 'barcode',
      label: 'confirm_vinyl.barcode_label',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.barcode'
    },
    {
      name: 'quantity',
      label: 'confirm_vinyl.field_quantity',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      default: 1
    },
    {
      name: 'label',
      label: 'confirm_vinyl.label_label',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.label',
      showCondition: 'manual-only'
    },
    {
      name: 'catalog_number',
      label: 'confirm_vinyl.catalog_label',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.catalog_number',
      showCondition: 'manual-only'
    },
    {
      name: 'country',
      label: 'confirm_vinyl.country',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.country',
      showCondition: 'manual-only'
    },
    {
      name: 'tracklist',
      label: 'confirm_vinyl.tracklist_label',
      type: 'custom',
      partial: 'tracklist-editor',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'location',
      label: 'common.location',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.location'
    },
    {
      name: 'sleeve_condition',
      label: 'confirm_vinyl.sleeve_condition_label',
      type: 'select',
      options: [
        { value: '', label: 'confirm_vinyl.sleeve_condition_placeholder' },
        { value: 'M', label: 'Mint (M)' },
        { value: 'NM', label: 'Near Mint (NM)' },
        { value: 'VG+', label: 'Very Good Plus (VG+)' },
        { value: 'VG', label: 'Very Good (VG)' },
        { value: 'G+', label: 'Good Plus (G+)' },
        { value: 'G', label: 'Good (G)' },
        { value: 'F', label: 'Fair (F)' },
        { value: 'P', label: 'Poor (P)' },
        { value: 'Generic', label: 'confirm_vinyl.sleeve_condition_generic' }
      ],
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata'
    },
    {
      name: 'genres',
      label: 'confirm_vinyl.field_genres',
      type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.genres'
    },
    {
      name: 'styles',
      label: 'confirm_vinyl.field_styles',
      type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'placeholders.styles'
    },
    {
      name: 'comments',
      label: 'confirm_vinyl.field_comments',
      type: 'textarea',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'confirm_vinyl.comments_placeholder',
      hint: 'confirm_vinyl.comments_hint'
    }
  ],

  searchProvider: new DiscogsProvider(),
  searchFormPartial: 'search-form',
  imageSearchType: 'music',
  importers: musicImporters,
  apiRoutes: musicApiRoutes,

  settings: [
    { key: 'advancedCD', label: 'admin.advanced_cd', type: 'boolean', default: false, description: 'admin.advanced_cd_desc' }
  ],

  cardBadge(item: any, settings?: any) {
    const advancedCD = !!(settings?.pluginSettings?.music?.advancedCD);
    const fmt = (item.media_type || item.format || '').toLowerCase();
    if (advancedCD && fmt === 'cd' && item.format_type) {
      const ft = String(item.format_type).toLowerCase();
      if (ft.includes('sacd')) return { label: 'media.sacd', colorClass: 'bg-red-600/90' };
      if (ft.includes('cdr')) return { label: 'media.cdr', colorClass: 'bg-blue-600/90' };
    }
    const opt = this.formats.find((f: any) => f.value === fmt);
    return { label: opt ? opt.label : ('media.' + (fmt || 'vinyl')), colorClass: (opt && opt.color) || 'bg-gray-600/90' };
  },

  getStats(items: any[]): Record<string, any> {
    const countByFormat = (format: string) => {
      return items
        .filter(i => (i.media_type || '').toLowerCase() === format.toLowerCase())
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
      vinyl: countByFormat('vinyl'),
      cd: countByFormat('cd'),
      cassette: countByFormat('cassette'),
      digital: countByFormat('digital'),
      artist: getTop('artist'),
      music_genre: getTop('genre'),
      label: getTop('label'),
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      artist: obj.artist || 'Unknown',
      media_type: obj.media_type || 'vinyl',
      cover_image: obj.cover_image || '/ressources/logo.png',
      tracklist: obj.tracklist || [],
      label: obj.label || '',
      year: obj.year || '',
      format_type: obj.format_type || '',
      variant_color: obj.variant_color || '',
      sleeve_condition: obj.sleeve_condition || '',
      location: obj.location || '',
      genre: obj.genre || '',
      quantity: obj.quantity || 1,
      country: obj.country || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const discogsId = data.discogs_id;
    const title = data.title;
    const artist = data.artist;
    const mediaType = data.media_type || 'vinyl';
    const variantColor = (data.variant_color || '').trim();

    if (discogsId) {
      const query: any = {
        collection: collectionId,
        in_wishlist: false,
        kind: 'Music',
        discogs_id: parseInt(discogsId),
        media_type: mediaType
      };
      if (variantColor) {
        query.variant_color = { $regex: new RegExp(`^${escapeRegExp(variantColor)}$`, 'i') };
      } else {
        query.$or = [
          { variant_color: { $exists: false } },
          { variant_color: "" }
        ];
      }
      const item = await Item.findOne(query);
      if (item) return item;
    }

    const matchTitle = (title || '').trim();
    const matchArtist = (artist || '').trim();

    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      kind: 'Music',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') },
      artist: { $regex: new RegExp(`^${escapeRegExp(matchArtist)}$`, 'i') },
      media_type: mediaType
    };

    if (variantColor) {
      query.variant_color = { $regex: new RegExp(`^${escapeRegExp(variantColor)}$`, 'i') };
    } else {
      query.$or = [
        { variant_color: { $exists: false } },
        { variant_color: "" }
      ];
    }

    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.discogs_id) {
      or.push({ discogs_id: parseInt(data.discogs_id) });
    }
    if (data.title && data.artist) {
      or.push({
        title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') },
        artist: { $regex: new RegExp(`^${escapeRegExp(String(data.artist).trim())}$`, 'i') }
      });
    }
    if (or.length === 0) return [];
    return Item.find({
      collection: collectionId,
      in_wishlist: false,
      kind: 'Music',
      $or: or
    }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    return Item.find({
      collection: item.collection,
      kind: 'Music',
      _id: { $ne: item._id },
      in_wishlist: false,
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') },
      artist: { $regex: new RegExp(`^${escapeRegExp(item.artist)}$`, 'i') }
    }).lean();
  },

  getManualDefaults() {
    return {
      title: '',
      artist: '',
      year: '',
      label: '',
      catalog_number: '',
      format_type: 'Vinyl',
      variant_color: '',
      tracklist: [],
      cover_image: '',
      discogs_id: '',
      country: '',
      genres: [],
      styles: [],
      barcode: '',
      media_type: 'vinyl',
      user_image: '',
      location: '',
      sleeve_condition: '',
      is_bootleg: false
    };
  },

  partialsPath: 'plugins/music/partials',

  detailZones: [
    { id: 'badge', partial: 'duration-pill' },
    { id: 'content', partial: 'tracklist-view' }
  ],

  async refreshItem(item: any, req: any): Promise<Record<string, any>> {
    const discogsId = item.discogs_id || req.body.discogsId;
    if (!discogsId) {
      throw new PermanentRefreshError("Discogs ID missing");
    }
    const token = process.env.DISCOGS_TOKEN;
    const url = `https://api.discogs.com/releases/${discogsId}?token=${token}`;
    const data = await fetchJson(url, { headers: { 'Authorization': `Discogs token=${token}`, 'User-Agent': 'DVinylApp/2.0' } });

    // Re-attach user-authored per-track fields (rating, tags, notes, bpm, key,
    // cached lyrics) onto the fresh Discogs tracklist. Match by position+title,
    // then title alone (Discogs sometimes renumbers positions), then position
    // alone (the user may have corrected a title locally).
    const userFields = ['rating', 'tags', 'notes', 'bpm', 'key', 'lyrics'];
    const norm = (s: any) => String(s || '').trim().toLowerCase();
    const oldTracks: any[] = (item.tracklist || []).map((t: any) => t.toObject ? t.toObject() : t);
    const byPosTitle = new Map<string, any>();
    const byTitle = new Map<string, any>();
    const byPos = new Map<string, any>();
    for (const t of oldTracks) {
      byPosTitle.set(`${norm(t.position)}|${norm(t.title)}`, t);
      if (!byTitle.has(norm(t.title))) byTitle.set(norm(t.title), t);
      if (norm(t.position) && !byPos.has(norm(t.position))) byPos.set(norm(t.position), t);
    }
    const mergedTracklist = (data.tracklist || []).map((t: any) => {
      const old = byPosTitle.get(`${norm(t.position)}|${norm(t.title)}`)
        || byTitle.get(norm(t.title))
        || byPos.get(norm(t.position));
      if (!old) return t;
      const merged: any = { ...t };
      for (const f of userFields) {
        if (old[f] !== undefined && old[f] !== null) merged[f] = old[f];
      }
      return merged;
    });

    const updateData: any = {
      genres: data.genres || [],
      styles: data.styles || [],
      tracklist: mergedTracklist
    };

    if (!item.barcode_locked) {
      let barcode = '';
      if (data.identifiers && data.identifiers.length > 0) {
        const barcodeObj = data.identifiers.find((id: any) => id.type === 'Barcode');
        if (barcodeObj) {
          barcode = barcodeObj.value.replace(/\s/g, '');
        }
      }
      if (barcode) updateData.barcode = barcode;
    }

    if ((!item.genre || item.genre === '') && data.genres && data.genres.length > 0) {
      updateData.genre = data.genres[0];
    }

    // `kind` in the filter makes Mongoose cast against the Music discriminator
    // schema; without it, strict mode silently strips `tracklist` (not a base
    // Item path) and the refresh looks successful while persisting nothing.
    await Item.updateOne({ _id: item._id, kind: 'Music' }, { $set: { ...updateData, ...syncStamp() } });
    return updateData;
  }
};

export default musicPlugin;
