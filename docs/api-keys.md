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

The eight trading-card-game plugins (Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, Lorcana,
Star Wars: Unlimited, Digimon, Flesh and Blood) need **no key at all** — see
[Trading card games](#-trading-card-games-no-key-needed) below.

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

## 🃏 Trading card games (no key needed)

All eight TCG plugins use free, keyless public APIs — there is nothing to add to your `.env`.
Just enable the ones you want per collection from the admin panel and they work immediately:

| Plugin | Source |
| :----- | :----- |
| Pokémon | [TCGdex](https://www.tcgdex.net/) |
| Magic: The Gathering | [Scryfall](https://scryfall.com/) |
| Yu-Gi-Oh! | [YGOPRODeck](https://ygoprodeck.com/) |
| One Piece | [optcgapi.com](https://www.optcgapi.com/) |
| Lorcana | [Lorcana API](https://lorcana-api.com/) |
| Star Wars: Unlimited | [SWU-DB](https://www.swu-db.com/) |
| Digimon | [DigimonCard.io](https://digimoncard.io/) |
| Flesh and Blood | [goagain.dev](https://goagain.dev/) |

> [!NOTE]
> These are community-run, best-effort sources: card coverage can lag behind the very newest
> set releases. If a search comes up empty for a card you know exists, "Add manually" still works.

---

> [!WARNING]
> Never commit your `.env` file. It holds sensitive credentials that must stay private.

[← Back to the README](../README.md)
