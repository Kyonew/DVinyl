import { PluginDefinition } from '../../core/types';
import { sourceFromProvider } from '../../core/sources';
import { db } from '../../core/db';
import { and, ci, eq, idOf, ne, or, Filter } from '../../core/db/query';
import { BggProvider } from './bgg';

const bgg = new BggProvider();

// The database this plugin has always searched. The migration attributes every item
// saved before sources existed to this id, so it must never change.
const bggSource = sourceFromProvider(bgg, {
  id: 'bgg',
  requiredEnvKeys: ['BGG_API_KEY'],
  itemUrl: (id: string) => `https://boardgamegeek.com/boardgame/${id}`,
  searchImages: (query: string) => bgg.searchImages(query)
});

export const boardGamesPlugin: PluginDefinition = {
  id: 'boardgames',
  kind: 'BoardGame',
  label: 'media.boardgames',
  i18nKey: 'boardgame',
  order: 60,
  icon: 'dice-d20',

  // BGG's XML API2 has no UPC/barcode lookup and its search indexes titles only,
  // so a scanned barcode can't be turned into anything useful - hide the affordance.
  noBarcodeScan: true,
  routePrefix: '/boardgame',
  collectionType: 'boardgames',

  externalIdField: 'bgg_id',
  externalLink(item: any) {
    return item.bgg_id ? { label: 'BoardGameGeek', url: `https://boardgamegeek.com/boardgame/${item.bgg_id}` } : null;
  },

  // Asking a member to sit down for a game: when and where, then whether it was played.
  requestTemplates: [{
    id: 'play',
    name: 'requests.templates.play.name',
    icon: 'dice',
    description: 'requests.templates.play.description',
    visibility: 'members',
    holder: 'none',
    fields: [
      { label: 'requests.templates.play.when', type: 'date', required: true },
      { label: 'requests.templates.play.where', type: 'text' }
    ],
    steps: [{ label: 'requests.templates.play.step_played' }]
  }],

  creatorField: 'designer',
  creatorSearchFields: ['designer', 'publisher'],
  extraSearchFields: ['bgg_id'],
  duplicateCheckFields: ['format'],
  summaryField: { label: 'confirm_boardgame.field_designer', field: 'designer' },

  sources: [bggSource],
  imageSearchType: 'boardgame',

  // BGG's XML API2 terms of use require the "Powered by BGG" logo, linked back to
  // BoardGameGeek, on any public-facing page that surfaces data pulled from it.
  partialsPath: 'plugins/boardgames/partials',
  searchFormPartial: 'search-form',
  detailZones: [
    { id: 'sidebar', partial: 'bgg-attribution.ejs' }
  ],

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

  storedFields: {
    bgg_id: { type: 'text', default: '' },
    designer: { type: 'text', default: '' },
    publisher: { type: 'text', default: '' },
    players: { type: 'text', default: '' },
    playtime: { type: 'text', default: '' },
    min_age: { type: 'number', default: 0 },
    bgg_rating: { type: 'number', default: 0 },
    format: { type: 'text', values: ['boxed', 'expansion', 'promo'], default: 'boxed' },
    user_rating: { type: 'number', min: 0, max: 5, default: 0 },
    genre: { type: 'text', default: '' },
    genres: { type: 'texts', default: [] },
    styles: { type: 'texts', default: [] },
    description: { type: 'text', default: '' }
  },

  formats: [
    { value: 'boxed', label: 'format.boxed', color: 'bg-emerald-600/90' },
    { value: 'expansion', label: 'format.expansion', color: 'bg-sky-600/90' },
    { value: 'promo', label: 'format.promo', color: 'bg-amber-600/90' }
  ],

  // A boxed game is shelved flat-side out, so its "thickness" is the box depth and its
  // "height" the side standing up: roughly a square 295mm box for a big game. Expansions
  // ship in the same footprint but a fraction of the depth, and a promo is a sleeve.
  spineSize: {
    boxed: { thickness: 75, height: 295, shape: 'box' },
    expansion: { thickness: 40, height: 240, shape: 'box' },
    promo: { thickness: 10, height: 120, shape: 'box' }
  },

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
    const owned = and(
      eq('collection', idOf(collectionId)),
      eq('in_wishlist', false),
      eq('kind', 'BoardGame'),
      eq('format', data.format || 'boxed')
    );

    if (bggId) {
      const item = await db.items.findOne(and(owned, eq('bgg_id', bggId)), { defaults: true });
      if (item) return item;
    }

    return db.items.findOne(and(owned, ci('title', (data.title || '').trim())), { defaults: true });
  },

  async findPotentialDuplicates(collectionId: any, data: Record<string, any>): Promise<any[]> {
    const matches: Filter[] = [];
    const bggId = (data.bgg_id || '').trim();
    if (bggId) matches.push(eq('bgg_id', bggId));
    const title = (data.title || '').trim();
    if (title) matches.push(ci('title', title));
    if (matches.length === 0) return [];
    return db.items.find(and(
      eq('collection', idOf(collectionId)),
      eq('in_wishlist', false),
      eq('kind', 'BoardGame'),
      or(...matches)
    ));
  },

  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return db.items.find(and(
      eq('collection', idOf(item.collection)),
      eq('in_wishlist', false),
      eq('kind', 'BoardGame'),
      ne('_id', idOf(item._id)),
      or(item.bgg_id ? eq('bgg_id', item.bgg_id) : null, ci('title', String(item.title ?? '')))
    ));
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

  mergeRefresh(item: any, details: any): Record<string, any> {
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
