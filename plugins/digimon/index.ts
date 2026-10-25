import { PluginDefinition } from '../../core/types';
import { PermanentRefreshError } from '../../core/helpers';
import { db } from '../../core/db';
import { and, ci, eq, idOf, ne, or, Filter } from '../../core/db/query';
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
  supportsCardScan: true,
  searchProvider: digimoncard,
  imageSearchType: 'digimon',
  defaultCardFields: ['set_name', 'rarity'],
  // digimoncard.io documents a hard 15 requests / 10 seconds ceiling, and exceeding it
  // blocks the caller for an hour - unlike onepiece's undocumented-ceiling VPS, this
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

  duplicateCheckFields: ['card_condition'],

  storedFields: {
    digimon_card_id: { type: 'text', default: '' },
    set_name: { type: 'text', default: '' },
    rarity: { type: 'text', default: '' },
    card_type: { type: 'text', values: DIGIMON_FORMATS.map(f => f.value), default: 'Digimon' },
    card_color: { type: 'text', default: '' },
    level: { type: 'number', default: 0 },
    dp: { type: 'number', default: 0 },
    play_cost: { type: 'number', default: 0 },
    form: { type: 'text', default: '' },
    attribute: { type: 'text', default: '' },
    digi_type: { type: 'text', default: '' },
    card_condition: { type: 'text', values: ['', ...CARD_CONDITION_ENUM], default: '' },
    genre: { type: 'text', default: '' },
    genres: { type: 'texts', default: [] }
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
    const owned = and(
      eq('collection', idOf(collectionId)),
      eq('in_wishlist', false),
      eq('kind', 'Digimon'),
      eq('card_condition', String(data.card_condition || ''))
    );

    // A card picked from DigimonCard.io is that exact printing: another one sharing its name
    // and set (an alternate art, a promo) is a different card, never a second copy.
    const cardId = String(data.digimon_card_id || '').trim();
    if (cardId) return db.items.findOne(and(owned, eq('digimon_card_id', cardId)), { defaults: true });

    const matchSet = String(data.set_name || '').trim();
    return db.items.findOne(and(
      owned,
      ci('title', String(data.title || '').trim()),
      matchSet ? ci('set_name', matchSet) : null
    ), { defaults: true });
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const matches: Filter[] = [];
    const cardId = String(data.digimon_card_id || '').trim();
    if (cardId) matches.push(eq('digimon_card_id', cardId));
    const title = String(data.title || '').trim();
    if (title) matches.push(ci('title', title));
    if (matches.length === 0) return [];
    return db.items.find(and(
      eq('collection', idOf(collectionId)),
      eq('in_wishlist', false),
      eq('kind', 'Digimon'),
      or(...matches)
    ));
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return db.items.find(and(
      eq('collection', idOf(item.collection)),
      eq('in_wishlist', false),
      eq('kind', 'Digimon'),
      ne('_id', idOf(item._id)),
      ci('title', String(item.title ?? ''))
    ));
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
