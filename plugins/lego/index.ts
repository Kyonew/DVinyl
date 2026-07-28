import { PluginDefinition } from '../../core/types';
import { escapeRegExp } from '../../core/helpers';
import Item from '../../models/Item';
import { RebrickableProvider } from './rebrickable';
import { themeBadgeColor } from './constants';

const rebrickable = new RebrickableProvider();

export const legoPlugin: PluginDefinition = {
  id: 'lego',
  kind: 'Lego',
  label: 'media.lego',
  i18nKey: 'lego',
  order: 50,
  externalIdField: 'set_num',
  creatorField: 'theme',
  creatorSearchFields: ['theme'],
  extraSearchFields: ['set_num'],
  summaryField: { label: 'confirm_lego.theme_label', field: 'theme' },
  externalLink(item: any) {
    if (item.rebrickable_url) return { label: 'Rebrickable', url: item.rebrickable_url };
    return item.set_num ? { label: 'Rebrickable', url: `https://rebrickable.com/sets/${item.set_num}/` } : null;
  },
  icon: 'cubes',
  routePrefix: '/lego',
  collectionType: 'lego',
  searchProvider: rebrickable,
  imageSearchType: 'lego',
  requiredEnvKeys: ['REBRICKABLE_API_KEY'],
  duplicateCheckFields: ['format'],
  partialsPath: 'plugins/lego/partials',
  detailZones: [
    { id: 'badge', partial: 'lego-status.ejs' },
    { id: 'sidebar', partial: 'status-blocks.ejs' }
  ],

  fastAddOptions: [
    { value: 'lego', label: 'media.lego', icon: 'fa-cubes', color: 'peer-checked:bg-red-600', url: '/add-lego' }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      return rebrickable.searchImages(query);
    }
  },

  navbarShortcuts: [
    { id: 'lego', label: 'media.legos', url: '/collection?type=lego' },
    { id: 'lego_sealed', label: 'confirm_lego.cond_sealed', url: '/collection?type=lego&format=sealed' },
    { id: 'lego_built', label: 'confirm_lego.cond_built', url: '/collection?type=lego&format=built' },
    { id: 'lego_starwars', label: 'Star Wars', url: '/collection?type=lego&genre=Star%20Wars' },
    { id: 'lego_technic', label: 'Technic', url: '/collection?type=lego&genre=Technic' },
    { id: 'lego_city', label: 'City', url: '/collection?type=lego&genre=City' },
    { id: 'lego_creator', label: 'Creator', url: '/collection?type=lego&genre=Creator' }
  ],

  statsWidgets: [
    { id: 'lego_total', label: 'stats.lego_total_label', icon: 'fa-cubes', color: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600', kind: 'count' },
    { id: 'lego_pieces', label: 'stats.lego_pieces_label', icon: 'fa-puzzle-piece', color: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600', kind: 'count' },
    { id: 'lego_minifigs', label: 'stats.lego_minifigs_label', icon: 'fa-person', color: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-600', kind: 'count' },
    { id: 'lego_sealed', label: 'stats.lego_sealed_label', icon: 'fa-box', color: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600', kind: 'count' },
    { id: 'lego_theme', label: 'stats.top_theme_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' }
  ],

  defaultCardFields: ['theme'],

  schemaDefinition: {
    set_num: { type: String, default: '' },
    theme: { type: String, default: '' },
    pieces: { type: Number, default: 0 },
    minifigs: { type: Number, default: 0 },
    rebrickable_url: { type: String, default: '' },
    format: {
      type: String,
      enum: ['sealed', 'built', 'dismantled', 'incomplete'],
      default: 'built'
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

  // Physical condition of the boxed set (drives the filter chips); the card badge
  // shows the LEGO theme instead (see cardBadge).
  formats: [
    { value: 'sealed', label: 'confirm_lego.cond_sealed', color: 'bg-emerald-600/90' },
    { value: 'built', label: 'confirm_lego.cond_built', color: 'bg-sky-600/90' },
    { value: 'dismantled', label: 'confirm_lego.cond_dismantled', color: 'bg-amber-600/90' },
    { value: 'incomplete', label: 'confirm_lego.cond_incomplete', color: 'bg-red-600/90' }
  ],

  formFields: [
    {
      name: 'title',
      label: 'confirm_lego.field_title',
      type: 'text',
      required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'set_num',
      label: 'confirm_lego.field_set_num',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.lego_set_num'
    },
    {
      name: 'theme',
      label: 'confirm_lego.field_theme',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'year',
      label: 'confirm_lego.field_year',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main',
      placeholder: 'placeholders.year'
    },
    {
      name: 'pieces',
      label: 'confirm_lego.field_pieces',
      type: 'number',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'main'
    },
    {
      name: 'minifigs',
      label: 'confirm_lego.field_minifigs',
      type: 'number',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata'
    },
    {
      name: 'format',
      label: 'confirm_lego.field_format',
      type: 'select',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main',
      options: [
        { value: 'sealed', label: 'confirm_lego.cond_sealed' },
        { value: 'built', label: 'confirm_lego.cond_built' },
        { value: 'dismantled', label: 'confirm_lego.cond_dismantled' },
        { value: 'incomplete', label: 'confirm_lego.cond_incomplete' }
      ]
    },
    {
      name: 'barcode',
      label: 'confirm_lego.field_barcode',
      type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'],
      group: 'metadata',
      placeholder: 'EAN...'
    },
    {
      name: 'quantity',
      label: 'confirm_lego.field_quantity',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'main'
    },
    {
      name: 'user_rating',
      label: 'confirm_lego.field_rating',
      type: 'number',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'Ex: 4'
    },
    {
      name: 'comments',
      label: 'confirm_lego.field_comments',
      type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'],
      group: 'metadata',
      placeholder: 'confirm_lego.comments_placeholder'
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
    const theme = item.theme || 'LEGO';
    return { label: theme, colorClass: themeBadgeColor(theme) };
  },

  // The theme is mirrored into genre/genres so the generic genre filter and the
  // theme-based navbar shortcuts work without a dedicated filter mechanism.
  normalizeForSave(data: Record<string, any>): void {
    const theme = (data.theme || '').trim();
    data.genre = theme;
    data.genres = theme ? [theme] : [];
  },

  getStats(items: any[]): Record<string, any> {
    const qty = (i: any) => Number(i.quantity || 1);

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
      lego_total: items.reduce((acc, i) => acc + qty(i), 0),
      lego_pieces: items.reduce((acc, i) => acc + Number(i.pieces || 0) * qty(i), 0),
      lego_minifigs: items.reduce((acc, i) => acc + Number(i.minifigs || 0) * qty(i), 0),
      lego_sealed: items.filter(i => (i.format || '') === 'sealed').reduce((acc, i) => acc + qty(i), 0),
      lego_theme: getTop('theme')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      theme: obj.theme || 'Unknown',
      cover_image: obj.cover_image || '/ressources/logo.png',
      year: obj.year || '',
      pieces: obj.pieces || 0,
      minifigs: obj.minifigs || 0,
      set_num: obj.set_num || '',
      format: obj.format || 'built',
      user_rating: obj.user_rating || 0,
      location: obj.location || '',
      quantity: obj.quantity || 1
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const setNum = (data.set_num || '').trim();
    const matchFormat = data.format || 'built';

    if (setNum) {
      const item = await Item.findOne({
        collection: collectionId,
        in_wishlist: false,
        kind: 'Lego',
        set_num: setNum,
        format: matchFormat
      });
      if (item) return item;
    }

    const matchTitle = (data.title || '').trim();
    const matchTheme = (data.theme || data.creator || '').trim();

    const query: any = {
      collection: collectionId,
      in_wishlist: false,
      kind: 'Lego',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') },
      format: matchFormat
    };
    if (matchTheme) {
      query.theme = { $regex: new RegExp(`^${escapeRegExp(matchTheme)}$`, 'i') };
    }
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    const setNum = (data.set_num || '').trim();
    if (setNum) {
      or.push({ set_num: setNum });
    }
    const title = (data.title || '').trim();
    if (title) {
      or.push({ title: { $regex: new RegExp(`^${escapeRegExp(title)}$`, 'i') } });
    }
    if (or.length === 0) return [];
    return Item.find({
      collection: collectionId,
      in_wishlist: false,
      kind: 'Lego',
      $or: or
    }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    const or: any[] = [];
    if (item.set_num) or.push({ set_num: item.set_num });
    or.push({ title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') } });
    return await Item.find({
      collection: item.collection,
      in_wishlist: false,
      kind: 'Lego',
      _id: { $ne: item._id },
      $or: or
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '',
      set_num: '',
      theme: '',
      year: '',
      pieces: 0,
      minifigs: 0,
      format: 'built',
      barcode: '',
      quantity: 1,
      user_rating: 0,
      comments: '',
      location: '',
      cover_image: '/ressources/logo.png',
      user_image: ''
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.set_num) {
      throw new Error('No LEGO set number to refresh');
    }

    const details = await rebrickable.getDetails(String(item.set_num), {});
    return {
      cover_image: details.cover_image || item.cover_image,
      theme: details.theme || item.theme,
      genre: details.theme || item.genre,
      genres: details.theme ? [details.theme] : item.genres,
      year: details.year || item.year,
      pieces: details.pieces || item.pieces,
      minifigs: details.minifigs != null ? details.minifigs : item.minifigs,
      rebrickable_url: details.rebrickable_url || item.rebrickable_url
    };
  }
};

export default legoPlugin;
