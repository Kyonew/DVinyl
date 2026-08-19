# Roadmap

Feature ideas to work through one at a time, each on its own branch off `main`.

| Status | Feature | Branch | Notes |
|--------|---------|--------|-------|
| todo | Bulk edit | `feature/bulk-edit` | Multi-select items, batch-update location/genre/format/quantity |
| todo | Duplicate detection/merge tool | `feature/duplicate-merge` | Surface likely dupes for review, beyond the add-time exact match |
| todo | Loan tracking | `feature/loan-tracking` | Mark an item lent out, to whom, since when |
| todo | Audit log per collection | `feature/collection-audit-log` | Who added/edited/deleted what, useful for multi-member collections |
| todo | Cross-collection search | `feature/cross-collection-search` | For users with access to several collections |
| todo | Saved filter presets | `feature/saved-filters` | e.g. "My want-to-buy vinyl", "Sealed only" |
| todo | Full-text search | `feature/fulltext-search` | Search across comments/tracklist, not just title/artist |
| todo | Printable QR/barcode labels | `feature/qr-labels` | Per item or shelf location, linking to the detail page. `qrcode` npm package already a dependency, currently unused |
| todo | CSV/spreadsheet export | `feature/csv-export` | Per-collection tabular export; backup today is full-DB JSON only |
| todo | Price-estimate history | `feature/price-history` | Value-over-time chart, using the existing estimate feature as a data source |
| todo | Price-drop/restock alerts | `feature/price-alerts` | For wishlist items, piggybacking on the existing price-estimate provider |
| todo | Installable PWA | `feature/pwa-manifest` | `sw.js.ejs` service worker already exists; add a manifest + offline shell |

## Status legend

- `todo` — not started
- `in-progress` — branch open, work underway
- `done` — merged into `main`

## Workflow

1. Pick a `todo` row, create its branch off `main`.
2. Update the row's status to `in-progress` while work is active.
3. Open a PR against `main` (upstream `Kyonew/DVinyl`) when ready.
4. On merge, flip status to `done` and note the PR number in Notes.
