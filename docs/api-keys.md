# 🔑 API Configuration

DVinyl uses external services to fetch metadata, cover art and, for music, market values. You only
need the keys for the media types you actually plan to use, and **every key is free**.

| Media type | Service | Environment variable | Needed if you collect |
| :--------- | :------ | :------------------- | :-------------------- |
| Music | Discogs | `DISCOGS_TOKEN` | Vinyls, CDs, cassettes |
| Books | Hardcover | `HARDCOVER_API_KEY` | Books, manga, comics |
| Movies | TMDB | `TMDB_API_KEY` | Blu-ray, 4K, DVD, VHS |
| Games | IGDB (Twitch) | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Video games |
| LEGO | Rebrickable | `REBRICKABLE_API_KEY` | LEGO sets |

Add the keys you need to your `.env` file. Any media type whose key is missing simply stays disabled
in the admin panel until you provide it.

For optional AI-assisted import (text, photo, or barcode fallback), see the [AI Assist guide](./ai.md)
— it is not tied to one media type and runs across the whole collection.

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

## 🧱 Rebrickable (LEGO)

Used for LEGO set metadata, themes, piece counts and covers.

1. Create a free account on [Rebrickable](https://rebrickable.com/).
2. Open the [API settings page](https://rebrickable.com/api/) and copy your **API key** (generate
   one if you do not have it yet).
3. Paste it into your `.env` as `REBRICKABLE_API_KEY`.

---

> [!WARNING]
> Never commit your `.env` file. It holds sensitive credentials that must stay private.

[← Back to the README](../README.md)
