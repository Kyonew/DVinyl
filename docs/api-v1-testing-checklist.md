# /api/v1 manual acceptance checklist

`/api/v1` now has an automated integration suite: run `npm test`. Use this page
as the fallback checklist for what the suite cannot cover — the full-stack setup
gate (`app.ts`'s 503 on a zero-user instance), IP blocking, and anything you want
to confirm through a browser or a real mobile client. Replace `$BASE`,
`you@example.com`/`yourpassword`, `$CID`, `$ITEMID` with real values.

## Setup
```bash
BASE=http://localhost:3000
```

## Auth
- [x] `POST $BASE/api/v1/auth/login` with valid credentials → 200, `{accessToken, refreshToken, expiresIn}`
- [x] Same with wrong password → 400
- [x] 4 consecutive wrong-password attempts for the same email → 4th is 429
- [x] `GET $BASE/api/v1/auth/me` with a valid `Authorization: Bearer` → 200, `{user, collections}`
- [x] Same with no `Authorization` header → 401
- [x] Same with a garbage token → 401
- [x] `POST $BASE/api/v1/auth/refresh` with a valid refresh token → 200, new token pair
- [x] Re-using the same (now rotated-out) refresh token → 401
- [x] `POST $BASE/api/v1/auth/logout` with a valid refresh token → 200 `{success:true}`; that token then fails `/auth/refresh` with 401

## Collections
- [x] `GET $BASE/api/v1/collections` → 200, list includes every collection the user belongs to, each with the correct `role`
- [x] `GET $BASE/api/v1/collections/$CID/items` → 200, paginated list; `totalItems`/`totalPages` match the web collection page's count
- [x] `GET $BASE/api/v1/collections/$CID/wishlist` → 200, paginated wishlist items only (owned and contained items excluded); `?type=`/`?search=` filter as on the collection listing
- [x] `GET $BASE/api/v1/collections/$CID/wishlist/stats` → 200; `stats.total` counts wishlist quantities only, matching the web wishlist
- [x] `?type=<a real plugin id>` narrows results to that kind only
- [x] `?search=<a real title substring>` returns only matching items
- [x] `?page=2` (with more than one page of items) returns the second page, not a repeat of page 1
- [x] A collection id the user is not a member of → 403
- [x] A syntactically valid but non-existent collection id → 404
- [x] `GET $BASE/api/v1/collections/$CID/stats` → 200; `stats.total` matches the web dashboard's total for the same collection

## Items
- [x] `GET $BASE/api/v1/items/$ITEMID` for an item the user can see → 200, full item detail
- [x] An item belonging to a collection the user is not a member of → 403
- [x] A non-existent item id → 404
- [x] No `Authorization` header on any of the above → 401
- [x] An item hidden by the collection's `visibility` settings (`hiddenItems`/`hiddenGenres`/`hiddenTypes`) → 404, same as it is on the listing endpoint

## Add flow / sources
- [ ] `GET $BASE/api/v1/plugins` → every plugin carries `hasSearch`, `canRefresh` and a `sources[]` array (`{id,name,searchable,configured}`)
- [ ] `GET $BASE/api/v1/plugins` → `games` carries `searchFormFields:["platform"]`; `music` carries `searchFormFields:[]`
- [ ] `POST …/collections/$CID/items/search` `{"pluginId":"games","query":"zelda"}` → 200, `source` names the plugin's first configured source, `sources[]` lists the picker
- [ ] Same body with `"platform":"SNES"` → 200 and results are narrowed to that system (the field is forwarded to the source; a plugin without `searchFormFields` ignores unknown body keys)
- [ ] Same body with `"source":"screenscraper"` (configured) → 200, results come from ScreenScraper and `source:"screenscraper"`
- [ ] `GET …/items/confirm?pluginId=games&externalId=<id>&source=screenscraper` → 200 with `item.source`/`item.source_id`; posting that pair back to `POST …/items` stores it
- [ ] `POST …/items/:itemId/refresh-info` on an item added from a non-default source → 200, patched through that source
- [ ] `POST …/refresh-all` for `games` (a plugin that only declares `mergeRefresh`) → 202, not 400

## Lists & playlists
- [ ] `GET $BASE/api/v1/collections/$CID/lists` → 200 `{lists:[…],canMakePlaylists}`; an empty collection answers `lists: []`
- [ ] `POST …/lists` `{"name":"Backlog"}` (editor) → 201; `{"name":"  "}` → 400; `{"name":"X","kind":"nope"}` → 400; as a viewer → 403
- [ ] `GET …/lists/$LID` → 200 with ordered `entries`; a list from another collection → 404
- [ ] `POST …/lists/$LID/entries` `{"items":[id]}` → 200 `{added,count}`; adding an item of another collection adds nothing
- [ ] A playlist (`kind:"tracks"`) accepts `{"item":id,"track":id}`; a track id from another item → 404
- [ ] `PUT …/lists/$LID/entries` `{"order":[entryId,…]}` → 200 reorders; a repeated or missing id → 409 and no change
- [ ] `DELETE …/lists/$LID/entries/$ENTRYID` → 200; a second call → 404
- [ ] `GET …/lists/$LID/candidates?q=…` → 200 `{results}` with `inList` flags
- [ ] `GET …/lists/for-item?item=$IID` → 200 with `contains` true for the lists that hold it

## Collection info
- [ ] `GET $BASE/api/v1/collections/$CID/info` as a member of a collection whose page is on with content → 200, `visible:true`, `info.body` plus rendered `bodyHtml`
- [ ] Same request as a member when the page is off or empty → 200, `info:null`, `bodyHtml:""`, `visible:false` (the draft is not disclosed)
- [ ] Same request as a collection admin while the page is off → 200, the saved draft with `visible:false` and `draft:true`
- [ ] `PATCH …/info` `{"title":"New"}` (admin) → 200; other fields keep their values; `{"enabled":"yes"}` → 400; as a viewer/editor → 403
- [ ] `PATCH …/info` with `images` containing a `data:` URL → the image is dropped; removing an image not used by any item deletes its file
- [ ] `POST …/info/preview` `{"body":"# Hi"}` (admin) → 200 `{html:"<h1>Hi</h1>"}`; a non-string body → 400
- [ ] `POST …/info-images` (admin) with a JPEG → 201 `{url}`; with a PNG → 400; as a viewer/editor → 403

## Shelves (read)
- [ ] `GET $BASE/api/v1/collections/$CID/shelves` → 200 with every compartment name plus any stray item `location`, sorted and deduped
- [ ] `GET …/furniture` → 200 with pieces in `order`, each cell carrying `name`, `key`, `row`, `column`, `capacity` and `count`
- [ ] A cell's `count` excludes a wishlist item and an item in another collection; an item hidden by the collection's visibility settings is not counted for a viewer but is for an admin
- [ ] `GET …/items?location=Salon` → exactly that compartment's items (`totalItems` is the compartment's size); `?location=Étagère du salon` does not return the `Salon` items
- [ ] `GET …/items?unshelved=true` → items whose location names no compartment, including items with no location at all
- [ ] `?location=…&unshelved=true` together → 400
- [ ] `POST …/items` with `{"location":"salon"}` when the collection's shelf is `Salon` → the item stores `Salon`; a brand-new name creates exactly one compartment
- [ ] `PATCH …/items/:itemId` with `{"location":""}` → the item is off its shelf

