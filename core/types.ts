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

  // How the edit form words that id. A plugin whose id means something particular to its
  // owner says so here (music explains what a wrong Discogs id does to an estimate);
  // without them the form falls back to the generic wording in common.external_id_*.
  externalIdLabel?: string;
  externalIdHint?: string;

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

  // Real-world footprint of one item standing on its spine, per format value, in
  // millimetres. What the shelf view draws to scale: a CD is thicker than an LP sleeve
  // but far shorter, and that is what makes a mixed shelf read as a real one.
  // A plugin that declares nothing, or a format missing from the map, falls back to
  // SPINE_FALLBACK in core/spine.ts.
  spineSize?: Record<string, { thickness: number; height: number }>;

  creatorField: string;

  extraSearchFields?: string[];

  // The plugin's single historical provider. Superseded by `sources`, and still read
  // when a plugin declares no source of its own: it is then treated as one source
  // bearing the plugin's own id, so third-party plugins keep working untouched.
  searchProvider?: SearchProvider;

  // Where this plugin can look items up, in the order it prefers them. The first one
  // is the plugin's default, and the one the stored reference of every item predating
  // this field is attributed to (see the migration).
  sources?: ExternalSource[];

  // Custom EJS partial rendered in the search form ('top' and 'bottom' zones)
  searchFormPartial?: string;

  // The plugin's single historical image provider. Superseded by sources declaring
  // searchImages, and still merged in alongside them, so a plugin that declares only
  // this keeps the picker it had.
  imageSearchProvider?: ImageSearchProvider;

  // Value of the `type` param for /admin/api/search-image-universal ('music', 'book', 'movie', 'game')
  imageSearchType?: string;

  supportsBarcodeSearch?: boolean;

  // Noise terms stripped from the title returned by the barcode lookup (e.g. 'DVD', 'Blu-ray', 'PS5'),
  // to sharpen the external search query. Plugin-specific (keeps the core agnostic).
  barcodeNoiseTerms?: string[];

  // Hides the "Scan Barcode" affordance on the add page entirely. Unlike supportsBarcodeSearch
  // (which only controls whether a scan gets resolved through a UPC lookup service before
  // searching), this is for a provider whose search can't do anything useful with a barcode
  // at all - e.g. BoardGameGeek, which indexes titles only.
  noBarcodeScan?: boolean;

  // CSS aspect-ratio class for the plugin's own pages (detail, add/edit forms),
  // e.g. 'aspect-square' for music. Default 'aspect-[2/3]'. The item grids follow
  // the collection-wide setting instead, see views/partials/albums-grid.ejs.
  aspectRatioClass?: string;

  // Image shown for items with no cover of their own. Resolved at render time (see
  // registry.ts), so changing it updates every coverless item at once.
  // Defaults to DEFAULT_PLACEHOLDER_IMAGE when absent.
  placeholderImage?: string;

  // Legacy capability flag retained for custom-plugin config compatibility. The core
  // image gallery is now available to every plugin regardless of this value.
  supportsUserImage?: boolean;

  // Superseded by a source declaring searchImages, and still honoured: an extra endpoint
  // whose results are merged into the image picker. It was the one way to have two image
  // services behind one plugin (music: iTunes covers plus the Discogs gallery of the
  // physical object) before sources could say so themselves.
  secondaryImageSearchPath?: string;

  // Legacy icon setting retained for custom-plugin config compatibility.
  secondaryImageIcon?: string;

  // Optional i18n key naming the gallery's main image on the item page. `secondary`
  // remains accepted so existing third-party plugin definitions keep typechecking.
  imageLabels?: { main: string; secondary?: string };

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

  // Fetches fresh metadata for an item and says what to write. Owns the whole step,
  // request included, which is what a plugin needs when its refresh asks its API
  // something its search never asks (music reads the release's barcode identifiers,
  // books run a query of their own). Only ever reaches the plugin's historical
  // provider, so an item filled in from another source cannot be refreshed this way:
  // prefer mergeRefresh where the refresh is a plain lookup by id.
  refreshItem?(item: any, req: any): Promise<Record<string, any>>;

  // How fresh details from a source fold into an item that already exists. The fetch
  // belongs to the source, the merge belongs here: only the plugin knows that a provider
  // returning no publisher means "keep the one we have" rather than "clear it", or that
  // the owner's own notes on an episode outlive the episode being re-read.
  //
  // Pure, and the core writes what it returns. Declaring it is what makes an item
  // refreshable from whichever source filled it in rather than from one provider.
  mergeRefresh?(item: any, details: ConfirmData): Record<string, any>;

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
  images?: string[];
  [key: string]: any;
}

export interface ConfirmData {
  title: string;
  creator: string;
  cover_image?: string;
  images?: string[];
  [key: string]: any;
}

export interface ImageSearchProvider {
  search(query: string, options?: { language?: string }): Promise<string[]>;
}

