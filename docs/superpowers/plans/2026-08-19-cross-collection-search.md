# Cross-Collection Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user search across every collection they're a member of, and jump straight to a matching item.

**Architecture:** One new `GET /search` route queries the shared `Item` collection with a `$or` of per-collection sub-filters (each built from that collection's own `Settings` for module-gating/visibility), then renders a results view whose cards switch the active collection (reusing the existing `POST /collection/switch` route unchanged) before landing on the item's normal, already collection-scoped detail page.

**Tech Stack:** Express 5, Mongoose 8, EJS views, no client-side framework (plain `<form>`/`fetch`-free navigation, matching the rest of the app).

**Spec:** [docs/superpowers/specs/2026-08-19-cross-collection-search-design.md](../specs/2026-08-19-cross-collection-search-design.md)

## Global Constraints

- No test framework exists in this repo (`npm test` is a stub: `echo "Error: no test specified" && exit 1`). Every task's verification is manual: `npx tsc --noEmit` for type safety, then exercising the running dev server with `curl` and/or a browser — the same pattern already used for prior feature work in this repo.
- Match fields: **title + creator field only** (per plugin's `creatorField`, read from `registry`). No comments/tracklist full-text, no barcode, no `extraSearchFields` — those are explicitly out of scope per the spec.
- Minimum query length: **2 characters**, enforced both client-side (input `minlength`/JS guard) and server-side (route). Below that, no `Item` query runs at all.
- Collections searched: **every membership, any role** (admin/editor/viewer).
- Wishlist items: **included** (no `in_wishlist` filter).
- Page size: fixed at **25**, no user-configurable limit (unlike `/collection`).
- Every new user-facing string goes into all five locale files: `locales/en.json`, `fr.json`, `es.json`, `it.json`, `de.json`.
- Follow existing route error-handling: try/catch, `res.status(500).send(req.t('errors.generic_server_error'))`.

---

### Task 1: Backend route and results view

**Files:**
- Create: `core/routes/searchRoute.ts`
- Modify: `app.ts` (import + mount, alongside the existing `collectionRoute` mount)
- Create: `views/search.ejs`

**Interfaces:**
- Consumes: `registry` (`core/registry.ts`: `getAll()`, `getByKind(kind)`, `getEnabled(settings)`, each `PluginDefinition` has `creatorField: string`, `routePrefix: string`, `formatForView(item): any`, `cardBadge?(item, settings)`, `formats: FormatOption[]`, `aspectRatioClass?: string`), `escapeRegExp` (`core/helpers.ts`), `applyVisibilityFilter`/`applyEnabledModulesFilter` (`utils/visibilityHelper.ts`), `requireAuth` (`middleware/authMiddleware.ts`), models `Item`/`Collection`/`Settings`, and the existing `getCardLines` (`core/cardFields.ts`) + `views/partials/item-card-body.ejs` include (same card body used by `/collection`).
- Produces: `GET /search` route rendering `search` view with locals `{ query: string, results: Array<{ item, plugin, collectionId, collectionName }>, totalItems: number, totalPages: number, currentPage: number, user }`. Later tasks (nav link, locale keys) depend on this route existing and this exact locals shape.

- [ ] **Step 1: Write `core/routes/searchRoute.ts`**

```ts
import express from 'express';
import { registry } from '../registry';
import Item from '../../models/Item';
import Collection from '../../models/Collection';
import Settings from '../../models/Settings';
import { requireAuth } from '../../middleware/authMiddleware';
import { escapeRegExp } from '../helpers';
import { applyVisibilityFilter, applyEnabledModulesFilter } from '../../utils/visibilityHelper';

const router = express.Router();

const PAGE_SIZE = 25;
const MIN_QUERY_LENGTH = 2;

router.get('/search', requireAuth, async (req: any, res: any) => {
  try {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);

    const emptyResult = {
      query: rawQuery,
      results: [] as any[],
      totalItems: 0,
      totalPages: 0,
      currentPage: 1,
      user: res.locals.user
    };

    if (rawQuery.length < MIN_QUERY_LENGTH) {
      return res.render('search', emptyResult);
    }

    const memberships = await Collection.find({ 'members.user': req.user._id });
    if (memberships.length === 0) {
      return res.render('search', emptyResult);
    }

    const collectionIds = memberships.map((c: any) => c._id);
    const roleById = new Map<string, string>();
    const nameById = new Map<string, string>();
    memberships.forEach((c: any) => {
      const membership = (c.members || []).find((m: any) => String(m.user) === String(req.user._id));
      roleById.set(String(c._id), req.user.isAdmin ? 'admin' : (membership ? membership.role : 'viewer'));
      nameById.set(String(c._id), c.name);
    });

    const settingsDocs = await Settings.find({ collection: { $in: collectionIds } }).lean();
    const settingsById = new Map<string, any>();
    settingsDocs.forEach((s: any) => settingsById.set(String(s.collection), s));

    const regex = new RegExp(escapeRegExp(rawQuery), 'i');

    // Only title + creator field, unlike /collection's search box: comments/tracklist,
    // barcode and extraSearchFields are a separate roadmap item (full-text search), kept
    // out here to keep this query cheap across every collection at once.
    const subFilters = collectionIds.map((id: any) => {
      const idStr = String(id);
      // A collection nobody has opened yet has no Settings doc (settingsMiddleware
      // upserts one lazily, only for the active collection). Falls back to the same
      // "enabledByDefault plugins only, no visibility restrictions" default that
      // middleware/settingsMiddleware.ts uses for that exact case.
      const settings = settingsById.get(idStr) || { modules: registry.getDefaultModules() };
      const enabledPlugins = registry.getEnabled(settings);
      const creatorFields = new Set<string>();
      enabledPlugins.forEach(p => creatorFields.add(p.creatorField));

      const subFilter: any = {
        collection: id,
        $or: [
          { title: regex },
          ...Array.from(creatorFields).map(f => ({ [f]: regex }))
        ]
      };

      const isAdminHere = roleById.get(idStr) === 'admin';
      applyVisibilityFilter(subFilter, isAdminHere, settings);
      applyEnabledModulesFilter(subFilter, settings);

      return subFilter;
    });

    const query = { $or: subFilters };

    const totalItems = await Item.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);

    const items = await Item.find(query)
      .sort({ added_at: -1 })
      .skip((currentPage - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();

    const results = items.map((item: any) => {
      const plugin = registry.getByKind(item.kind);
      const formatted = plugin ? plugin.formatForView(item) : item;
      const collectionIdStr = String(item.collection);
      return {
        item: formatted,
        plugin,
        collectionId: collectionIdStr,
        collectionName: nameById.get(collectionIdStr) || ''
      };
    });

    res.render('search', {
      query: rawQuery,
      results,
      totalItems,
      totalPages,
      currentPage,
      user: res.locals.user
    });
  } catch (err: any) {
    console.error('Search error:', err.message);
    res.status(500).send(req.t('errors.generic_server_error'));
  }
});

export default router;
```

- [ ] **Step 2: Mount the route in `app.ts`**

Add the import near the other route imports (after the `collectionRoute` import):

```ts
import searchRoute from './core/routes/searchRoute.js';
```

Add the mount near `app.use(BASE_URL, collectionRoute);`:

```ts
app.use(BASE_URL, searchRoute);
```

- [ ] **Step 3: Write `views/search.ejs`**

```ejs
<%- include('partials/header') %>

<div class="max-w-screen-xl mx-auto px-1 md:px-0 pb-12">

    <div class="pt-6 mb-6">
        <h1 class="text-3xl font-bold transition-colors"><%= t('search.title') %></h1>
    </div>

    <form onsubmit="event.preventDefault(); runSearch();" class="mb-8">
        <div class="relative max-w-xl">
            <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <i class="fa-solid fa-magnifying-glass opacity-40"></i>
            </div>
            <input type="text" id="searchInput" value="<%= query %>" minlength="2" autofocus
                class="block w-full p-3 pl-10 text-sm card-theme rounded-lg border focus:ring-1 focus:ring-primary-theme placeholder-opacity-50 transition-shadow"
                placeholder="<%= t('search.placeholder') %>">
        </div>
    </form>

    <% if (query.length < 2) { %>
        <div class="text-center py-20 opacity-50">
            <i class="fa-solid fa-magnifying-glass text-3xl mb-4"></i>
            <p class="text-sm"><%= t('search.empty_prompt') %></p>
        </div>
    <% } else if (results.length === 0) { %>
        <div class="text-center py-20 opacity-50">
            <i class="fa-solid fa-box-open text-3xl mb-4"></i>
            <p class="text-sm"><%= t('search.no_results') %></p>
        </div>
    <% } else { %>
        <p class="text-xs opacity-50 mb-4"><%= t('search.results_count', { count: totalItems }) %></p>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
            <% results.forEach(result => { %>
                <%
                    const item = result.item;
                    const itemPlugin = result.plugin;
                    const isPoster = itemPlugin ? itemPlugin.aspectRatioClass !== 'aspect-square' : true;
                    const detailPath = (itemPlugin ? itemPlugin.routePrefix : '/album') + '/' + item._id;
                    const badge = (itemPlugin && itemPlugin.cardBadge)
                        ? itemPlugin.cardBadge(item, null)
                        : (function(){ var fmt=(item.format||item.media_type||'').toLowerCase(); var opt=itemPlugin?(itemPlugin.formats||[]).find(function(f){return f.value===fmt}):null; return { label: opt?opt.label:fmt, colorClass: (opt&&opt.color)||'bg-gray-600/90' }; })();
                %>
                <div class="album-card group relative card-theme rounded-xl overflow-hidden hover:border-primary-theme transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                    <form method="POST" action="<%= baseUrl %>/collection/switch">
                        <input type="hidden" name="collectionId" value="<%= result.collectionId %>">
                        <input type="hidden" name="redirectTo" value="<%= baseUrl + detailPath %>">
                        <button type="submit" class="block w-full text-left">
                            <div class="aspect-square w-full relative overflow-hidden bg-black/5 flex items-center justify-center">
                                <% if (isPoster) { %>
                                    <img src="<%= item.cover_image %>"
                                        class="absolute inset-0 w-full h-full object-cover blur-xl opacity-30 scale-110 pointer-events-none">
                                <% } %>
                                <img src="<%= item.cover_image %>"
                                    class="relative z-10 w-full h-full <%= isPoster ? 'object-contain p-2' : 'object-cover' %> transition-transform duration-500 group-hover:scale-105"
                                    loading="lazy">

                                <span class="absolute top-2 left-2 z-20 text-white text-[9px] font-bold px-2 py-1 rounded backdrop-blur-md border border-white/10 shadow-sm bg-black/60">
                                    <i class="fa-solid fa-layer-group mr-1"></i><%= result.collectionName %>
                                </span>

                                <% if (badge.label) { %>
                                <span class="absolute bottom-2 left-2 z-20 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-md border border-white/10 shadow-sm <%= badge.colorClass %>">
                                    <%= t(badge.label, { defaultValue: badge.label }) %>
                                </span>
                                <% } %>
                            </div>

                            <%- include('partials/item-card-body', { item, plugin: itemPlugin, size: 'collection' }) %>
                        </button>
                    </form>
                </div>
            <% }) %>
        </div>

        <% if (totalPages > 1) { %>
            <nav class="mt-12 flex items-center justify-center gap-2 border-t border-black/5 dark:border-white/10 pt-8">
                <button onclick="changePage(<%= currentPage - 1 %>)" <%= currentPage <= 1 ? 'disabled' : '' %>
                    class="w-10 h-10 flex items-center justify-center rounded-xl card-theme border-none hover:bg-primary-theme hover:text-white transition-all disabled:opacity-20 disabled:pointer-events-none">
                    <i class="fa-solid fa-chevron-left text-xs"></i>
                </button>

                <div class="flex items-center gap-1">
                    <% for (let i = 1; i <= totalPages; i++) { if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) { %>
                        <button onclick="changePage(<%= i %>)"
                            class="w-10 h-10 flex items-center justify-center rounded-xl font-bold text-sm transition-all <%= currentPage === i ? 'bg-primary-theme text-white shadow-lg scale-110' : 'card-theme hover:bg-black/5 dark:hover:bg-white/5' %>">
                            <%= i %>
                        </button>
                    <% } else if (i === currentPage - 2 || i === currentPage + 2) { %>
                        <span class="px-1 opacity-30">...</span>
                    <% } } %>
                </div>

                <button onclick="changePage(<%= currentPage + 1 %>)" <%= currentPage >= totalPages ? 'disabled' : '' %>
                    class="w-10 h-10 flex items-center justify-center rounded-xl card-theme border-none hover:bg-primary-theme hover:text-white transition-all disabled:opacity-20 disabled:pointer-events-none">
                    <i class="fa-solid fa-chevron-right text-xs"></i>
                </button>
            </nav>
        <% } %>
    <% } %>
</div>

<script>
    function runSearch() {
        const value = document.getElementById('searchInput').value.trim();
        const url = new URL(window.location.origin + window.location.pathname);
        if (value) url.searchParams.set('q', value);
        url.searchParams.set('page', 1);
        window.location.href = url.toString();
    }

    function changePage(page) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', page);
        window.location.href = url.toString();
    }
</script>

<%- include('partials/footer') %>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Manually verify the route renders**

Start the dev server (`npm start`, background), log in as an existing test user, then (PowerShell, matching this repo's actual dev environment):

```powershell
curl.exe -s -c cookies.txt -X POST -d "email=test@dvinyl.local&password=testpass123" -H "Content-Type: application/x-www-form-urlencoded" http://127.0.0.1:3099/login -o NUL
curl.exe -s -b cookies.txt "http://127.0.0.1:3099/search" -o NUL -w "empty-state status=%{http_code}`n"
curl.exe -s -b cookies.txt "http://127.0.0.1:3099/search?q=Test" -o NUL -w "with-query status=%{http_code}`n"
Remove-Item cookies.txt -Force
```

Expected: both `status=200`.

- [ ] **Step 6: Commit**

```bash
git add core/routes/searchRoute.ts app.ts views/search.ejs
git commit -m "feat: add cross-collection search route and view"
```

---

### Task 2: Nav entry and translations

**Files:**
- Modify: `views/partials/header.ejs`
- Modify: `locales/en.json`, `locales/fr.json`, `locales/es.json`, `locales/it.json`, `locales/de.json`
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: Task 1's `GET /search` route (the nav link points at it).
- Produces: nothing consumed by a later task — this is the last implementation task.

- [ ] **Step 1: Add the nav link in `views/partials/header.ejs`**

Find the shortcuts `<ul>` (the one built from `shortcutConfig`, ending just before `</ul>` around what is currently line 311 — locate it by searching for `global_wishlist` in the file). Insert a new always-visible entry right before that `</ul>`, guarded on `locals.user` (search requires auth, unlike the shortcut items which render for anyone):

```ejs
              <% if (locals.user) { %>
              <li>
                <a href="<%= baseUrl %>/search" class="block py-2 px-3 md:p-0 text-[var(--text-sub)] hover:text-primary-theme transition-colors">
                  <%= t('nav.search') %>
                </a>
              </li>
              <% } %>
```

- [ ] **Step 2: Add locale keys**

In `locales/en.json`, add a top-level `"search"` object (alphabetically near `"settings"` is fine, consistency with the rest of the file matters more than exact position) and a `"search"` key inside the existing `"nav"` object:

```json
"nav": {
    ...
    "search": "Search"
},
```

```json
"search": {
    "title": "Search",
    "placeholder": "Search title or artist across your collections...",
    "empty_prompt": "Type at least 2 characters to search across all your collections.",
    "no_results": "No matches found.",
    "results_count": "{{count}} results"
}
```

Repeat for the other four locale files with translated values:

`locales/fr.json`:
```json
"nav": { "search": "Recherche" },
"search": {
    "title": "Recherche",
    "placeholder": "Rechercher un titre ou un artiste dans toutes vos collections...",
    "empty_prompt": "Tapez au moins 2 caractères pour rechercher dans toutes vos collections.",
    "no_results": "Aucun résultat trouvé.",
    "results_count": "{{count}} résultats"
}
```

`locales/es.json`:
```json
"nav": { "search": "Buscar" },
"search": {
    "title": "Buscar",
    "placeholder": "Buscar título o artista en todas tus colecciones...",
    "empty_prompt": "Escribe al menos 2 caracteres para buscar en todas tus colecciones.",
    "no_results": "No se encontraron resultados.",
    "results_count": "{{count}} resultados"
}
```

`locales/it.json`:
```json
"nav": { "search": "Cerca" },
"search": {
    "title": "Cerca",
    "placeholder": "Cerca titolo o artista in tutte le tue collezioni...",
    "empty_prompt": "Digita almeno 2 caratteri per cercare in tutte le tue collezioni.",
    "no_results": "Nessun risultato trovato.",
    "results_count": "{{count}} risultati"
}
```

`locales/de.json`:
```json
"nav": { "search": "Suche" },
"search": {
    "title": "Suche",
    "placeholder": "Titel oder Künstler in allen Sammlungen suchen...",
    "empty_prompt": "Mindestens 2 Zeichen eingeben, um alle Sammlungen zu durchsuchen.",
    "no_results": "Keine Ergebnisse gefunden.",
    "results_count": "{{count}} Ergebnisse"
}
```

(`"nav"` here means: add the single `"search"` key into each file's existing `"nav"` object, not replace the whole object. Same for `"search"`: it's a new top-level object, added once per file.)

- [ ] **Step 3: Validate JSON**

Run:
```bash
node -e "['en','fr','es','it','de'].forEach(f => { JSON.parse(require('fs').readFileSync('locales/'+f+'.json','utf8')); console.log(f+' OK'); })"
```
Expected: `en OK` / `fr OK` / `es OK` / `it OK` / `de OK`, no errors.

- [ ] **Step 4: Update `docs/roadmap.md` status**

Change the "Cross-collection search" row's `todo` to `in-progress`.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit -p .` (expected: no errors — this task touches no `.ts` files, but confirms nothing else broke).

```bash
git add views/partials/header.ejs locales/en.json locales/fr.json locales/es.json locales/it.json locales/de.json docs/roadmap.md
git commit -m "feat: add search nav entry and translations"
```

---

### Task 3: End-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Task 1 and Task 2.
- Produces: nothing — terminal task.

- [ ] **Step 1: Seed a second collection and membership for the existing test user**

Using the same one-off script pattern as prior feature work in this repo (write a temporary `.ts` file at the project root, run it with `node --env-file=.env --import tsx <file>.ts`, then delete it — do not commit it), extend the existing `test@dvinyl.local` user with membership in a second collection, and add a handful of items to that second collection whose titles overlap with an existing item's title in the first ("Seed Collection") so a single search query is guaranteed to match both.

- [ ] **Step 2: Restart the dev server**

Stop the running `npm start` background task if one is active, then start it again so the new route/view are loaded (this project has no hot-reload — `nodemon` is a devDependency but `npm start` runs plain `node`, not `nodemon`).

- [ ] **Step 3: Walk the spec's testing checklist**

Log in as `test@dvinyl.local`, then in a browser (or via `curl` against both `/search?q=...` and by reading the rendered HTML):
- A search matching items in both collections shows both, each with its own collection badge.
- Clicking (submitting) a result card from the non-active collection switches into it (`POST /collection/switch`) and lands on that item's detail page.
- The empty-query state (`/search` with no `q`) shows the prompt and no result cards.
- A query under 2 characters (`/search?q=a`) also shows the prompt, not a search.
- A user who is a member of only one collection still gets correct results for that collection.

- [ ] **Step 4: Refresh the graphify graph**

Run: `graphify update .`
Expected: completes without error (per this repo's `CLAUDE.md`, the graph should reflect the new `core/routes/searchRoute.ts`).

- [ ] **Step 5: Final commit if the graph changed**

```bash
git status --short
```
If `graphify-out/` shows changes (it's gitignored per this branch's earlier `.gitignore` update, so this is expected to show nothing — confirm that, don't commit graph output).
