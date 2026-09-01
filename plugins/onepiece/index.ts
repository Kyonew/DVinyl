import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { OptcgapiProvider, fetchOnePieceCard } from './optcgapi';
import { onePieceApiRoutes } from './apiRoutes';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, ONEPIECE_FORMATS } from './constants';

const optcgapi = new OptcgapiProvider();

export const onePiecePlugin: PluginDefinition = {
  id: 'onepiece',
  kind: 'OnePiece',
  label: 'media.onepiece',
  i18nKey: 'onepiece',
  order: 100,
  externalIdField: 'op_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_onepiece.set_name_label', field: 'set_name' },
  icon: 'anchor',
  routePrefix: '/onepiece-card',
  collectionType: 'onepiece',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: optcgapi,
  imageSearchType: 'onepiece',
  apiRoutes: onePieceApiRoutes,
  defaultCardFields: ['set_name', 'rarity'],
  // No published rate-limit ceiling on a single-maintainer personal VPS — conservative
  // on purpose, precisely because there's no documented number to reason against.
  bulkRefreshDelayMs: 300,

  collectionActions: [
    {
      id: 'estimate',
      label: 'index.btn_estimate',
      icon: 'fa-calculator',
      tooltip: 'index.btn_estimate',
      behavior: 'estimate',
      estimate: {
        idsEndpoint: '/api/onepiece/collection/ids',
        estimateEndpoint: '/api/onepiece/estimate',
        idField: 'op_card_id',
        maxMultiplier: 1.3
      }
    }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await optcgapi.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  fastAddOptions: [
    { value: 'onepiece', label: 'media.onepiece', icon: 'fa-anchor', color: 'peer-checked:bg-red-600', url: '/add-onepiece' }
  ],

  navbarShortcuts: [
    { id: 'onepiece', label: 'media.onepiece', url: '/collection?type=onepiece' }
  ],

  statsWidgets: [
    { id: 'onepiece_total', label: 'stats.onepiece_total_label', icon: 'fa-anchor', color: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600', kind: 'count' },
    { id: 'onepiece_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'onepiece_color', label: 'stats.top_color_label', icon: 'fa-palette', color: 'bg-purple-100 dark:bg-purple-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    op_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    rarity: { type: String, default: '' },
    card_type: { type: String, enum: ONEPIECE_FORMATS.map(f => f.value), default: 'Character' },
    card_color: { type: String, default: '' },
    cost: { type: Number, default: 0 },
    power: { type: Number, default: 0 },
    counter: { type: Number, default: 0 },
    life: { type: Number, default: 0 },
    traits: { type: [String], default: [] },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: ONEPIECE_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_onepiece.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_onepiece.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_onepiece.card_type_label', type: 'select',
      options: ONEPIECE_FORMATS.map(f => ({ value: f.value, label: f.label })),
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Character' },
    { name: 'card_color', label: 'confirm_onepiece.color_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'cost', label: 'confirm_onepiece.cost_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'power', label: 'confirm_onepiece.power_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'counter', label: 'confirm_onepiece.counter_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'life', label: 'confirm_onepiece.life_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'traits', label: 'confirm_onepiece.traits_label', type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_onepiece.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'card_condition', label: 'confirm_onepiece.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_onepiece.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_onepiece.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_onepiece.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  normalizeForSave(data: Record<string, any>): void {
    const color = (data.card_color || '').trim();
    data.genre = color;
    data.genres = color ? [color] : [];
  },

  cardBadge(item: any) {
    const opt = this.formats.find((f: any) => f.value === item.card_type);
    return { label: opt ? opt.label : 'media.onepiece', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
      onepiece_total: items.reduce((acc, i) => acc + qty(i), 0),
      onepiece_set: getTop('set_name'),
      onepiece_color: getTop('card_color')
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
      card_type: obj.card_type || 'Character',
      card_color: obj.card_color || '',
      cost: obj.cost || 0,
      power: obj.power || 0,
      counter: obj.counter || 0,
      life: obj.life || 0,
      traits: obj.traits || [],
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const opId = (data.op_card_id || '').trim();
    if (opId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'OnePiece', op_card_id: opId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'OnePiece',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.op_card_id) or.push({ op_card_id: (data.op_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'OnePiece', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'OnePiece',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: 'Character', card_color: '', cost: 0,
      power: 0, counter: 0, life: 0, traits: [], rarity: '', card_condition: '',
      barcode: '', quantity: 1, comments: '', location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.op_card_id) {
      throw new PermanentRefreshError('No One Piece card id to refresh');
    }
    const card = await fetchOnePieceCard(item.op_card_id);
    return {
      set_name: card.set_name || item.set_name,
      rarity: card.rarity || item.rarity,
      card_type: card.card_type || item.card_type,
      card_color: card.card_color || item.card_color,
      genre: card.card_color || item.genre,
      genres: card.card_color ? [card.card_color] : item.genres,
      cost: card.card_cost ? parseInt(card.card_cost, 10) : item.cost,
      power: card.card_power ? parseInt(card.card_power, 10) : item.power,
      counter: card.counter_amount ?? item.counter,
      life: card.life ? parseInt(card.life, 10) : item.life,
      cover_image: card.card_image || item.cover_image
    };
  }
};

export default onePiecePlugin;
