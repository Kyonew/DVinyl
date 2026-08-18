import mongoose from 'mongoose';

export interface PluginDefinition {
  id: string;
  kind: string;
  label: string;
  icon: string;
  routePrefix: string;
  collectionType: string;

  // Suffix for the legacy i18n key families (add_vinyl, edit_book, confirm_game...)
  i18nKey: string;

  // Display order (navbar, tabs, widgets, admin), ascending. Default 100.
  order?: number;

  // Enabled by default on a fresh install (default false, opt-in)
  enabledByDefault?: boolean;

  // Declarative properties that keep the core agnostic

  // Field holding the external API id (discogs_id, tmdb_id, igdb_id, hardcover_slug)
  externalIdField?: string;

  // "Source" link shown on the detail page (Discogs, TMDB, Hardcover...)
  externalLink?(item: any): { label: string; url: string } | null;

  // Extra fields scanned by the collection's "creator" filter (e.g. label, publisher, studio)
  creatorSearchFields?: string[];

  // Summary field shown in the confirm page's left column (label/publisher/studio)
  summaryField?: { label: string; field: string };

  // This plugin absorbs old items with no `kind` field (pre-plugins compat, music)
  matchesLegacyItems?: boolean;

  // Extra URL keywords for type detection (e.g. vinyl, cd, discogs)
  pathAliases?: string[];

  // Anti rate-limit delay between two items during a bulk refresh (ms, default 500)
  bulkRefreshDelayMs?: number;

  // Shows the price estimate block on the detail page (needs externalIdField + an /api/estimate apiRoute)
  supportsPriceEstimate?: boolean;

  // Format badge shown on cards (collection/wishlist/dashboard).
  // If absent, the core derives label+color from `formats` and the item's format.
  cardBadge?(item: any, settings?: any): { label: string; colorClass: string };

  // Fields shown under the cover on cards, in this order (see cardFields.ts).
  // Defaults to the creator field alone. Capped at MAX_CARD_LINES.
  defaultCardFields?: string[];

  // Per-field presentation on cards; 'text' (default) is a plain line.
  cardFieldStyles?: Record<string, 'text' | 'pill' | 'dot'>;

  // Rewrites a field's card value (e.g. trimming redundant words). Returning null or
  // undefined leaves the generic reading in place; an empty string drops the line.
  cardFieldValue?(name: string, item: any): string | null | undefined;

  schemaDefinition: mongoose.SchemaDefinition;

  formFields: FieldDefinition[];

  formats: FormatOption[];

  creatorField: string;

  extraSearchFields?: string[];

  searchProvider?: SearchProvider;

  // Custom EJS partial rendered in the search form ('top' and 'bottom' zones)
  searchFormPartial?: string;

  imageSearchProvider?: ImageSearchProvider;

  // Value of the `type` param for /admin/api/search-image-universal ('music', 'book', 'movie', 'game')
  imageSearchType?: string;

  supportsBarcodeSearch?: boolean;

  // Noise terms stripped from the title returned by the barcode lookup (e.g. 'DVD', 'Blu-ray', 'PS5'),
  // to sharpen the external search query. Plugin-specific (keeps the core agnostic).
  barcodeNoiseTerms?: string[];

  // CSS aspect-ratio class for the preview (e.g. 'aspect-square' for music), default 'aspect-[2/3]'
  aspectRatioClass?: string;

  // Image shown for items with no cover of their own. Resolved at render time (see
  // registry.ts), so changing it updates every coverless item at once.
  // Defaults to DEFAULT_PLACEHOLDER_IMAGE when absent.
  placeholderImage?: string;

  // Shows the secondary image editor (user_image) in confirm/manual/edit
  supportsUserImage?: boolean;

  // Endpoint (relative to baseUrl) feeding the editor's secondary "disc" image gallery.
  // Only relevant if supportsUserImage. Ex: music -> '/api/search-discogs-gallery'
  secondaryImageSearchPath?: string;

  // FontAwesome icon of the secondary image upload zone, default 'fa-image'.
  // Only relevant if supportsUserImage. Ex: music -> 'fa-compact-disc'
  secondaryImageIcon?: string;

  // i18n keys naming the two images on the item page badge. Defaults to the neutral
  // generic.main_image / generic.secondary_image, so a plugin only declares this when
  // its media has a more precise word (music -> "Official cover" / "Additional image").
  imageLabels?: { main: string; secondary: string };

  getStats(items: any[]): PluginStats;

  formatForView(item: any): any;

  // Duplicate detection is scoped to a single collection (each collection is an
  // independent container: the same item may exist in two collections separately).
  findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null>;

