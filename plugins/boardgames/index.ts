import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { BggProvider } from './bgg';

const bgg = new BggProvider();

export const boardGamesPlugin: PluginDefinition = {
  id: 'boardgames',
  kind: 'BoardGame',
  label: 'media.boardgames',
  i18nKey: 'boardgame',
  order: 60,
  icon: 'dice-d20',
  routePrefix: '/boardgame',
  collectionType: 'boardgames',

  externalIdField: 'bgg_id',
  externalLink(item: any) {
    return item.bgg_id ? { label: 'BoardGameGeek', url: `https://boardgamegeek.com/boardgame/${item.bgg_id}` } : null;
  },

  creatorField: 'designer',
  creatorSearchFields: ['designer', 'publisher'],
  extraSearchFields: ['bgg_id'],
  summaryField: { label: 'confirm_boardgame.field_designer', field: 'designer' },

  searchProvider: bgg,
  imageSearchType: 'boardgame',
  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      return bgg.searchImages(query);
    }
  },
  requiredEnvKeys: ['BGG_API_KEY'],

  fastAddOptions: [
    { value: 'boardgame', label: 'media.boardgames', icon: 'fa-dice-d20', color: 'peer-checked:bg-emerald-600', url: '/add-boardgames' }
  ],

  navbarShortcuts: [
    { id: 'boardgames', label: 'media.boardgames', url: '/collection?type=boardgames' },
    { id: 'boardgames_expansion', label: 'format.expansion', url: '/collection?type=boardgames&format=expansion' }
  ],

  statsWidgets: [
    { id: 'boardgames_total', label: 'stats.boardgames_total_label', icon: 'fa-dice-d20', color: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600', kind: 'count' },
    { id: 'boardgames_designer', label: 'stats.top_designer_label', icon: 'fa-pen-nib', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' }
  ],

  defaultCardFields: ['designer', 'players'],

  schemaDefinition: {
    bgg_id: { type: String, default: '' },
    designer: { type: String, default: '' },
    publisher: { type: String, default: '' },
    players: { type: String, default: '' },
    playtime: { type: String, default: '' },
    min_age: { type: Number, default: 0 },
    bgg_rating: { type: Number, default: 0 },
    format: {
      type: String,
      enum: ['boxed', 'expansion', 'promo'],
      default: 'boxed'
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
    { value: 'boxed', label: 'format.boxed', color: 'bg-emerald-600/90' },
    { value: 'expansion', label: 'format.expansion', color: 'bg-sky-600/90' },
    { value: 'promo', label: 'format.promo', color: 'bg-amber-600/90' }
  ],

  formFields: [
    { name: 'title', label: 'confirm_boardgame.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'designer', label: 'confirm_boardgame.field_designer', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'publisher', label: 'confirm_boardgame.field_publisher', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'year', label: 'confirm_boardgame.field_year', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main', placeholder: 'placeholders.year' },
    { name: 'players', label: 'confirm_boardgame.field_players', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata', placeholder: 'Ex: 2-4' },
    { name: 'playtime', label: 'confirm_boardgame.field_playtime', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata', placeholder: 'Ex: 60' },
    { name: 'min_age', label: 'confirm_boardgame.field_min_age', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'format', label: 'confirm_boardgame.field_format', type: 'select',
      showIn: ['edit', 'confirm', 'manual'], group: 'main',
      options: [
        { value: 'boxed', label: 'format.boxed' },
        { value: 'expansion', label: 'format.expansion' },
        { value: 'promo', label: 'format.promo' }
      ] },
    { name: 'barcode', label: 'confirm_boardgame.field_barcode', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata', placeholder: 'EAN...' },
    { name: 'quantity', label: 'confirm_boardgame.field_quantity', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main' },
    { name: 'user_rating', label: 'confirm_boardgame.field_rating', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'Ex: 4' },
    { name: 'comments', label: 'confirm_boardgame.field_comments', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'confirm_boardgame.comments_placeholder' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  cardBadge(item: any) {
    const labels: Record<string, string> = { boxed: 'Boxed', expansion: 'Expansion', promo: 'Promo' };
    const format = item.format || 'boxed';
    const colors: Record<string, string> = { boxed: 'bg-emerald-600/90', expansion: 'bg-sky-600/90', promo: 'bg-amber-600/90' };
    return { label: labels[format] || format, colorClass: colors[format] || 'bg-gray-600/90' };
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
      boardgames_total: items.reduce((acc, i) => acc + qty(i), 0),
      boardgames_designer: getTop('designer')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      designer: obj.designer || 'Unknown',
      publisher: obj.publisher || '',
      cover_image: obj.cover_image || '/ressources/logo.png',
      players: obj.players || '',
      playtime: obj.playtime || '',
      min_age: obj.min_age || 0,
      bgg_rating: obj.bgg_rating || 0,
      format: obj.format || 'boxed',
      user_rating: obj.user_rating || 0,
      location: obj.location || '',
      quantity: obj.quantity || 1
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const bggId = (data.bgg_id || '').trim();
    const matchFormat = data.format || 'boxed';

    if (bggId) {
      const item = await Item.findOne({
        collection: collectionId,
        in_wishlist: false,
        kind: 'BoardGame',
        bgg_id: bggId,
        format: matchFormat
      });
      if (item) return item;
    }

    const matchTitle = (data.title || '').trim();
    return await Item.findOne({
      collection: collectionId,
      in_wishlist: false,
      kind: 'BoardGame',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') },
      format: matchFormat
    });
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    const bggId = (data.bgg_id || '').trim();
    if (bggId) or.push({ bgg_id: bggId });
    const title = (data.title || '').trim();
    if (title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(title)}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({
      collection: collectionId,
      in_wishlist: false,
      kind: 'BoardGame',
      $or: or
    }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    const or: any[] = [];
    if (item.bgg_id) or.push({ bgg_id: item.bgg_id });
    or.push({ title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') } });
    return await Item.find({
      collection: item.collection,
      in_wishlist: false,
      kind: 'BoardGame',
      _id: { $ne: item._id },
      $or: or
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '',
      bgg_id: '',
      designer: '',
      publisher: '',
      year: '',
      players: '',
      playtime: '',
      min_age: 0,
      format: 'boxed',
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
    if (!item.bgg_id) {
      throw new PermanentRefreshError('No BoardGameGeek id to refresh');
    }

    const details = await bgg.getDetails(String(item.bgg_id), {});
    return {
      cover_image: details.cover_image || item.cover_image,
      designer: details.designer || item.designer,
      publisher: details.publisher || item.publisher,
      players: details.players || item.players,
      playtime: details.playtime || item.playtime,
      min_age: details.min_age != null ? details.min_age : item.min_age,
      year: details.year || item.year,
      description: details.description || item.description,
      bgg_rating: details.bgg_rating != null ? details.bgg_rating : item.bgg_rating
    };
  }
};

export default boardGamesPlugin;
