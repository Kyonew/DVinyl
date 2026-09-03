import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { ScryfallProvider, fetchScryfallCard } from './scryfall';
import { mtgApiRoutes } from './apiRoutes';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, MTG_FORMATS, deriveMtgFormat, expandColors } from './constants';

const scryfall = new ScryfallProvider();

export const mtgPlugin: PluginDefinition = {
  id: 'mtg',
  kind: 'Mtg',
  label: 'media.mtg',
  i18nKey: 'mtg',
  order: 80,
  externalIdField: 'scryfall_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_mtg.set_name_label', field: 'set_name' },
  icon: 'hat-wizard',
  routePrefix: '/mtg-card',
  collectionType: 'mtg',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  supportsCardScan: true,
  searchProvider: scryfall,
  imageSearchType: 'mtg',
  apiRoutes: mtgApiRoutes,
  defaultCardFields: ['set_name', 'rarity'],
  // ~10 req/s Scryfall guideline (see spec) — same role music's 1500ms plays for Discogs.
  bulkRefreshDelayMs: 150,

  collectionActions: [
    {
      id: 'estimate',
      label: 'index.btn_estimate',
      icon: 'fa-calculator',
      tooltip: 'index.btn_estimate',
      behavior: 'estimate',
      estimate: {
        idsEndpoint: '/api/mtg/collection/ids',
        estimateEndpoint: '/api/mtg/estimate',
        idField: 'scryfall_id',
        maxMultiplier: 1.3
      }
    }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await scryfall.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  externalLink(item: any) {
    return item.scryfall_id
      ? { label: 'Scryfall', url: `https://scryfall.com/card/${item.scryfall_id}` }
      : null;
  },

  fastAddOptions: [
    { value: 'mtg', label: 'media.mtg', icon: 'fa-hat-wizard', color: 'peer-checked:bg-purple-600', url: '/add-mtg' }
  ],

  navbarShortcuts: [
    { id: 'mtg', label: 'media.mtg', url: '/collection?type=mtg' }
  ],

  statsWidgets: [
    { id: 'mtg_total', label: 'stats.mtg_total_label', icon: 'fa-hat-wizard', color: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600', kind: 'count' },
    { id: 'mtg_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'mtg_color', label: 'stats.top_color_label', icon: 'fa-palette', color: 'bg-emerald-100 dark:bg-emerald-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    scryfall_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    card_type: { type: String, enum: MTG_FORMATS.map(f => f.value), default: 'Creature' },
    rarity: { type: String, default: '' },
    artist: { type: String, default: '' },
    mana_cost: { type: String, default: '' },
    power: { type: String, default: '' },
    toughness: { type: String, default: '' },
    colors: { type: [String], default: [] },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: MTG_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_mtg.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_mtg.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_type', label: 'confirm_mtg.card_type_label', type: 'select',
      options: MTG_FORMATS.map(f => ({ value: f.value, label: f.label })),
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Creature' },
    { name: 'mana_cost', label: 'confirm_mtg.mana_cost_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata', placeholder: '{2}{U}{U}' },
    { name: 'power', label: 'confirm_mtg.power_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'toughness', label: 'confirm_mtg.toughness_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'rarity', label: 'confirm_mtg.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'artist', label: 'confirm_mtg.artist_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'colors', label: 'confirm_mtg.colors_label', type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata', placeholder: 'placeholders.mtg_colors' },
    { name: 'card_condition', label: 'confirm_mtg.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_mtg.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'quantity', label: 'confirm_mtg.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_mtg.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  normalizeForSave(data: Record<string, any>): void {
    const colors = Array.isArray(data.colors) ? data.colors.filter(Boolean) : [];
    data.genres = colors;
    data.genre = colors[0] || '';
  },

  cardBadge(item: any) {
    const opt = this.formats.find((f: any) => f.value === item.card_type);
    return { label: opt ? opt.label : 'media.mtg', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
      mtg_total: items.reduce((acc, i) => acc + qty(i), 0),
      mtg_set: getTop('set_name'),
      mtg_color: getTop('genre')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      set_name: obj.set_name || 'Unknown',
      cover_image: obj.cover_image || '/ressources/logo.png',
      card_type: obj.card_type || 'Creature',
      rarity: obj.rarity || '',
      artist: obj.artist || '',
      mana_cost: obj.mana_cost || '',
      power: obj.power || '',
      toughness: obj.toughness || '',
      colors: obj.colors || [],
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const scryfallId = (data.scryfall_id || '').trim();
    if (scryfallId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Mtg', scryfall_id: scryfallId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Mtg',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.scryfall_id) or.push({ scryfall_id: (data.scryfall_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Mtg', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Mtg',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_type: 'Creature', rarity: '', artist: '',
      mana_cost: '', power: '', toughness: '', colors: [], card_condition: '',
      barcode: '', quantity: 1, comments: '', location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.scryfall_id) {
      throw new PermanentRefreshError('No Scryfall id to refresh');
    }
    const card = await fetchScryfallCard(item.scryfall_id);
    const colors = expandColors(card.colors);
    return {
      set_name: card.set_name || item.set_name,
      card_type: deriveMtgFormat(card.type_line) || item.card_type,
      rarity: card.rarity || item.rarity,
      artist: card.artist || item.artist,
      power: card.power || item.power,
      toughness: card.toughness || item.toughness,
      colors,
      genre: colors[0] || item.genre,
      genres: colors.length ? colors : item.genres,
      cover_image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || item.cover_image
    };
  }
};

export default mtgPlugin;