  // Broader duplicate candidates for the confirm page's warning banner
  // (e.g. same discogs_id OR same title+artist, without filtering by format)
  findPotentialDuplicates?(collectionId: any, data: Record<string, any>): Promise<any[]>;

  // Form fields the duplicate warning depends on (e.g. ['media_type','variant_color'])
  duplicateCheckFields?: string[];

  // Extra fields copied onto the existing record when merging a duplicate,
  // on top of externalIdField and barcode (e.g. books -> ['isbn']).
  backfillFields?: string[];

  // Shortcuts offered for the navbar (personalisation); ids are stored in settings.navbarShortcuts
  navbarShortcuts?: NavbarShortcut[];

  // Stats widgets offered for the dashboard; ids are stored in settings.statsWidgets
  // and must match the keys returned by getStats()
  statsWidgets?: StatWidget[];

  // Bulk imports specific to the plugin, mounted on POST /import/{id}
  importers?: PluginImporter[];

  // Arbitrary API routes for the plugin (e.g. /api/estimate for music), mounted as-is
  apiRoutes?: PluginApiRoute[];

  // Options offered for the dashboard's "quick add" button
  fastAddOptions?: FastAddOption[];

  // Collection-level actions (buttons in the /collection header), declared by the plugin.
  // The core renders them generically and provides the standardized behaviors (estimate, importer-sync).
  collectionActions?: CollectionAction[];

  // Required environment variables (API keys). The module stays disableable
  // until all of them are present; the admin shows an indicator.
  requiredEnvKeys?: string[];

  // Extra plugin-specific settings (⚙ button in the admin).
  // Values stored in settings.pluginSettings[plugin.id][key] and read by the plugin.
  settings?: PluginSetting[];

  getVariants(item: any): Promise<any[]>;

  getManualDefaults?(): Record<string, any>;

  // Optional in-place normalization of the assembled save payload before persistence
  // (e.g. books keep `isbn` and `barcode` in sync). Runs for both create and edit.
  normalizeForSave?(data: Record<string, any>): void;

  // How to word, in one short line, what an item holds: a show says which seasons are
  // owned. Returns a translation key and its parameters, since a plugin cannot translate,
  // or null when the contents need no mention. Shown on the collection card and on the
  // item page, so someone reads it off the shelf without opening anything.
  cardContains?(item: any, contains: any[]): { key: string; params: Record<string, any> } | null;

  // Takes over the creation of a new item when one submission is not one document: adding a
  // TV show creates the show and each of its seasons, which are items in their own right.
  // Return false to let the standard single-item creation run, which is what every plugin
  // that does not implement this does.
  //
  // Ownership of the whole step, not a post-processing hook: the plugin decides what
  // already exists, what to attach to what, and what merging means for its own shapes,
  // none of which the core can express without learning the plugin's vocabulary. Only
  // reached on a create, never on an edit.
  handleCreate?(data: Record<string, any>, ctx: {
    body: Record<string, any>;
    ownerId: any;
    collectionId: any;
    language?: string;
  }): Promise<boolean>;

  // Text fields whose input suggests values instead of constraining them. The collection's
  // existing values are always offered; `suggestionsFor` adds what the plugin knows about
  // the item at hand. See core/fieldSuggestions.ts.
  suggestionFields?: string[];
  suggestionsFor?(field: string, item: any): string[];

  partialsPath?: string;

  detailZones?: DetailZone[];
  refreshItem?(item: any, req: any): Promise<Record<string, any>>;

  bulkRefresh?: BulkRefreshProvider;
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'radio-cards' | 'boolean' | 'rating' | 'hidden' | 'tags' | 'textarea' | 'date' | 'custom';
  required?: boolean;
  options?: { value: string; label: string; icon?: string }[];
  default?: any;
  showIn: ('edit' | 'add' | 'confirm' | 'detail' | 'manual')[];
  group?: 'main' | 'metadata' | 'status' | 'hidden';
  partial?: string;
  placeholder?: string;
  hint?: string;
  showCondition?: 'manual-only' | 'api-only' | 'always';

  // User-defined field declared in settings.pluginExtraFields, not by the plugin itself.
  // Its value is stored under item.extra[name] instead of a real schema path.
  extraField?: boolean;
}
export interface SearchProvider {
  name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  getDetails(id: string, options: any): Promise<ConfirmData>;
}

export interface SearchOptions {
  limit?: number;
  [key: string]: any;
}

export interface SearchResult {
  id: string;
  title: string;
  creator: string;
  year?: string;
  cover_image?: string;
  [key: string]: any;
}

export interface ConfirmData {
  title: string;
  creator: string;
  cover_image?: string;
  [key: string]: any;
}

