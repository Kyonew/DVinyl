# 🧩 Plugin development guide

Everything you collect in DVinyl (music, books, movies, games, LEGO, board games) is a **plugin**. The core knows
nothing about any specific media type. That means you can add a brand new type, with its own fields,
its own external API and its own stats, just by dropping a folder into `plugins/`. No changes to the
core are needed.

This guide takes you from a first minimal plugin to a full featured one, step by step.

## Which path is right for you?

There are two ways to add a new collection type:

| | No-code plugin | Code plugin (this guide) |
| :-- | :-- | :-- |
| Where | The **plugin editor** inside the app | A `plugins/<id>/` folder of TypeScript |
| Good for | Personal, manual collections | Types with an external API, importers, custom stats |
| Coding | None | TypeScript |
| Restart | Hot reload, no restart | Restart the app |

If you just want a manual collection with your own fields, the **no-code plugin editor** is faster
and needs no coding at all. See the guide on the
[Wiki](https://github.com/Kyonew/DVinyl/wiki). If you want to pull data from an API or ship
something others can install, keep reading.

## How plugins are loaded

At startup, `core/loadPlugins.ts` scans every `plugins/*/index.ts`, reads the exported plugin
definition, sorts by `order`, and registers it. From there the plugin shows up automatically in the
navbar, the collection tabs, the dashboard widgets, the themes, the add menu and the admin panel.

The rule to remember: **you never edit the core to add a type.** You only add files under
`plugins/`.

## Prerequisites

- A working local setup (see [Getting started](./getting-started.md) or run `make dev`).
- Basic TypeScript. If you can read the [LEGO plugin](../plugins/lego/index.ts), you are ready.

## Anatomy of a plugin

A plugin is a folder with, at minimum, an `index.ts` that exports a `PluginDefinition` as its
default export:

```
plugins/
  boardgames/
    index.ts        # the plugin definition (required)
    partials/       # optional EJS snippets for custom UI
    someApi.ts      # optional API client, helpers, constants
```

The full contract lives in [`core/types.ts`](../core/types.ts). Open it alongside this guide, it is
heavily commented. Below are the parts you actually need.

### Fields that are always there

Every item already has these base fields (defined in [`models/Item.ts`](../models/Item.ts)), so you
do **not** redeclare them in your schema:

`title`, `year`, `cover_image`, `user_image`, `images`, `owner`, `collection`, `in_wishlist`, `comments`,
`location`, `quantity`, `genre`, `genres`, `styles`, `barcode`, `added_at`.

Your `schemaDefinition` only adds the fields that are specific to your type.
Names beginning with `custom_` are reserved for the collision-proof identities of fields
created from the per-collection customization screen. A code plugin must not declare that
prefix in either `schemaDefinition` or `formFields`; the plugin loader rejects it.

## Level 1: a minimal plugin

Let us build a manual "Board games" type. Create `plugins/boardgames/index.ts`:

```ts
import { PluginDefinition } from '../../core/types';
import { escapeRegExp } from '../../core/helpers';
import Item from '../../models/Item';

export const boardGamesPlugin: PluginDefinition = {
  // Identity
  id: 'boardgames',          // folder name, url and settings key
  kind: 'BoardGame',         // Mongo discriminator, must be unique
  label: 'media.boardgames', // i18n key for the display name
  i18nKey: 'boardgame',      // suffix for legacy i18n key families
  icon: 'dice',              // FontAwesome icon name (without the fa- prefix)
  routePrefix: '/boardgame', // base path for this type's detail routes
  collectionType: 'boardgames',
  order: 60,                 // display order across the UI

  // The main "author-like" field for this type
  creatorField: 'publisher',

  // Extra fields stored on top of the base item fields
  schemaDefinition: {
    publisher: { type: String, default: '' },
    players: { type: String, default: '' },
    format: {
      type: String,
      enum: ['boxed', 'expansion', 'promo'],
      default: 'boxed'
    }
  },

  // The format badge values (used by the filters and the card badge)
  formats: [
    { value: 'boxed', label: 'format.boxed', color: 'bg-emerald-600/90' },
    { value: 'expansion', label: 'format.expansion', color: 'bg-sky-600/90' },
    { value: 'promo', label: 'format.promo', color: 'bg-amber-600/90' }
  ],

  // The fields shown in the add, edit, confirm and detail forms
  formFields: [
    { name: 'title', label: 'confirm_boardgame.field_title', type: 'text', required: true,
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'publisher', label: 'confirm_boardgame.field_publisher', type: 'text',
      showIn: ['edit', 'confirm', 'detail', 'manual'], group: 'main' },
    { name: 'players', label: 'confirm_boardgame.field_players', type: 'text',
      showIn: ['edit', 'confirm', 'manual'], group: 'metadata' },
    { name: 'format', label: 'confirm_boardgame.field_format', type: 'select',
      showIn: ['edit', 'confirm', 'manual'], group: 'main',
      options: [
        { value: 'boxed', label: 'format.boxed' },
        { value: 'expansion', label: 'format.expansion' },
        { value: 'promo', label: 'format.promo' }
      ] }
  ],

  // Dashboard numbers for this type
  getStats(items: any[]): Record<string, any> {
    const qty = (i: any) => Number(i.quantity || 1);
    return {
      boardgames_total: items.reduce((acc, i) => acc + qty(i), 0)
    };
  },

  // Normalize an item before it reaches a view (fill defaults, fallbacks)
  formatForView(item: any): any {
    if (!item) return null;
    const obj = item.toObject ? item.toObject() : item;
    return {
      ...obj,
      publisher: obj.publisher || 'Unknown',
      cover_image: obj.cover_image || '/ressources/logo.png',
      format: obj.format || 'boxed'
    };
  },

  // Detect an existing copy in the same collection (for the "already owned" check)
  async findDuplicate(collectionId: any, data: Record<string, any>): Promise<any | null> {
    const title = (data.title || '').trim();
    if (!title) return null;
    return Item.findOne({
      collection: collectionId,
      in_wishlist: false,
      kind: 'BoardGame',
      title: { $regex: new RegExp(`^${escapeRegExp(title)}$`, 'i') },
      format: data.format || 'boxed'
    });
  },

  // Other copies of the same item (different edition, condition...)
  async getVariants(item: any): Promise<any[]> {
    if (!item) return [];
    return Item.find({
      collection: item.collection,
      in_wishlist: false,
      kind: 'BoardGame',
      _id: { $ne: item._id },
      title: { $regex: new RegExp(`^${escapeRegExp(item.title)}$`, 'i') }
    }).lean();
  }
};

export default boardGamesPlugin;
```

That is a complete, working plugin. Restart the app (`make dev` or `make docker-build`), open the
admin panel, enable "Board games" for your collection, and you can start adding items by hand.

> [!NOTE]
> Code plugins are discovered at startup, so **restart the app after adding or changing files**.
> Only the no-code plugin editor hot reloads.

### The required members

Everything in the example above except the optional extras is mandatory. In short, a plugin must
provide: `id`, `kind`, `label`, `i18nKey`, `icon`, `routePrefix`, `collectionType`, `creatorField`,
`schemaDefinition`, `formats`, `formFields`, `getStats`, `formatForView`, `findDuplicate` and
`getVariants`. Add `getManualDefaults()` to control the blank form for a new manual item.

## Level 2: make it feel native

These optional properties wire your type into the rest of the UI.

**Navbar shortcuts** (offered in the personalization page):

```ts
navbarShortcuts: [
  { id: 'boardgames', label: 'media.boardgames', url: '/collection?type=boardgames' },
  { id: 'boardgames_expansion', label: 'format.expansion',
    url: '/collection?type=boardgames&format=expansion' }
]
```

**Dashboard widgets** (their `id` must match a key returned by `getStats`):

```ts
statsWidgets: [
  { id: 'boardgames_total', label: 'stats.boardgames_total_label', icon: 'fa-dice',
    color: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600', kind: 'count' }
]
```

`kind: 'count'` shows a number. `kind: 'top'` shows a `{ name, count }` pair (for a "top publisher"
style widget).

**Quick add** button on the dashboard:

```ts
fastAddOptions: [
  { value: 'boardgame', label: 'media.boardgames', icon: 'fa-dice',
    color: 'peer-checked:bg-emerald-600', url: '/add-boardgames' }
]
```

**A custom badge** on cards (by default the badge comes from `formats`):

```ts
cardBadge(item: any) {
  return { label: item.publisher || 'Board game', colorClass: 'bg-emerald-600/90' };
}
```

**A source link and an external id** on the detail page:

```ts
externalIdField: 'bgg_id',
externalLink(item: any) {
  return item.bgg_id ? { label: 'BGG', url: `https://boardgamegeek.com/boardgame/${item.bgg_id}` } : null;
}
```

Themes are automatic: as soon as your plugin is registered, its `collectionType` gets its own entry
in the theme picker, so users can give your type its own color scheme.

## Level 3: connect an external API

To let users search a database instead of typing everything, implement a `SearchProvider`. Look at
[`plugins/lego/rebrickable.ts`](../plugins/lego/rebrickable.ts) for a real example. The shape is:

```ts
import { SearchProvider, SearchOptions, SearchResult, ConfirmData } from '../../core/types';
import { fetchJson } from '../../core/helpers';