/**
 * One external service a plugin can look items up in.
 *
 * A plugin says what an item *is*; a source says where its metadata can be found. The
 * two are separate because the same medium has several databases behind it, and which
 * one answers best depends on what is being collected: IGDB knows recent games, an
 * archive of the era knows MS-DOS.
 *
 * The `id` is written onto every item the source fills in, so it must stay stable for
 * the life of the source: changing it orphans everything already saved. It is also
 * global rather than per-plugin, since a source is free to serve several plugins.
 */
export interface ExternalSource {
  id: string;

  // Shown to the user: on a result badge, in an error message. Plain text, not a key.
  name: string;

  // Environment variables this source needs. It stays out of every list until all of
  // them are set, which is what lets a plugin ship a source nobody has configured.
  requiredEnvKeys?: string[];

  // Page of the item on the source's own site, from the id it handed out. What the
  // detail page links to for an item the plugin's own externalLink cannot place,
  // because that one only knows the plugin's historical provider.
  itemUrl?(externalId: string): string | null;

  // What this source can answer. A source implements the capabilities it has and no
  // more, and the core asks before it calls: a database of cover art has no item to
  // hand over and nothing to attribute, and forcing it to pretend otherwise would put
  // unopenable results in front of the user.

  // Metadata search. Comes as a pair with getDetails: a result nobody can expand is a
  // dead end, so a source offering one without the other is not offered for searching.
  search?(query: string, options: SearchOptions): Promise<SearchResult[]>;
  getDetails?(id: string, options: any): Promise<ConfirmData>;

  // Image search: bare URLs, for the picker in the image manager. Every image-capable
  // source of a plugin is asked at once and the results are merged, since images are
  // gathered rather than chosen from one place: a vinyl's front cover lives on one
  // service and the scan of its inner sleeve on another.
  searchImages?(query: string, options?: { language?: string }): Promise<string[]>;

  // True when this source's search reads the query as one exact item rather than a
  // description (an ISBN for Hardcover), so a single hit is the item and not a guess.
  // What lets scan mode (settings.instantAdd) save it without the confirm page being
  // looked at. Left unset by any source whose search is fuzzy.
  exactQuery?(query: string): boolean;
}

export interface PluginApiRoute {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string; // full path (e.g. '/api/estimate/:discogsId')
  requireAdmin?: boolean;
  requireEditor?: boolean;
  // Opens the route to a collection's public share links, on top of its members. Only for
  // a read-only page that belongs to an item someone can already see: the episode list of
  // a season is part of what the item is, and a link that shows the item without it leads
  // its visitor to a login screen. The core still decides which item is in reach, so the
  // path must carry it as `:id`; a route that names its item some other way is refused to
  // share visitors rather than served unchecked.
  allowShareView?: boolean;
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

// How the collection and the wishlist draw the items they hold. The pages themselves
// stay agnostic: they render whichever view is active, and the view selector is built
// from what the registry holds (see core/viewRegistry.ts).
export interface CollectionView {
  id: string;

  // i18n key of the name shown in the view selector
  label: string;

  // FontAwesome icon of the selector button (e.g. 'fa-table-cells')
  icon: string;

  // Display order in the selector, ascending. Default 100.
  order?: number;

  // Partial rendered in place of the item grid, resolved from the page's own
  // directory (e.g. 'partials/albums-grid').
  partial: string;

  // 'items' keeps the per-page selector and the page numbers under the view.
  // 'none' means the view pages over something of its own and hides both.
  paginates: 'items' | 'none';

  // The partial can be rendered on its own and swapped into the page without its
  // scripts running again, which is what lets the search follow the typing. A view
  // whose partial sets itself up with inline scripts leaves it off, and its search
  // applies on Enter through a full page load.
  liveRedraw?: boolean;

  // Merged into the page's view model, and only when this view is the active one:
  // a view nobody is looking at must not cost a query. `base` is what the page has
  // built so far, so a view can read the filters that were already resolved.
  buildData?(context: CollectionViewContext, base: Record<string, any>): Promise<Record<string, any>>;

  // A view can be unavailable rather than empty: it is then neither offered in the
  // selector nor reachable through ?view=, and the page falls back to the default.
  // Async because what makes a view worth offering can live in the database (the
  // shelf has nothing to show a collection with no furniture in it).
  isAvailable?(context: CollectionViewContext): boolean | Promise<boolean>;
}

export interface CollectionViewContext {
  req: any;
  res: any;

  // The collection and the wishlist are the same page over two halves of one shelf,
  // so a view says here whether it makes sense on a list of things nobody owns yet.
  inWishlist: boolean;

  // The resolved Mongo filter behind the page: every criterion the filter controls
  // produced, plus the visibility, module and share-scope narrowing, and minus paging
  // and ordering. A view that draws something other than one page of items builds its
  // own query on top of this, so it shows exactly what the filters say it should.
  itemQuery: any;

  // The ordering the page resolved, for a view keeping a list of items of its own.
  itemSort: any;
}
