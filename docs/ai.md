# 🤖 AI Assist

DVinyl can optionally use an AI model to help fill in metadata when you import items. This feature
is bring-your-own-key and completely optional — if you do not set it up, everything works the same
as before.

## What it can do

The AI assist helps in three ways:

- **Barcode fallback:** When you scan a barcode and the metadata service does not recognize it (or
  is unreachable), the AI can read the barcode image and invent a guess at the title and creator,
  so you get something to start from instead of nothing.
- **Text import:** When you paste or upload text (a book review, a product description, an article
  snippet), the AI extracts the title, creator, year, and any other field your plugin declares, so
  you can add items without looking up each one.
- **Photo import:** Point a camera at a physical item (book cover, album art, game box) and the AI
  reads it, pulling out the same metadata as text import would.

## Off by default

The AI assist is disabled until you configure it. Even after setup, it only runs on the specific
items you ask it to — nothing happens automatically in the background.

## Getting started

To use the AI assist, you need an API key from an AI provider. Many are free to get started, and
you only need the key for the types you want to import.

### Preset providers

DVinyl comes with presets for five major providers. Pick one, get a key, and you are ready to go:

| Provider | What you need | How to get a key |
| :------- | :------------ | :--------------- |
| OpenRouter | One key, hundreds of models | [openrouter.ai/keys](https://openrouter.ai/keys) |
| OpenAI | One key, one family of models | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic | One key, one family of models | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| Google Gemini | One key, one family of models | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Custom (Ollama, LM Studio) | None needed | See [Local endpoints](#local-endpoints) below |

### Local endpoints

If you run **Ollama** or **LM Studio** on the same machine or your network, you can point DVinyl at
it for free — no API key is needed. Just choose "Custom (OpenAI-compatible)" and enter the base
URL of your endpoint (for example `http://localhost:11434` for Ollama, or `http://localhost:1234`
for LM Studio). The model field should match what you have running.

## Configuration

### From the admin panel

Open **Settings > AI Assist**. You will see a form with:

- **Provider:** Choose from the presets, or "Custom" for a local or self-hosted endpoint.
- **API key:** Paste the key you got from your provider (ignored if using a local endpoint).
- **Base URL:** Only shown if you choose "Custom"; enter your endpoint's base URL.
- **Model:** The model ID to use (the default for each provider is already filled in, but you can
  change it to any other model the provider offers).
- **Enable for vision:** A second model ID for photo import (reading images). Leave it as the first
  model unless your provider has a separate vision-capable model.

There is also a **Test connection** button so you can verify your setup works before saving.

Once you are happy, click **Save**, and the AI assist is ready to use on the collection.

### From environment variables

You can also configure the AI assist through environment variables, which is useful for Docker or
automated deployments. They override anything you set in the admin panel:

```
AI_PROVIDER=openrouter
AI_API_KEY=YourAIProviderKeyHere
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-4o-mini
```

If you supply an API key through the environment, the feature turns on automatically, even if the
admin panel says it is disabled. This matches how every other external service in DVinyl works
(Discogs, TMDB, etc.), so Docker-secrets deployments never have to touch the UI.

**Precedence:** Environment variables always win. If `AI_API_KEY` is set, DVinyl uses it and ignores
the key you typed in the admin panel. Same for `AI_PROVIDER`, `AI_BASE_URL` and `AI_MODEL`. This
lets your infrastructure team pin a provider in code, while ops teams can swap keys without changing
deploys.

## Security

Your API key is stored encrypted in the database, not as plain text. Encryption uses the
`SESSION_SECRET` from your `.env` file as the key. This means:

- **Key rotation:** If you rotate `SESSION_SECRET`, you will need to re-enter the AI API key — the
  old encrypted value can no longer be decrypted.
- **Environment variables bypass encryption:** Keys set through `AI_API_KEY` are never stored; they
  are read fresh on every request from the environment.

## A note on accuracy

**AI models invent details.** Even the best models sometimes make up plausible-sounding titles,
creators, years or genres that do not match the item you showed them. That is why every AI-assisted
import path ends in a **review screen** before saving: you see what the AI filled in, you can edit
anything that looks wrong, and only then does it get saved. The AI assist is a shortcut to fill the
form faster, not a reliable automatic metadata source — treat the results as a first draft, always.

---

[← Back to the README](../README.md)
