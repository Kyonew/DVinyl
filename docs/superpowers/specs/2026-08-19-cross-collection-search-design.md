# Cross-collection search

Status: approved, not yet implemented
Roadmap: [docs/roadmap.md](../../roadmap.md) — "Cross-collection search" (`feature/cross-collection-search`)

## Problem

A user can be a member of several collections (`Collection.members`), but every
browsing surface today (`/collection`, `/wishlist`, item detail/edit) is scoped
to a single "active" collection (`res.locals.activeCollectionId`, set by
`middleware/collectionMiddleware.ts`). There is no way to ask "which of my
collections has this album?" without switching into each one and searching
separately.

## Goal

A dedicated search page that queries across every collection the user belongs
to, in any role, and lets them jump straight to a result.

Out of scope (separate roadmap items): full-text search of comments/tracklist,
saved filter presets.

## Why this is architectural, not bounded

Every item-serving route filters by the single active collection. Search
results need to link to items that may live in a collection other than the
active one. Rather than change those routes to accept an explicit collection
id (which would touch interfaces several other flows depend on), this design
reuses the existing `POST /collection/switch` route unchanged: a result link
switches the active collection, then redirects into the normal (already
collection-scoped) item detail route. That keeps every existing route's
contract exactly as it is today.

## Architecture

- New route: `GET /search`, `requireAuth` only (no `collectionMiddleware` —
  this page is deliberately not scoped to one collection).
- New view: `views/search.ejs`, modeled on `views/collection.ejs`'s result
  cards but simplified (no per-type filters, no sort menu — see "Scope
  decisions" below).
- New nav entry (`views/partials/header.ejs`) pointing at `/search`.
- No changes to any existing route, model, or middleware.

## Data flow

1. `Collection.find({ 'members.user': req.user._id })` → the user's
   collections, each with `{ _id, name, role }` (role read from the matching
   entry in `members`).
2. No `?q=` query param → render the empty state ("type to search"). No item
   query runs at all — this avoids paging through every item in every
   collection by default.
3. With a query (`req.query.q`, trimmed, minimum 2 characters — enforced both
   client-side on the input and server-side in the route, to avoid a
   single-character query fanning out into a huge regex scan across every
   collection): fetch every relevant collection's `Settings` doc in one
   query, `Settings.find({ collection: { $in: collectionIds } })`, keyed by
   collection id (falls back to "no settings" the same way
   `settingsMiddleware.ts` already does for a collection with none).
4. Build one Mongo sub-filter per collection:
   ```js
   {
     collection: id,
     $or: [
       { title: regex },
       ...registry.getAll().map(p => p.creatorField).filter(unique)
         .map(field => ({ [field]: regex }))
     ]
   }
   ```
   Reading `creatorField` from `registry.getAll()` (rather than
   hardcoding `artist`/`author`/`director`/`developer`) keeps this correct if
   a plugin's creator field ever changes, and covers custom plugins too.
   Then run this collection's sub-filter through the existing
   `applyEnabledModulesFilter(subFilter, settings)` and
   `applyVisibilityFilter(subFilter, role === 'admin', settings)` helpers
   (`utils/visibilityHelper.ts`) unmodified, exactly as
   `core/routes/collectionRoute.ts` does today for the single-collection
   case.
5. Combine every collection's sub-filter into one top-level query,
   `{ $or: subFilters }`, and run one `Item.find(...).sort({ added_at: -1
   }).skip(...).limit(...)` call. Pagination follows the same
   25/50/100-per-page pattern as `/collection`.
6. For each result: resolve its plugin via `registry.getByKind(item.kind)`,
   call `plugin.formatForView(item)`, and attach the owning collection's
   `{ id, name }` (from the map built in step 1) for the result card's badge
   and for the switch link.

## UI

`search.ejs`:
- A single search input (title/artist), submits via the same
  `URL.searchParams` + full page reload pattern `collection.ejs` already
  uses (`reloadPage()`-style, no client framework).
- Empty state (no `q`): short prompt, no cards, no query.
- Result cards: same visual language as `collection.ejs`'s
  `.album-card` (cover, title, creator, format badge), plus a small
  "◆ {{collectionName}}" pill.
- Each card is a `<form method="POST" action="/collection/switch">` with
  hidden `collectionId` and `redirectTo` (the item's detail URL,
  `plugin.routePrefix + '/' + item._id`) instead of a plain `<a>`. This is
  exactly the existing switch mechanism, already membership-checked and
  already validating `redirectTo` is a safe same-site path
  (`core/routes/collectionRoute.ts`'s `/collection/switch` handler) — no new
  validation code needed.
- Pagination controls reused from the same visual pattern as `/collection`
  (no need to carry the page-jump input from the earlier fix — result counts
  here are expected to be small relative to a single collection).

## Scope decisions (resolved during design)

- **Collections searched:** all memberships, any role (admin/editor/viewer).
- **Wishlist items:** included (no `in_wishlist` filter applied).
- **Match fields:** title + creator field only. Genre/format/full-text are
  out of scope for this pass.
- **Empty query:** shows a prompt, does not list every item by default.
- **No per-type filters, no sort control:** unlike `/collection`, this page
  has one job (find where an item lives) — filters and sorting are the
  per-collection page's job. Keeping this page to a search box and result
  cards avoids re-implementing `/collection`'s whole filter UI across
  N collections' worth of differing schemas (genres/styles/platforms differ
  per type and per collection's extra fields).

## Error handling

Same pattern as every other route in this codebase: try/catch around the
route body, `res.status(500).send(req.t('errors.generic_server_error'))` on
failure. No new error paths beyond what `/collection` already handles.

## Testing

No automated test suite exists in this repo (`npm test` is a stub). This
follows the project's existing manual-verification pattern:
- Seed a second collection and add the existing test user as a member (any
  role) of both.
- Confirm a search matches items in both collections, each showing its own
  collection badge.
- Confirm clicking a result from the non-active collection switches into it
  and lands on the item's detail page.
- Confirm the empty-query state shows no results and no item query fires.
- Confirm a user who is a member of only one collection still gets correct
  results (the `$or` of one sub-filter degenerates to that collection's
  normal scoped query).
