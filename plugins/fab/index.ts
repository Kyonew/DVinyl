import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { FabProvider, fetchFabCard } from './goagain';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, FAB_FORMATS } from './constants';

const goagain = new FabProvider();

export const fabPlugin: PluginDefinition = {
  id: 'fab',
  kind: 'Fab',
  label: 'media.fab',
  i18nKey: 'fab',
  order: 140,
  externalIdField: 'fab_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_fab.set_name_label', field: 'set_name' },
  icon: 'khanda',
  routePrefix: '/fab-card',
  collectionType: 'fab',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: goagain,
  imageSearchType: 'fab',
  defaultCardFields: ['set_name', 'rarity'],

  // No apiRoutes and no collectionActions: goagain.dev carries no price data. Each
  // printing does expose a `tcgplayer_product_id` (see goagain.ts's live-verified
  // shape), but turning that into an actual price needs TCGplayer's paid partner API
  // — out of scope here, same precedented shape as plugins/books, dvds, games, lego.

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await goagain.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  fastAddOptions: [
    { value: 'fab', label: 'media.fab', icon: 'fa-khanda', color: 'peer-checked:bg-red-600', url: '/add-fab' }
  ],

  navbarShortcuts: [
    { id: 'fab', label: 'media.fab', url: '/collection?type=fab' }
  ],

  statsWidgets: [
    { id: 'fab_total', label: 'stats.fab_total_label', icon: 'fa-khanda', color: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-600', kind: 'count' },
    { id: 'fab_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'fab_color', label: 'stats.top_color_label', icon: 'fa-palette', color: 'bg-amber-100 dark:bg-amber-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    fab_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    // Free text (holds card.type_text, e.g. "Ninja Attack Reaction" / "Warrior Hero -
    // Young") — compound and free-form, not a fixed enum. See constants.ts's comment.
    card_type: { type: String, default: '' },
    card_color: { type: String, enum: ['', ...FAB_FORMATS.map(f => f.value)], default: '' },
    pitch: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    power: { type: Number, default: 0 },
    defense: { type: Number, default: 0 },
    rarity: { type: String, default: '' },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: FAB_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_fab.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_fab.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_fab.card_type_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_color', label: 'confirm_fab.color_label', type: 'select',
      options: [{ value: '', label: 'confirm_fab.color_none' }, ...FAB_FORMATS.map(f => ({ value: f.value, label: f.label }))],
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', default: '' },
    { name: 'pitch', label: 'confirm_fab.pitch_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'cost', label: 'confirm_fab.cost_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'power', label: 'confirm_fab.power_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'defense', label: 'confirm_fab.defense_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_fab.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'card_condition', label: 'confirm_fab.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_fab.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_fab.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_fab.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  normalizeForSave(data: Record<string, any>): void {
    const color = (data.card_color || '').trim();
    // Guarded (unlike onepiece's unconditional mirror): a colorless Hero/equipment
    // card leaves both genre fields blank instead of storing an empty-string genre.
    if (color) {
      data.genre = color;
      data.genres = [color];
    } else {
      data.genre = '';
      data.genres = [];
    }
  },

  cardBadge(item: any) {
    // Keyed off card_color, not card_type — the deliberate per-plugin deviation
    // explained in constants.ts's comment. A colorless card (Hero/equipment) simply
    // finds nothing here and falls through to the generic gray badge below.
    const opt = this.formats.find((f: any) => f.value === item.card_color);
    return { label: opt ? opt.label : 'media.fab', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
      fab_total: items.reduce((acc, i) => acc + qty(i), 0),
      fab_set: getTop('set_name'),
      fab_color: getTop('card_color')
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
      card_type: obj.card_type || '',
      card_color: obj.card_color || '',
      pitch: obj.pitch || 0,
      cost: obj.cost || 0,
      power: obj.power || 0,
      defense: obj.defense || 0,
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const fabId = (data.fab_card_id || '').trim();
    if (fabId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Fab', fab_card_id: fabId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Fab',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.fab_card_id) or.push({ fab_card_id: (data.fab_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Fab', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Fab',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: '', card_color: '', pitch: 0, cost: 0,
      power: 0, defense: 0, rarity: '', card_condition: '',
      barcode: '', quantity: 1, comments: '', location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.fab_card_id) {
      throw new PermanentRefreshError('No Flesh and Blood card id to refresh');
    }
    const { card, printing } = await fetchFabCard(item.fab_card_id);
    const color = card.color || '';
    return {
      set_name: printing.set_id || item.set_name,
      rarity: printing.rarity || item.rarity,
      card_type: card.type_text || item.card_type,
      card_color: color || item.card_color,
      genre: color || item.genre,
      genres: color ? [color] : item.genres,
      pitch: card.pitch ? parseInt(card.pitch, 10) : item.pitch,
      cost: card.cost ? parseInt(card.cost, 10) : item.cost,
      power: card.power ? parseInt(card.power, 10) : item.power,
      defense: card.defense ? parseInt(card.defense, 10) : item.defense,
      cover_image: printing.image_url || item.cover_image
    };
  }
};

export default fabPlugin;
