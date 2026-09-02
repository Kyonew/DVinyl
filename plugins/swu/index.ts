import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { SwuProvider, fetchSwuCard } from './swudb';
import { swuApiRoutes } from './apiRoutes';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, SWU_FORMATS } from './constants';

const swudb = new SwuProvider();

export const swuPlugin: PluginDefinition = {
  id: 'swu',
  kind: 'Swu',
  label: 'media.swu',
  i18nKey: 'swu',
  order: 120,
  externalIdField: 'swu_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_swu.set_name_label', field: 'set_name' },
  icon: 'jedi',
  routePrefix: '/swu-card',
  collectionType: 'swu',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: swudb,
  imageSearchType: 'swu',
  apiRoutes: swuApiRoutes,
  defaultCardFields: ['set_name', 'rarity'],

  collectionActions: [
    {
      id: 'estimate',
      label: 'index.btn_estimate',
      icon: 'fa-calculator',
      tooltip: 'index.btn_estimate',
      behavior: 'estimate',
      estimate: {
        idsEndpoint: '/api/swu/collection/ids',
        estimateEndpoint: '/api/swu/estimate',
        idField: 'swu_card_id',
        maxMultiplier: 1.3
      }
    }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await swudb.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  fastAddOptions: [
    { value: 'swu', label: 'media.swu', icon: 'fa-jedi', color: 'peer-checked:bg-red-600', url: '/add-swu' }
  ],

  navbarShortcuts: [
    { id: 'swu', label: 'media.swu', url: '/collection?type=swu' }
  ],

  statsWidgets: [
    { id: 'swu_total', label: 'stats.swu_total_label', icon: 'fa-jedi', color: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600', kind: 'count' },
    { id: 'swu_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'swu_aspect', label: 'stats.top_aspect_label', icon: 'fa-palette', color: 'bg-purple-100 dark:bg-purple-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    swu_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    rarity: { type: String, default: '' },
    card_type: { type: String, enum: SWU_FORMATS.map(f => f.value), default: 'Unit' },
    cost: { type: Number, default: 0 },
    power: { type: Number, default: 0 },
    hp: { type: Number, default: 0 },
    aspects: { type: [String], default: [] },
    traits: { type: [String], default: [] },
    arenas: { type: [String], default: [] },
    unique: { type: Boolean, default: false },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: SWU_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_swu.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_swu.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_swu.card_type_label', type: 'select',
      options: SWU_FORMATS.map(f => ({ value: f.value, label: f.label })),
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Unit' },
    { name: 'aspects', label: 'confirm_swu.aspects_label', type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'traits', label: 'confirm_swu.traits_label', type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'cost', label: 'confirm_swu.cost_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'power', label: 'confirm_swu.power_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'hp', label: 'confirm_swu.hp_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_swu.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'unique', label: 'confirm_swu.unique_label', type: 'boolean',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'card_condition', label: 'confirm_swu.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_swu.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_swu.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_swu.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  normalizeForSave(data: Record<string, any>): void {
    const aspects = Array.isArray(data.aspects) ? data.aspects.filter(Boolean) : [];
    data.genre = aspects[0] || '';
    data.genres = aspects;
  },

  cardBadge(item: any) {
    const opt = this.formats.find((f: any) => f.value === item.card_type);
    return { label: opt ? opt.label : 'media.swu', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
  },

  getStats(items: any[]): Record<string, any> {
    const qty = (i: any) => Number(i.quantity || 1);
    const getTop = (field: string) => {
      const map: Record<string, number> = {};
      let topName = 'N/A';
      let topCount = 0;
      items.forEach(item => {
        const value = Array.isArray(item[field]) ? item[field][0] : item[field];
        if (value) {
          map[value] = (map[value] || 0) + 1;
          if (map[value] > topCount) { topCount = map[value]; topName = value; }
        }
      });
      return { name: topName, count: topCount };
    };
    return {
      swu_total: items.reduce((acc, i) => acc + qty(i), 0),
      swu_set: getTop('set_name'),
      swu_aspect: getTop('aspects')
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
      card_type: obj.card_type || 'Unit',
      cost: obj.cost || 0,
      power: obj.power || 0,
      hp: obj.hp || 0,
      aspects: obj.aspects || [],
      traits: obj.traits || [],
      arenas: obj.arenas || [],
      unique: !!obj.unique,
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const swuId = (data.swu_card_id || '').trim();
    if (swuId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Swu', swu_card_id: swuId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Swu',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.swu_card_id) or.push({ swu_card_id: (data.swu_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Swu', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Swu',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: 'Unit', cost: 0, power: 0, hp: 0,
      aspects: [], traits: [], arenas: [], rarity: '', unique: false, card_condition: '',
      barcode: '', quantity: 1, comments: '', location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.swu_card_id) {
      throw new PermanentRefreshError('No SWU card id to refresh');
    }
    const card = await fetchSwuCard(item.swu_card_id);
    const aspects = card.Aspects || item.aspects;
    return {
      set_name: card.Set || item.set_name,
      rarity: card.Rarity || item.rarity,
      card_type: card.Type || item.card_type,
      cost: card.Cost ? parseInt(card.Cost, 10) : item.cost,
      power: card.Power ? parseInt(card.Power, 10) : item.power,
      hp: card.HP ? parseInt(card.HP, 10) : item.hp,
      aspects,
      traits: card.Traits || item.traits,
      arenas: card.Arenas || item.arenas,
      unique: card.Unique ?? item.unique,
      genre: aspects[0] || item.genre,
      genres: aspects.length ? aspects : item.genres,
      cover_image: card.FrontArt || item.cover_image
    };
  }
};

export default swuPlugin;
