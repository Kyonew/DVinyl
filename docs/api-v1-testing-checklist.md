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
