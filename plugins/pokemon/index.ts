import { PluginDefinition } from '../../core/types';
import { escapeRegExp, PermanentRefreshError } from '../../core/helpers';
import Item from '../../models/Item';
import { TcgdexProvider, fetchTcgdexCard } from './tcgdex';
import { pokemonApiRoutes } from './apiRoutes';
import { CARD_CONDITIONS, CARD_CONDITION_ENUM, POKEMON_FORMATS } from './constants';

const tcgdex = new TcgdexProvider();

export const pokemonPlugin: PluginDefinition = {
  id: 'pokemon',
  kind: 'Pokemon',
  label: 'media.pokemon',
  i18nKey: 'pokemon',
  order: 70,
  externalIdField: 'pokemon_card_id',
  creatorField: 'set_name',
  creatorSearchFields: ['set_name'],
  summaryField: { label: 'confirm_pokemon.set_name_label', field: 'set_name' },
  icon: 'circle-half-stroke',
  routePrefix: '/pokemon-card',
  collectionType: 'pokemon',
  aspectRatioClass: 'aspect-[5/7]',
  supportsBarcodeSearch: false,
  searchProvider: tcgdex,
  imageSearchType: 'pokemon',
  apiRoutes: pokemonApiRoutes,
  defaultCardFields: ['set_name', 'rarity'],

  collectionActions: [
    {
      id: 'estimate',
      label: 'index.btn_estimate',
      icon: 'fa-calculator',
      tooltip: 'index.btn_estimate',
      behavior: 'estimate',
      estimate: {
        idsEndpoint: '/api/pokemon/collection/ids',
        estimateEndpoint: '/api/pokemon/estimate',
        idField: 'pokemon_card_id',
        maxMultiplier: 1.3
      }
    }
  ],

  imageSearchProvider: {
    async search(query: string): Promise<string[]> {
      const results = await tcgdex.search(query, { limit: 12 });
      return results.map(r => r.cover_image).filter(Boolean) as string[];
    }
  },

  externalLink(item: any) {
    return item.pokemon_card_id
      ? { label: 'TCGdex', url: `https://www.tcgdex.net/cards/${item.pokemon_card_id}` }
      : null;
  },

  fastAddOptions: [
    { value: 'pokemon', label: 'media.pokemon', icon: 'fa-circle-half-stroke', color: 'peer-checked:bg-amber-600', url: '/add-pokemon' }
  ],

  navbarShortcuts: [
    { id: 'pokemon', label: 'media.pokemon', url: '/collection?type=pokemon' }
  ],

  statsWidgets: [
    { id: 'pokemon_total', label: 'stats.pokemon_total_label', icon: 'fa-circle-half-stroke', color: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600', kind: 'count' },
    { id: 'pokemon_set', label: 'stats.top_set_label', icon: 'fa-layer-group', color: 'bg-sky-100 dark:bg-sky-500/20', kind: 'top' },
    { id: 'pokemon_type', label: 'stats.top_type_label', icon: 'fa-fire', color: 'bg-emerald-100 dark:bg-emerald-500/20', kind: 'top' }
  ],

  schemaDefinition: {
    pokemon_card_id: { type: String, default: '' },
    set_name: { type: String, default: '' },
    card_number: { type: String, default: '' },
    category: { type: String, enum: ['Pokemon', 'Trainer', 'Energy'], default: 'Pokemon' },
    rarity: { type: String, default: '' },
    artist: { type: String, default: '' },
    hp: { type: Number, default: 0 },
    types: { type: [String], default: [] },
    card_condition: { type: String, enum: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: String, default: '' },
    genres: { type: [String], default: [] }
  },

  formats: POKEMON_FORMATS,

  formFields: [
    { name: 'title', label: 'confirm_pokemon.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'set_name', label: 'confirm_pokemon.set_name_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'card_number', label: 'confirm_pokemon.card_number_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main', placeholder: 'placeholders.pokemon_card_number' },
    { name: 'category', label: 'confirm_pokemon.category_label', type: 'radio-cards',
      options: [
        { value: 'Pokemon', label: 'format.pokemon_category_pokemon' },
        { value: 'Trainer', label: 'format.pokemon_category_trainer' },
        { value: 'Energy', label: 'format.pokemon_category_energy' }
      ],
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 'Pokemon' },
    { name: 'rarity', label: 'confirm_pokemon.rarity_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'artist', label: 'confirm_pokemon.artist_label', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata' },
    { name: 'hp', label: 'confirm_pokemon.hp_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'types', label: 'confirm_pokemon.types_label', type: 'tags',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'metadata', placeholder: 'placeholders.pokemon_types' },
    { name: 'card_condition', label: 'confirm_pokemon.condition_label', type: 'select',
      options: CARD_CONDITIONS, showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'barcode', label: 'confirm_pokemon.barcode_label', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.barcode' },
    { name: 'quantity', label: 'confirm_pokemon.quantity_label', type: 'number',
      showIn: ['edit', 'confirm', 'manual'], group: 'main', default: 1 },
    { name: 'comments', label: 'confirm_pokemon.comments_label', type: 'textarea',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'location', label: 'common.location', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata', placeholder: 'placeholders.location' }
  ],

  // types is user-editable via the `types` tags field; mirroring it into genre/genres
  // reuses the app's existing genre-filter/browse UI, the same trick LEGO uses for
  // theme. Runs on every create and edit, so a hand-edited types list keeps genre in
  // sync without a re-fetch.
  normalizeForSave(data: Record<string, any>): void {
    const types = Array.isArray(data.types) ? data.types.filter(Boolean) : [];
    data.genres = types;
    data.genre = types[0] || '';
  },

  cardBadge(item: any) {
    const opt = this.formats.find((f: any) => f.value === item.category);
    return { label: opt ? opt.label : 'media.pokemon', colorClass: (opt && opt.color) || 'bg-gray-600/90' };
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
      pokemon_total: items.reduce((acc, i) => acc + qty(i), 0),
      pokemon_set: getTop('set_name'),
      pokemon_type: getTop('genre')
    };
  },

  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      set_name: obj.set_name || 'Unknown',
      cover_image: obj.cover_image || '/ressources/logo.png',
      card_number: obj.card_number || '',
      category: obj.category || 'Pokemon',
      rarity: obj.rarity || '',
      artist: obj.artist || '',
      hp: obj.hp || 0,
      types: obj.types || [],
      card_condition: obj.card_condition || '',
      quantity: obj.quantity || 1,
      location: obj.location || ''
    };
  },

  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const cardId = (data.pokemon_card_id || '').trim();
    if (cardId) {
      const item = await Item.findOne({
        collection: collectionId, in_wishlist: false, kind: 'Pokemon', pokemon_card_id: cardId
      });
      if (item) return item;
    }
    const matchTitle = (data.title || '').trim();
    const matchSet = (data.set_name || '').trim();
    const query: any = {
      collection: collectionId, in_wishlist: false, kind: 'Pokemon',
      title: { $regex: new RegExp(`^${escapeRegExp(matchTitle)}$`, 'i') }
    };
    if (matchSet) query.set_name = { $regex: new RegExp(`^${escapeRegExp(matchSet)}$`, 'i') };
    return await Item.findOne(query);
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const or: any[] = [];
    if (data.pokemon_card_id) or.push({ pokemon_card_id: (data.pokemon_card_id + '').trim() });
    if (data.title) or.push({ title: { $regex: new RegExp(`^${escapeRegExp(String(data.title).trim())}$`, 'i') } });
    if (or.length === 0) return [];
    return Item.find({ collection: collectionId, in_wishlist: false, kind: 'Pokemon', $or: or }).lean();
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection, in_wishlist: false, kind: 'Pokemon',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  },

  getManualDefaults(): Record<string, any> {
    return {
      title: '', set_name: '', card_number: '', category: 'Pokemon', rarity: '',
      artist: '', hp: 0, types: [], card_condition: '', barcode: '', quantity: 1,
      comments: '', location: '', cover_image: '/ressources/logo.png'
    };
  },

  async refreshItem(item: any): Promise<Record<string, any>> {
    if (!item.pokemon_card_id) {
      throw new PermanentRefreshError('No Pokemon TCG card id to refresh');
    }
    const card = await fetchTcgdexCard(item.pokemon_card_id);
    const types = card.types || [];
    return {
      set_name: card.set?.name || item.set_name,
      card_number: card.localId || item.card_number,
      category: card.category || item.category,
      rarity: card.rarity || item.rarity,
      artist: card.illustrator || item.artist,
      hp: card.hp || item.hp,
      types,
      genre: types[0] || item.genre,
      genres: types.length ? types : item.genres,
      cover_image: card.image ? `${card.image}/high.webp` : item.cover_image
    };
  }
};

export default pokemonPlugin;
