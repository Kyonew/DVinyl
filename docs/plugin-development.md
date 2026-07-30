# 🧩 Plugin development guide

Everything you collect in DVinyl (music, books, movies, games, LEGO) is a **plugin**. The core knows
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

`title`, `year`, `cover_image`, `user_image`, `owner`, `collection`, `in_wishlist`, `comments`,
`location`, `quantity`, `genre`, `genres`, `styles`, `barcode`, `added_at`.

Your `schemaDefinition` only adds the fields that are specific to your type.

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

Then plug it in:

```ts
searchProvider: new BggProvider(),
requiredEnvKeys: ['BGG_API_KEY'], // the type stays disabled until this env var is set
```

Use `fetchJson` / `fetchText` from [`core/helpers.ts`](../core/helpers.ts) for network calls, they
handle JSON parsing and errors for you. Keep your API client, constants and headers in their own
files inside the plugin folder, so the core stays clean.

**Cover images.** Provide an `imageSearchProvider` so the image editor can suggest covers:

```ts
imageSearchType: 'boardgame',
imageSearchProvider: {
  async search(query: string): Promise<string[]> {
    return []; // return a list of image URLs
  }
}
```

**Refresh.** Let users re-pull metadata for an existing item with `refreshItem`:

```ts
async refreshItem(item: any): Promise<Record<string, any>> {
  if (!item.bgg_id) throw new Error('No BGG id to refresh');
  const details = await new BggProvider().getDetails(String(item.bgg_id), {});
  return {
    cover_image: details.cover_image || item.cover_image,
    publisher: details.publisher || item.publisher
  };
}
```

## Level 4: advanced capabilities

Once the basics work, these let your plugin do more, all still without touching the core.

- **Importers** (`importers[]`): bulk import from a file or another service, mounted at
  `POST /import/{id}`. Provide a declarative `ui` and the admin renders the button, modal and
  progress bar for you. See [`plugins/music/importers.ts`](../plugins/music/importers.ts).
  For a CSV, `runCsvImport()` ([`core/csvImport.ts`](../core/csvImport.ts)) does the plumbing
  (parsing, duplicate check, progress events, optional enrichment through your `searchProvider`)
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

Reach for these only when you need them. Many plugins never do.

## Translations

Every `label` you use is an **i18n key**, resolved from the files in [`locales/`](../locales). Add
your keys to `en.json` first (and ideally `fr.json`), then to the other languages if you can:

```jsonc
// locales/en.json
"media": { "boardgames": "Board games" },
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
- **The type stays greyed out in the admin:** a value in `requiredEnvKeys` is missing from `.env`.

## Sharing your plugin

Built something others could enjoy? Please open a pull request! New official plugins are very
welcome. Have a look at [CONTRIBUTING.md](../.github/CONTRIBUTING.md) first, keep the plugin self contained
inside its folder, and include the English (and ideally French) translation keys it needs.

Happy building! 🩵

[← Back to the README](../README.md)