export class BggProvider implements SearchProvider {
  name = 'BoardGameGeek';

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Call your API and map each result to a SearchResult:
    // { id, title, creator, year?, cover_image?, ...anything else you want to keep }
    return [];
  }

  async getDetails(id: string, options: any): Promise<ConfirmData> {
    // Fetch the full record for one id, return the fields to prefill the confirm form:
    // { title, creator, cover_image?, ...your schema fields }
    return { title: '', creator: '' };
  }
}
```

Then declare it as a **source**: a place your plugin looks things up. A plugin can have
several, and each one carries its own credentials.

```ts
const bggSource = sourceFromProvider(new BggProvider(), {
  id: 'bgg',                          // stored on every item this source fills in: never change it
  requiredEnvKeys: ['BGG_API_KEY'],   // the source drops out of the lists until these are set
  itemUrl: (id: string) => `https://boardgamegeek.com/boardgame/${id}`
});

// ...then, in the plugin definition:
sources: [bggSource],
```

The module stays usable as long as **one** of its searchable sources is configured, and the
add page grows a source picker by itself as soon as there are two. Each item records which
source answered, in `source` and `source_id`, so it can be traced back and refreshed against
the right database later on. Both names belong to the core: don't declare either in your own
schema.

Items saved before your plugin had sources are credited to its first searchable source, from
the id in your `externalIdField`. If that field does not hold an id the source's `getDetails`
accepts (books keep Hardcover's slug, while Hardcover is queried by numeric id), say which one
does with `legacyIdField`, or `legacyIdField: null` to leave those items without a pair.

`sourceFromProvider` is a convenience for a class you already wrote. A source is a plain
object and it only implements the capabilities it has: `search` + `getDetails` to be
searchable, `searchImages` for pictures. A service that only knows where artwork lives
declares images alone, through `imageSourceFrom` (see below).

The older single `searchProvider` is still read: a plugin declaring one is treated as having
one source bearing the plugin's own id, so nothing that exists needs rewriting.

Use `fetchJson` / `fetchText` from [`core/helpers.ts`](../core/helpers.ts) for network calls, they
handle JSON parsing and errors for you. Keep your API client, constants and headers in their own
files inside the plugin folder, so the core stays clean.

**Item images.** Every plugin automatically gets the ordered image gallery. `images[0]` is the
main image; the core mirrors its first two entries to the legacy `cover_image` and `user_image`
fields whenever an item form is saved. Importers and refresh handlers can therefore keep writing
`cover_image`, while new code should read the formatted item's `images` array when it needs the
whole gallery. New local uploads are compressed to JPEG and stored in `public/uploads/items`; the
item document only keeps their portable `/uploads/items/...` paths. Linked URLs remain external.
ZIP backups include referenced local files, extract legacy inline JPEGs, and give every restored
file a fresh name; historical JSON backups remain importable. The stored-data limit still protects
legacy data URLs and submissions from custom clients.

Let a source suggest images by giving it `searchImages`. **Every** image-capable source of
the plugin is asked at once and the results are merged and deduplicated, because pictures are
gathered rather than picked from one place: a record's front cover and the scan of its inner
sleeve come from different services.

```ts
// On a source that answers both kinds of question:
const bggSource = sourceFromProvider(new BggProvider(), {
  id: 'bgg',
  searchImages: (query: string) => new BggProvider().searchImages(query)
});

