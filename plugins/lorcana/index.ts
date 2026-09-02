import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { LorcanaProvider, fetchLorcanaCard, normalizeCardType } from './lorcana';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, LORCANA_FORMATS } from './constants';

const lorcanaApi = new LorcanaProvider();

export const lorcanaPlugin: PluginDefinition = {
  id: 'lorcana',
  kind: 'Lorcana',
  label: 'media.lorcana',
  i18nKey: 'lorcana',
  order: 110,
  externalIdField: 'lorcana_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_lorcana.set_name_label', field: 'set_name' },
  icon: 'wand-magic-sparkles',
  routePrefix: '/lorcana-card',
  collectionType: 'lorcana',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: lorcanaApi,
  imageSearchType: 'lorcana',
  defaultCardFields: ['set_name', 'rarity'],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await lorcanaApi.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  fastAddOptions: [
    { value: 'lorcana', label: 'media.lorcana', icon: 'fa-wand-magic-sparkles', color: 'peer-checked:bg-sky-600', url: '/add-lorcana' }
  ],

  navbarShortcuts: [
    { id: 'lorcana', label: 'media.lorcana', url: '/collection?type=lorcana' }
  ],

  statsWidgets: [
    { id: 'lorcana_total', label: 'stats.lorcana_total_label', icon: 'fa-wand-magic-sparkles', color: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-600', kind: 'count' },
    { id: 'lorcana_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'lorcana_color', label: 'stats.top_color_label', icon: 'fa-palette', color: 'bg-purple-100 dark:bg-purple-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    lorcana_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    ink_color: { type: String, default: '' },
    card_type: { type: String, enum: LORCANA_FORMATS.map(f => f.value), default: 'Character' },
    cost: { type: Number, default: 0 },
    lore: { type: Number, default: 0 },
    strength: { type: Number, default: 0 },
    willpower: { type: Number, default: 0 },
    inkable: { type: Boolean, default: false },
    classifications: { type: [String], default: [] },
    rarity: { type: String, default: '' },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: LORCANA_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_lorcana.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_lorcana.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_lorcana.card_type_label', type: 'select',
      options: LORCANA_FORMATS.map(f => ({ value: f.value, label: f.label })),
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Character' },
    { name: 'ink_color', label: 'confirm_lorcana.ink_color_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'cost', label: 'confirm_lorcana.cost_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'lore', label: 'confirm_lorcana.lore_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'strength', label: 'confirm_lorcana.strength_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'willpower', label: 'confirm_lorcana.willpower_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'inkable', label: 'confirm_lorcana.inkable_label', type: 'boolean',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'classifications', label: 'confirm_lorcana.classifications_label', type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_lorcana.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'card_condition', label: 'confirm_lorcana.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_lorcana.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_lorcana.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_lorcana.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  normalizeForSave(data: Record<string, any>): void {
    const color = (data.ink_color || '').trim();
    data.genre = color;
    data.genres = color ? [color] : [];
  },

  cardBadge(item: any) {
    const opt = this.formats.find((f: any) => f.value === item.card_type);
    return { label: opt ? opt.label : 'media.lorcana', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
      lorcana_total: items.reduce((acc, i) => acc + qty(i), 0),
      lorcana_set: getTop('set_name'),
      lorcana_color: getTop('ink_color')
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
      ink_color: obj.ink_color || '',
      cost: obj.cost || 0,
      lore: obj.lore || 0,
      strength: obj.strength || 0,
      willpower: obj.willpower || 0,
      inkable: !!obj.inkable,
      classifications: obj.classifications || [],
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const lorcanaId = (data.lorcana_card_id || '').trim();
    if (lorcanaId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Lorcana', lorcana_card_id: lorcanaId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Lorcana',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.lorcana_card_id) or.push({ lorcana_card_id: (data.lorcana_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Lorcana', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Lorcana',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: 'Character', ink_color: '', cost: 0,
      lore: 0, strength: 0, willpower: 0, inkable: false, classifications: [],
      rarity: '', card_condition: '', barcode: '', quantity: 1, comments: '',
      location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.lorcana_card_id) {
      throw new PermanentRefreshError('No Lorcana card id to refresh');
    }
    const card = await fetchLorcanaCard(item.lorcana_card_id);
    const color = card.Color || item.ink_color;
    return {
      set_name: card.Set_Name || item.set_name,
      rarity: card.Rarity || item.rarity,
      card_type: card.Type ? normalizeCardType(card.Type) : item.card_type,
      ink_color: color,
      genre: color,
      genres: color ? [color] : item.genres,
      cost: card.Cost ?? item.cost,
      lore: card.Lore ?? item.lore,
      strength: card.Strength ?? item.strength,
      willpower: card.Willpower ?? item.willpower,
      inkable: card.Inkable ?? item.inkable,
      cover_image: card.Image || item.cover_image
    };
  }
};

export default lorcanaPlugin;
