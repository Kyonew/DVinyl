# 🔑 API Configuration

DVinyl uses external services to fetch metadata, cover art and, for music, market values. You only
need the keys for the media types you actually plan to use, and **every key is free**.

| Media type | Service | Environment variable | Needed if you collect |
| :--------- | :------ | :------------------- | :-------------------- |
| Music | Discogs | `DISCOGS_TOKEN` | Vinyls, CDs, cassettes |
| Books | Hardcover | `HARDCOVER_API_KEY` | Books, manga, comics |
| Movies | TMDB | `TMDB_API_KEY` | Blu-ray, 4K, DVD, VHS |
| Games | IGDB (Twitch) | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Video games |
| Games | ScreenScraper (optional) | `SCREENSCRAPER_DEV_ID`, `SCREENSCRAPER_DEV_PASSWORD`, optionally `SCREENSCRAPER_USER`, `SCREENSCRAPER_PASSWORD` | Retro, arcade and MS-DOS games |
| LEGO | Rebrickable | `REBRICKABLE_API_KEY` | LEGO sets |
| Board games | BoardGameGeek | `BGG_API_KEY` | Board games |

Add the keys you need to your `.env` file. Any media type whose key is missing simply stays disabled
in the admin panel until you provide it.

A media type can look things up in more than one service, and it is usable as soon as **one** of
them is configured. The admin panel lists them per module, behind the ⚙ button: each line says what
the service answers (search, images, or both) and which variable it is still waiting for. Some are
picture-only and need no key at all, so cover art keeps working on an instance that configured
nothing: Open Library for books, iTunes for music and games. Games also uses TMDB for extra artwork
if `TMDB_API_KEY` happens to be set, and quietly skips it otherwise.

## 🎵 Discogs (Music)

Used for album metadata, tracklists and market value.

1. Log in to [Discogs.com](https://www.discogs.com/).
2. Go to **Settings > Developers**.
3. Click **Generate new token**.
4. Copy the token into your `.env` as `DISCOGS_TOKEN`.

## 📚 Hardcover (Books)

Used for book metadata and covers.

1. Create an account on the [Hardcover website](https://hardcover.app/).
2. Open the [API section](https://hardcover.app/account/api) and copy your **token** (do not include
   the word "bearer", so it should look like `eyJhb...`).
3. Paste it into your `.env` as `HARDCOVER_API_KEY`.

## 📀 TMDB (Movies)

Used for movie metadata and posters.

1. Create an account on [The Movie Database](https://www.themoviedb.org/).
2. Find your API key (not the "token") on [this page](https://www.themoviedb.org/settings/api).
3. Paste it into your `.env` as `TMDB_API_KEY`.

## 🎮 IGDB (Games)

Used for video game metadata and covers. IGDB is powered by Twitch, so you create the credentials in
the Twitch developer console.

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and log in (2FA
   required).
2. Click **Register Your Application**.
3. Name it "DVinyl", set the OAuth Redirect URL to `https://localhost`, and set the category to
   **Application Integration**.
4. Once created, copy the **Client ID**.
5. Click **New Secret** to generate a **Client Secret**.
6. Paste both into your `.env` as `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.

## 🕹️ ScreenScraper (Games, optional)

A second source for video games, next to IGDB: [ScreenScraper](https://www.screenscraper.fr/)
documents retro consoles, arcade and MS-DOS games far better. Once it is configured, the games
add page offers a choice between the two, and the admin panel sets which one comes first.

ScreenScraper asks for two pairs of credentials:

- **The developer pair** (`SCREENSCRAPER_DEV_ID`, `SCREENSCRAPER_DEV_PASSWORD`) identifies the
  software. ScreenScraper issues it to the people who publish a scraper, on their
  [developer forum](https://www.screenscraper.fr/forumsujets.php?frub=12&numpage=0), and not to
  each of its users. The source stays off until both are set.
- **Your member account** (`SCREENSCRAPER_USER`, `SCREENSCRAPER_PASSWORD`) is optional: it is the
  login of a free [screenscraper.fr](https://www.screenscraper.fr/) account. ScreenScraper counts
  its quotas per member, so without one every lookup draws on the smallest allowance there is.
  Set it as soon as you use the source for more than a few games.

DVinyl keeps within the quota ScreenScraper reports (requests per day, requests at once) and stops
asking once the day's allowance is spent. Covers are copied into your instance when you add a game,
so browsing your collection never counts against it.

## 🧱 Rebrickable (LEGO)

Used for LEGO set metadata, themes, piece counts and covers.

1. Create a free account on [Rebrickable](https://rebrickable.com/).
2. Open the [API settings page](https://rebrickable.com/api/) and copy your **API key** (generate
   one if you do not have it yet).
3. Paste it into your `.env` as `REBRICKABLE_API_KEY`.

## 🎲 BoardGameGeek (Board games)

Used for board game metadata, designers, publishers and covers. Since July 2025 BGG requires a
registered application token for every XML API request (unauthenticated calls now fail with 401).

1. Read [Using the XML API](https://boardgamegeek.com/using_the_xml_api) and the
   [registration thread](https://boardgamegeek.com/thread/3525319/registration-to-use-the-xml-api-and-obtain-soon-to)
   for BGG's current registration process.
2. Register your application and obtain an application token.
   > [!NOTE]
   > BGG approves these by hand, so it can take up to 7 days to get your token. Apply before you
   > need it.
3. Paste it into your `.env` as `BGG_API_KEY`.

---

> [!WARNING]
> Never commit your `.env` file. It holds sensitive credentials that must stay private.

[← Back to the README](../README.md)
