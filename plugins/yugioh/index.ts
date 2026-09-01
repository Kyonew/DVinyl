import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { YgoprodeckProvider, fetchYgoprodeckCard } from './ygoprodeck';
import { cacheYugiohImage } from './imageCache';
import { yugiohApiRoutes } from './apiRoutes';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, YUGIOH_FORMATS, deriveYugiohFormat } from './constants';

const ygoprodeck = new YgoprodeckProvider();

export const yugiohPlugin: PluginDefinition = {
  id: 'yugioh',
  kind: 'Yugioh',
  label: 'media.yugioh',
  i18nKey: 'yugioh',
  order: 90,
  externalIdField: 'ygo_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_yugioh.set_name_label', field: 'set_name' },
  icon: 'dragon',
  routePrefix: '/yugioh-card',
  collectionType: 'yugioh',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: ygoprodeck,
  imageSearchType: 'yugioh',
  apiRoutes: yugiohApiRoutes,
  defaultCardFields: ['set_name', 'rarity'],
  // Hard rate limit (20 req/s -> 1hr block) is the strictest of the four APIs.
  bulkRefreshDelayMs: 150,

  collectionActions: [
    {
      id: 'estimate',
      label: 'index.btn_estimate',
      icon: 'fa-calculator',
      tooltip: 'index.btn_estimate',
      behavior: 'estimate',
      estimate: {
        idsEndpoint: '/api/yugioh/collection/ids',
        estimateEndpoint: '/api/yugioh/estimate',
        idField: 'ygo_card_id',
        maxMultiplier: 1.3
      }
    }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await ygoprodeck.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  externalLink(item: any) {
    if (!item.ygo_card_id) return null;
    const [numericId] = String(item.ygo_card_id).split('::');
    return { label: 'YGOPRODeck', url: `https://ygoprodeck.com/card/?search=${numericId}` };
  },

  fastAddOptions: [
    { value: 'yugioh', label: 'media.yugioh', icon: 'fa-dragon', color: 'peer-checked:bg-fuchsia-700', url: '/add-yugioh' }
  ],

  navbarShortcuts: [
    { id: 'yugioh', label: 'media.yugioh', url: '/collection?type=yugioh' }
  ],

  statsWidgets: [
    { id: 'yugioh_total', label: 'stats.yugioh_total_label', icon: 'fa-dragon', color: 'bg-fuchsia-100 dark:bg-fuchsia-900/30', text: 'text-fuchsia-700', kind: 'count' },
    { id: 'yugioh_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'yugioh_race', label: 'stats.top_race_label', icon: 'fa-paw', color: 'bg-orange-100 dark:bg-orange-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    ygo_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    rarity: { type: String, default: '' },
    card_type: { type: String, enum: YUGIOH_FORMATS.map(f => f.value), default: 'Monster' },
    race: { type: String, default: '' },
    attribute: { type: String, default: '' },
    atk: { type: Number, default: 0 },
    def: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: YUGIOH_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_yugioh.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_yugioh.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_yugioh.card_type_label', type: 'select',
      options: YUGIOH_FORMATS.map(f => ({ value: f.value, label: f.label })),
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Monster' },
    { name: 'race', label: 'confirm_yugioh.race_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'attribute', label: 'confirm_yugioh.attribute_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'atk', label: 'confirm_yugioh.atk_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'def', label: 'confirm_yugioh.def_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'level', label: 'confirm_yugioh.level_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_yugioh.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'card_condition', label: 'confirm_yugioh.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_yugioh.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_yugioh.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_yugioh.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  normalizeForSave(data: Record<string, any>): void {
    const race = (data.race || '').trim();
    data.genre = race;
    data.genres = race ? [race] : [];
  },

  cardBadge(item: any) {
    const opt = this.formats.find((f: any) => f.value === item.card_type);
    return { label: opt ? opt.label : 'media.yugioh', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
          if (map[name] > topCount) { topCount = map[name]; topName = name; }
        }
      });
      return { name: topName, count: topCount };
    };
    return {
      yugioh_total: items.reduce((acc, i) => acc + qty(i), 0),
      yugioh_set: getTop('set_name'),
      yugioh_race: getTop('race')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      set_name: obj.set_name || 'Unknown',
      cover_image: obj.cover_image || '/ressources/logo.png',
      rarity: obj.rarity || '',
      card_type: obj.card_type || 'Monster',
      race: obj.race || '',
      attribute: obj.attribute || '',
      atk: obj.atk || 0,
      def: obj.def || 0,
      level: obj.level || 0,
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const ygoId = (data.ygo_card_id || '').trim();
    if (ygoId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Yugioh', ygo_card_id: ygoId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Yugioh',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.ygo_card_id) or.push({ ygo_card_id: (data.ygo_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Yugioh', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Yugioh',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: 'Monster', race: '', attribute: '', atk: 0,
      def: 0, level: 0, rarity: '', card_condition: '', barcode: '', quantity: 1,
      comments: '', location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.ygo_card_id) {
      throw new PermanentRefreshError('No Yu-Gi-Oh card id to refresh');
    }
    const [numericId, setCode] = String(item.ygo_card_id).split('::');
    const card = await fetchYgoprodeckCard(numericId!);
    const printing = setCode ? (card.card_sets || []).find(s => s.set_code === setCode) : card.card_sets?.[0];
    const remoteImage = card.card_images?.[0]?.image_url || '';
    const cover_image = await cacheYugiohImage(numericId!, remoteImage);

    return {
      set_name: printing?.set_name || item.set_name,
      rarity: printing?.set_rarity || item.rarity,
      card_type: deriveYugiohFormat(card.type) || item.card_type,
      race: card.race || item.race,
      genre: card.race || item.genre,
      genres: card.race ? [card.race] : item.genres,
      attribute: card.attribute || item.attribute,
      atk: card.atk ?? item.atk,
      def: card.def ?? item.def,
      level: card.level ?? item.level,
      cover_image: cover_image || item.cover_image
    };
  }
};

export default yugiohPlugin;
