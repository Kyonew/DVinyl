# 🔗 Public share links

Let anyone browse a collection read-only with a link or a QR code - no account, no guest
credentials to maintain. A common use: a QR code taped next to a shelf so visitors can scan it and
browse what is there on their own phone.

## What a share link can and cannot do

A share link is **read-only**. Whoever opens it can browse the collection, search, filter, open an
item's detail page and, for a TV show, follow it to a season and its episode list. It can never:

- Add, edit, delete or refresh an item, or annotate an episode
- See the wishlist, the dashboard, the admin panel, settings, backups or any other collection
- Create an account or otherwise leave a trace

Two things a `viewer` member sees are kept from a share link, because a public link reaches further
than a member ever does:

- **Where items are kept.** The Location field disappears from the item page and from the filters,
  its values are never listed, and it is dropped from the cards even when the collection chose to
  display it there. Handing out a link should not tell anyone which room, shelf or safe holds what.
- **Who is behind the collection.** "Added by" and "Last modified" are not shown, so a link says
  what is on the shelf without naming the household around it.

A collection can have **several share links at once**, each independent. Disabling, regenerating
or deleting one never touches the others.

## Creating a link

1. Open the collection's **Admin panel** and scroll to **Public share links**.
2. Click **New share link**.
3. Optionally name it (e.g. "Vinyls only") - the name is only shown to you, never to visitors.
4. Optionally narrow what it shows: check specific types (Music, Books, Games...) and, within a
   type, specific formats (e.g. only `CD` and `Vinyl`, leaving Cassette and Digital out). Leave
   everything unchecked to share the whole collection.
5. Click **Create link**.

Each link gets its own URL and QR code, generated on your own instance - the link's token is never
sent to a third-party QR service.

## A few scoped-link examples

- Only Vinyls: check **Music**, then check only **Vinyl** under it.
- Only CDs: check **Music**, then check only **CD**.
- Vinyls and CDs, but not Cassettes: check **Music**, then check **Vinyl** and **CD**.
- A whole media type, any format: check **Music** and leave every format under it unchecked.

> [!TIP]
> Checking a format automatically checks its type for you. If you ever submit a format without a
> type checked (say, with JavaScript disabled), the server still infers the type from the format,
> so the selection is never silently dropped.

## Managing an existing link

Each link's card shows its QR code, its URL (with a copy button) and its scope, plus:

- **Disable / Enable** - pauses the link without losing its URL/QR code. Re-enabling brings back
  the exact same link.
- **Regenerate** - mints a brand new token for that link. The old URL and QR code stop working
  immediately; anyone who only had the old one loses access.
- **Delete** - removes the link entirely.
- Editing the checkboxes and clicking **Save changes** updates what that link shows, in place -
  the URL and QR code stay the same.

> [!WARNING]
> A share link's token is the only thing protecting it - anyone who has the URL or scans the QR
> code can browse what it exposes, for as long as it stays enabled. Regenerate or delete a link if
> it was shared more widely than you intended.

## Interaction with hidden items

If the collection already hides specific items, genres or types from non-admin viewers (the
**Visibility** settings), those stay hidden from share links too.

## Shows held as seasons

A TV show stored as a show plus one item per season is shared as a whole. The shelf shows the show,
its page lists the seasons someone owns, and each season opens on its own page with its episodes -
including a season whose format sits outside a scoped link, since the link already shows the show
that holds it. A link that excludes the show excludes its seasons with it.

---

[← Back to the README](../README.md)