## Fresh-instance edge case
- [ ] On an instance with zero users (before `/setup`), `POST $BASE/api/v1/auth/login` → 503 JSON (not an HTML redirect) — not re-run this pass (would require wiping the shared local test DB); confirmed by reading the code instead: `app.ts:249-250` gates every `/api/v1` request behind the same `setupRequired` check with a `503 {success:false,...}` JSON body.

## Maintenance

- [x] `POST $BASE/api/v1/collections/$CID/refresh-all` `{"pluginId":"music"}` → 202, `{job:{status:"running",pluginId:"music",mode:"all"}}`
- [x] `GET $BASE/api/v1/collections/$CID/refresh-jobs/$JOBID` (the id above) → 200; polling reaches `status:"finished"` with `result.refreshed + result.failed == result.total`
- [ ] A second `refresh-all` for the same plugin while one runs → 409 `{code:"refresh_running", job}`
- [ ] A `refresh-all` for a different plugin while one runs → 202
- [ ] `POST …/refresh-all` with `{"pluginId":"nope"}` → 404; with a plugin that has no refresh → 400
- [ ] `POST $BASE/api/v1/collections/$CID/delete-last-items` `{"count":1,"pluginId":"music"}` → 200 `{success:true,deleted}`
- [ ] `…/delete-last-items` with `count:10001` → 400 `{error:"Invalid count"}`; with `{"pluginId":"nope"}` → 400 `{error:"Unknown plugin"}`
- [ ] `DELETE $BASE/api/v1/admin/login-logs?count=1` → 200 `{deleted:1}` (already covered in `routes/api/v1/admin.test.ts`)
