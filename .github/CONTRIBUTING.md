# Contributing to DVinyl

First off, thanks for being here! 🙌 DVinyl is honestly my first app of this kind, so any help,
idea or bit of feedback means a lot. This page explains the easiest ways to contribute, whether you
write code or not.

By taking part in the project, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to help

You do not need to be a developer to make DVinyl better:

- **Report a bug.** Open a [bug report](https://github.com/Kyonew/DVinyl/issues/new/choose) and tell
  me what happened.
- **Suggest a feature.** Got an idea? Open a [feature request](https://github.com/Kyonew/DVinyl/issues/new/choose).
- **Improve the docs.** Typos, unclear steps, missing details, all fixes are welcome.
- **Translate.** DVinyl ships in English, French, German, Spanish and Italian. New languages and
  corrections to existing ones are very welcome (see [Translations](#translations)).
- **Share a plugin.** Built a new media type? I would love to see it (see [Plugins](#plugins)).

## Before you start

For anything bigger than a small fix, please open an issue first so we can talk it through. It
avoids double work and makes sure the change fits the project. For small fixes, feel free to send a
PR straight away.

## Local setup

DVinyl runs on Node.js and MongoDB. Clone the repo first:

```bash
git clone https://github.com/Kyonew/DVinyl.git
cd DVinyl
```

If you have `make`, the shortcuts below cover everything (run `make help` to list them all).
If you do not, the plain commands are right next to them.

**Install dependencies and create your `.env`:**

```bash
make setup
# without make:
npm install
cp .env.example .env
```

Then fill in your `.env` (see the [API keys guide](../docs/api-keys.md)) and start the app:

**Run locally with Node:**

```bash
make dev
# without make:
npm start
```

**Or run everything with Docker:**

```bash
make docker-up
# without make:
docker compose up -d
```

The [Getting started](../docs/getting-started.md) and [Docker](../docs/docker.md) guides have the
full details.

## Making changes

- The project is written in **TypeScript** and runs through `tsx`. Please keep it type clean:
  `make typecheck` (or `npx tsc --noEmit`) should pass before you open a PR.
- Try to match the style of the surrounding code (naming, structure, comments).
- Keep each PR focused on one thing. Smaller PRs get reviewed faster.

## Plugins

Every media type in DVinyl is a plugin, and adding your own is a first class use case. There are
two paths:

- **No code:** the built in plugin editor lets you create a manual collection type from the app
  itself. Great for personal types. See the guide on the [Wiki](https://github.com/Kyonew/DVinyl/wiki).
- **With code:** drop a `plugins/<id>/` folder that exports a plugin definition to add a full media
  type with its own external API, importers and stats. The
  [Plugin development guide](../docs/plugin-development.md) walks you through it.

If you build a code plugin that others could enjoy, please open a PR. New official plugins are
always welcome.

## Translations

Translation files live in [`locales/`](../locales) (one JSON file per language). To fix or add
strings, edit the matching file and keep the same keys as `en.json`. To add a brand new language,
copy `en.json`, translate the values, and open a PR.

## Pull requests

1. Fork the repo and create a branch (`git checkout -b feature/my-thing`).
2. Make your changes and check that `make typecheck` passes.
3. Commit with a clear message describing what and why.
4. Push and open a pull request against the `main` branch.
5. Fill in the PR template so I can review it quickly.

That is it. Thanks again for helping out, and enjoy building! 🩵
