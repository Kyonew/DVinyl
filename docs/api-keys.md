# 🔑 API Configuration

DVinyl relies on external APIs to fetch album data and visuals. Follow these steps to get your Discogs & Google API keys.

## 🎵 Discogs API (Required)
*Used for fetching album metadata, tracklists, and market value.*

1.  Log in to [Discogs.com](https://www.discogs.com/).
2.  Go to **Settings > Developers**.
3.  Click **Generate new token**.
4.  Copy this token and paste it into your `.env` file as `DISCOGS_TOKEN`.

## 🔎 Google Custom Search (Optional)

*Used to find secondary images (back covers, vinyl variants) via the "Search" button.*

### 1. Get an API Key
1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a new project and enable the **Custom Search API**.
3.  Go to **Credentials** and create an **API Key**.
4.  Paste it into `.env` as `GOOGLE_API_KEY`.

### 2. Get a Search Engine ID (CX)
1.  Go to the [Programmable Search Engine](https://programmablesearchengine.google.com/).
2.  Create a new search engine.
3.  Under "What to search", select **Image search**.
4.  Go to the search engine settings and copy the **Search Engine ID**.
5.  Paste it into `.env` as `GOOGLE_CSE_ID`.

---

⚠️ **Security Note:** Never commit your `.env` file to GitHub. It contains sensitive credentials that should remain private.

[← Back to README](../README.md)  