// Or a service that only has pictures, with no item to hand over:
const openLibrary = imageSourceFrom({
  id: 'openlibrary',
  name: 'Open Library',
  async searchImages(query: string): Promise<string[]> {
    return []; // a list of image URLs
  }
});
```

One source being down, rate limited or short of its key costs its own results and nobody
else's. A plugin with no image source simply offers none, rather than another plugin's.

The older `imageSearchProvider` and `secondaryImageSearchPath` are still merged in alongside
sources, so a plugin declaring only those keeps the picker it had.

**Refresh.** Let users re-pull metadata for an existing item with `mergeRefresh`. The core
fetches from whichever source filled the item in; you only say how the fresh details fold into
what is already there, because only you know that a missing publisher means "keep the one we
have" rather than "clear it".

```ts
mergeRefresh(item: any, details: any): Record<string, any> {
  return {
    cover_image: details.cover_image || item.cover_image,
    publisher: details.publisher || item.publisher
  };
}
```

Declaring it is what makes an item refreshable from *any* of your sources. Use `refreshItem`
instead when your refresh has to ask your API something a plain lookup by id does not answer
(music reads a release's barcode identifiers, books run a query of their own): it owns the
whole step, request included, but it only ever reaches your plugin's historical provider.

## Level 4: advanced capabilities

Once the basics work, these let your plugin do more, all still without touching the core.

- **Importers** (`importers[]`): bulk import from a file or another service, mounted at
  `POST /import/{id}`. Provide a declarative `ui` and the admin renders the button, modal and
  progress bar for you. See [`plugins/music/importers.ts`](../plugins/music/importers.ts).
  For a CSV, `runCsvImport()` ([`core/csvImport.ts`](../core/csvImport.ts)) does the plumbing
  (parsing, duplicate check, progress events, optional enrichment through your sources)
  and only asks you for a `mapRow(row)`. A source that mixes several media types in one file, like
  the Libib export, declares one importer per plugin, each filtering the rows it owns (see the
  `libib-*` importers).
- **API routes** (`apiRoutes[]`): arbitrary endpoints for your plugin (for example music's price
  estimate). Note they mount from the **root**, so `path` is used verbatim, not under `routePrefix`.
- **Collection actions** (`collectionActions[]`): buttons in the collection header. Two behaviors
  are rendered generically: `estimate` (sum a value across the collection) and `importer-sync`
  (trigger an importer). See the music plugin.
- **Plugin settings** (`settings[]`): per-collection toggles shown behind the gear icon in the
  admin, stored in `settings.pluginSettings[pluginId][key]`.
- **Detail zones** (`detailZones[]`) and `partialsPath`: inject your own EJS partials into set spots
  of the detail page (a status badge, a sidebar block...).
- **`normalizeForSave(data)`**: adjust the payload just before it is saved (for example LEGO mirrors
  its theme into `genre` so the generic genre filter works).
- **Items that hold other items** (`handleCreate(data, ctx)` + `cardContains(item, contains)`):
  when one submission is not one document. A TV show is stored as a show plus one item per
  season, each with its own cover, year and episodes, linked by the base field `parent`.
  `handleCreate` takes ownership of the whole creation step (return `false` to fall back to the
  standard single-item save), and `cardContains` words in one line what the item holds
  ("Seasons 1 to 4"), returning a translation key and its parameters. The core does the rest on
  its own: a contained item is kept out of every listing and count, deleted with its holder, and
  its link is rebuilt on a restore. See [`plugins/dvds/index.ts`](../plugins/dvds/index.ts).
- **Card cosmetics**: the fields shown under a cover, the badge colors and the field placed in a
  free corner of the cover are chosen per collection in the plugin editor, from what your plugin
  declares. Nothing to implement: any field of your schema, and any user-defined field, is
  offered there.

Reach for these only when you need them. Many plugins never do.

## Translations

Every `label` you use is an **i18n key**, resolved from the files in [`locales/`](../locales). Add
your keys to `en.json` first (and ideally `fr.json`), then to the other languages if you can:

```jsonc
// locales/en.json
"media": { "boardgames": "Board Games" },
"confirm_boardgame": {
  "field_title": "Title",
  "field_publisher": "Publisher"
}
```

If a key is missing, i18next simply shows the key text, so nothing breaks while you iterate.

## Testing your plugin

1. Add your folder under `plugins/` and restart (`make dev`).
2. Open the admin panel and **enable** the type for your collection.
3. Add an item (manually, or through your search provider) and check the collection, the detail
   page and the dashboard widgets.
4. Run `make typecheck` (or `npx tsc --noEmit`) to catch type errors.

Common gotchas:

- **Nothing shows up:** you forgot the `export default`, or you did not restart.
- **`kind` collision:** `kind` must be unique across all plugins.
- **The type stays greyed out in the admin:** none of its searchable sources has all of its
  `requiredEnvKeys` set in `.env`. The ⚙ button on the module says which variable each one wants.

## Sharing your plugin

Built something others could enjoy? Please open a pull request! New official plugins are very
welcome. Have a look at [CONTRIBUTING.md](../.github/CONTRIBUTING.md) first, keep the plugin self contained
inside its folder, and include the English (and ideally French) translation keys it needs.

Happy building! 🩵

[← Back to the README](../README.md)