export interface ImageSearchProvider {
  search(query: string, options?: { language?: string }): Promise<string[]>;
}

export interface PluginApiRoute {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string; // full path (e.g. '/api/estimate/:discogsId')
  requireAdmin?: boolean;
  requireEditor?: boolean;
  handler(req: any, res: any): Promise<any> | any;
}

export interface FastAddOption {
  value: string; // value stored in settings.fastAdd (e.g. 'vinyl')
  label: string; // i18n key
  icon: string; // FontAwesome icon
  color: string; // Tailwind class for the selected background (peer-checked:bg-...)
  url: string; // quick-add button target
}

export interface PluginStats {
  [key: string]: any;
}

export interface BulkRefreshProvider {
  refreshAll(ownerId: any): Promise<void>;
}

export interface FormatOption {
  value: string;
  label: string;
  color?: string; // Tailwind badge class (e.g. 'bg-green-600/90'), default gray if absent
}

export interface NavbarShortcut {
  id: string; // id stored in settings.navbarShortcuts (e.g. 'game_physical')
  label: string; // i18n key
  url: string; // relative URL (e.g. '/collection?type=games&format=physical')
}

export interface StatWidget {
  id: string; // id stored in settings.statsWidgets, matches a getStats() key
  label: string; // i18n key
  icon: string; // FontAwesome icon (e.g. 'fa-gamepad')
  color: string; // Tailwind classes for the badge background
  text?: string; // Tailwind class for the text (count widgets)
  kind: 'count' | 'top'; // 'count' -> number; 'top' -> { name, count }
}

export interface PluginSetting {
  key: string; // key stored in settings.pluginSettings[pluginId][key]
  label: string; // i18n key or plain text
  type: 'boolean'; // extensible later (select, text...)
  default?: any;
  description?: string; // i18n key or plain text (help shown under the toggle)
}

export interface PluginImporter {
  id: string; // URL segment: POST /import/{id}
  requireAdmin?: boolean;
  handler(req: any, res: any): Promise<any> | any;

  // Declarative UI rendered generically in the admin (button + modal + progress).
  // Absent = the import stays reachable via the API but has no admin button.
  ui?: ImporterUI;
}

export interface ImporterUI {
  label: string; // i18n key, button/card title
  icon: string; // FontAwesome icon (e.g. 'fa-rss')
  description?: string; // i18n key, subtitle
  color?: string; // Tailwind accent class (e.g. 'amber')
  help?: string[]; // i18n keys, help steps (optional, e.g. Goodreads guide)
  warning?: string; // i18n key, warning shown before the button
  fields: ImportField[];
  submitLabel: string; // i18n key, submit button label
}

export interface ImportField {
  name: string; // name sent in the POST body
  label: string; // i18n key
  type: 'text' | 'url' | 'textarea' | 'select' | 'file';
  placeholder?: string;
  hint?: string; // i18n key
  required?: boolean;
  default?: string;
  accept?: string; // for type 'file' (e.g. '.csv')
  fileEncoding?: 'text'; // 'file' is read and sent as text in this field
  options?: { value: string; label: string }[]; // for type 'select'
}

export interface DetailZone {
  id: string;
  partial: string;
}

// Collection-level action button (in the /collection header), declared by a plugin.
// Two standardized behaviors rendered generically by the core:
//  - 'estimate': opens the estimate modal and sums the price of the whole collection
//    by calling the declared endpoints (reusable for a global "total value":
//    iterate registry.getAll().flatMap(p => p.collectionActions)).
//  - 'importer-sync': triggers POST /import/{importerId} (via socket.io), then reloads the page.
export interface CollectionAction {
  id: string; // unique id within the plugin
  label: string; // i18n key (button text)
  icon: string; // FontAwesome icon (e.g. 'fa-calculator')
  tooltip?: string; // i18n key (title)
  behavior: 'estimate' | 'importer-sync';

  // Only show the button if user.pluginData[plugin.id][requiresUserData] is set
  // (e.g. 'discogsUsername' for the Discogs sync).
  requiresUserData?: string;

  // behavior 'estimate': standardized price estimation capability.
  estimate?: {
    idsEndpoint: string; // GET -> { success, albums: [{ [idField], quantity }] }
    estimateEndpoint: string; // GET `${estimateEndpoint}/${id}` -> { success, price: { value } }
    idField: string; // field holding the external id (e.g. 'discogs_id')
    maxMultiplier?: number; // upper bound of the price range (default 1.3)
  };

  // behavior 'importer-sync': id of the importer to trigger (POST /import/{importerId}).
  importerId?: string;
}
