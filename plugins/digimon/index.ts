import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { DigimonProvider, fetchDigimonCard } from './digimoncard';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, DIGIMON_FORMATS } from './constants';

const digimoncard = new DigimonProvider();

export const digimonPlugin: PluginDefinition = {
  id: 'digimon',
  kind: 'Digimon',
  label: 'media.digimon',
  i18nKey: 'digimon',
  order: 130,
  externalIdField: 'digimon_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_digimon.set_name_label', field: 'set_name' },
  icon: 'dragon',
  routePrefix: '/digimon-card',
  collectionType: 'digimon',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: digimoncard,
  imageSearchType: 'digimon',
  defaultCardFields: ['set_name', 'rarity'],
  // digimoncard.io documents a hard 15 requests / 10 seconds ceiling, and exceeding it
  // blocks the caller for an hour — unlike onepiece's undocumented-ceiling VPS, this
  // number is real and must be respected: ~667ms/request, rounded up for headroom.
  bulkRefreshDelayMs: 700,

  // No collectionActions: the free API has no price data (same shape as
  // plugins/books, plugins/dvds, plugins/games, plugins/lego).

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await digimoncard.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  fastAddOptions: [
    { value: 'digimon', label: 'media.digimon', icon: 'fa-dragon', color: 'peer-checked:bg-orange-600', url: '/add-digimon' }
  ],

  navbarShortcuts: [
    { id: 'digimon', label: 'media.digimon', url: '/collection?type=digimon' }
  ],

  statsWidgets: [
    { id: 'digimon_total', label: 'stats.digimon_total_label', icon: 'fa-dragon', color: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600', kind: 'count' },
    { id: 'digimon_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'digimon_color', label: 'stats.top_color_label', icon: 'fa-palette', color: 'bg-purple-100 dark:bg-purple-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    digimon_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    rarity: { type: String, default: '' },
    card_type: { type: String, enum: DIGIMON_FORMATS.map(f => f.value), default: 'Digimon' },
    card_color: { type: String, default: '' },
    level: { type: Number, default: 0 },
    dp: { type: Number, default: 0 },
    play_cost: { type: Number, default: 0 },
    form: { type: String, default: '' },
    attribute: { type: String, default: '' },
    digi_type: { type: String, default: '' },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: DIGIMON_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_digimon.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_digimon.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_digimon.card_type_label', type: 'select',
      options: DIGIMON_FORMATS.map(f => ({ value: f.value, label: f.label })),
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Digimon' },
    { name: 'card_color', label: 'confirm_digimon.color_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'level', label: 'confirm_digimon.level_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'dp', label: 'confirm_digimon.dp_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'play_cost', label: 'confirm_digimon.play_cost_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'form', label: 'confirm_digimon.form_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'attribute', label: 'confirm_digimon.attribute_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'digi_type', label: 'confirm_digimon.digi_type_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_digimon.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'card_condition', label: 'confirm_digimon.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_digimon.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_digimon.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_digimon.comments_label', type: 'textarea',
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
    return { label: opt ? opt.label : 'media.digimon', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
      digimon_total: items.reduce((acc, i) => acc + qty(i), 0),
      digimon_set: getTop('set_name'),
      digimon_color: getTop('card_color')
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
      card_type: obj.card_type || 'Digimon',
      card_color: obj.card_color || '',
      level: obj.level || 0,
      dp: obj.dp || 0,
      play_cost: obj.play_cost || 0,
      form: obj.form || '',
      attribute: obj.attribute || '',
      digi_type: obj.digi_type || '',
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const digimonId = (data.digimon_card_id || '').trim();
    if (digimonId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Digimon', digimon_card_id: digimonId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Digimon',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.digimon_card_id) or.push({ digimon_card_id: (data.digimon_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Digimon', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Digimon',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: 'Digimon', card_color: '', level: 0,
      dp: 0, play_cost: 0, form: '', attribute: '', digi_type: '', rarity: '',
      card_condition: '', barcode: '', quantity: 1, comments: '', location: '',
      cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.digimon_card_id) {
      throw new PermanentRefreshError('No Digimon card id to refresh');
    }
    const card = await fetchDigimonCard(item.digimon_card_id);
    const setName = (card.set_name || [])[0];
    return {
      set_name: setName || item.set_name,
      rarity: card.rarity || item.rarity,
      card_type: card.type || item.card_type,
      card_color: card.color || item.card_color,
      genre: card.color || item.genre,
      genres: card.color ? [card.color] : item.genres,
      level: card.level || item.level,
      dp: card.dp || item.dp,
      play_cost: card.play_cost || item.play_cost,
      form: card.form || item.form,
      attribute: card.attribute || item.attribute,
      digi_type: card.digi_type || item.digi_type,
      cover_image: `https://images.digimoncard.io/images/cards/${encodeURIComponent(card.id)}.jpg`
    };
  }
};

export default digimonPlugin;
