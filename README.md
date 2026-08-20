<p align="center">
  <img src="./docs/img/banner.webp" alt="DVinyl banner" width="100%">
</p>

<p align="center">
  <b>DVinyl</b> is a modern, self-hostable collection manager for physical media lovers.<br>
  Catalog, value and organize your vinyls, CDs, books, movies, games and more, all from one cozy place.
</p>

<p align="center">
  <a href="https://demo.kyonew.me/"><img src="https://img.shields.io/badge/Live_Demo-demo.kyonew.me-6E56CF?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Live Demo"></a>
  <a href="./docs/getting-started.md"><img src="https://img.shields.io/badge/Documentation-Read-3178C6?style=for-the-badge&logo=gitbook&logoColor=white" alt="Documentation"></a>
  <a href="https://github.com/Kyonew/DVinyl/wiki"><img src="https://img.shields.io/badge/Wiki-Guides-24292F?style=for-the-badge&logo=github&logoColor=white" alt="Wiki"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/Version-3.1.3-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/Self--Hosted-Yes-green.svg" alt="Self-Hosted">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white" alt="Docker">
</p>

---

## Hey there 👋

DVinyl is a little home for your physical collection. It lives on your own server, pulls in cover
art and metadata from the big databases (Discogs, Hardcover, TMDB, IGDB, Rebrickable), can even
estimate what your music is worth, and lays it all out on a dashboard you get to shape yourself.

DVinyl is **plugin based**: every media type is a plugin, so you turn on only what you
care about, and you can add your own type without touching the core.

Want to see it before installing anything? Have a look at the [live demo](https://demo.kyonew.me/), a
read-only preview of a finished instance.

## What it can do

### 📦 Your whole shelf, in one place
- **Many formats.** Music (vinyls, CDs, cassettes), books (manga, comics, hardcover), movies
  (Blu-ray, 4K, DVD, VHS, LaserDisc), video games and LEGO sets.
- **Multiple collections.** Keep separate libraries (yours, the family's, a specific room) and
  switch between them whenever you like.
- **Smart import.** Add an item by ID or barcode, or bulk import a whole existing collection
  (a full Discogs library, for example) in one click.
- **Barcode scanner.** Point at the barcode of a physical item and let DVinyl find it for you.
- **Market value.** Live low, median and high estimates for your music collection.
- **Wishlist.** Keep an eye on the pieces you are still hunting for.

### 🎨 Make it yours
- **14 color themes.** Ocean, Forest, Sunset, Sakura, Midnight and more, each with a light and a
  dark variant, and you can even set a different theme per category.
- **Modular dashboard.** Pick the stat widgets you want and add your own navbar shortcuts.
- **Responsive.** Built to feel right on mobile too.
- **Multilingual.** English, French, German, Spanish and Italian.

### 👥 Share it, your way
- **Users and roles.** Invite people to a collection as admin, editor or viewer, so everyone gets
  the right level of access.
- **SSO login (OIDC).** Optional single sign-on with providers like Authentik, Keycloak, Authelia
  or pocketID, with optional automatic account creation from an identity provider group.
- **Private or shared.** Keep your collection to yourself or open it up for others to browse.
- **Public share links.** Generate a read-only link or QR code so anyone can browse a collection
  (or just part of it, e.g. only Vinyls) without an account.

## Built-in plugins

| Plugin | Media | Metadata source |
| :----- | :---- | :-------------- |
| Music  | Vinyls, CDs, cassettes | Discogs |
| Books  | Books, manga, comics   | Hardcover |
| Movies | Blu-ray, 4K, DVD, VHS  | TMDB |
| Games  | Video games            | IGDB |
| LEGO   | LEGO sets              | Rebrickable |

Every plugin can be turned on or off per collection from the admin panel.

## Build your own type

DVinyl is made to grow with you. There are two ways to add a new kind of collection:

- **Plugin editor (no code).** Create a manual collection type right from the app, with your own
  fields, formats, icon and colors. No restart, no coding required.
  See the [Plugin editor guide](https://github.com/Kyonew/DVinyl/wiki) on the Wiki.
- **Code plugin (with API).** Drop a `plugins/<id>/` folder that exports a plugin definition to add
  a full media type with its own external API, importers and stats.
  See the [Plugin development guide](./docs/plugin-development.md).
  Built one you are proud of? Do not hesitate to open a PR, I would genuinely love to see it! 🙌

## Quick start (Docker)

The fastest way to run DVinyl is the pre-built Docker image. All you need is a `docker-compose.yml`
and a `.env` file.

1. Create a `docker-compose.yml` (the [Docker guide](./docs/docker.md) has the full file).
2. Set your environment variables in a `.env` file (see [API keys](./docs/api-keys.md)).
3. Start it up:
   ```bash
   docker compose up -d
   ```

Then open `http://localhost:3099` and you are good to go.

> [!TIP]
> If you have `make` installed, `make docker-up` runs step 3 for you. Run `make help` to see every
> available command.

No Docker? No worries. Have a look at the other ways to install and run DVinyl in the
[Getting started guide](./docs/getting-started.md).

## Documentation

| Guide | What is inside |
| :---- | :------------- |
| [Getting started](./docs/getting-started.md) | Manual installation and requirements |
| [Docker deployment](./docs/docker.md) | Deploy with Docker Compose (recommended) |
| [API keys](./docs/api-keys.md) | Get your Discogs, Hardcover, TMDB, IGDB and Rebrickable keys |
| [Plugin development](./docs/plugin-development.md) | Build your own media type as a code plugin |
| [Public share links](./docs/sharing.md) | Let anyone browse a collection (or part of it) read-only, no account needed |
| [Wiki](https://github.com/Kyonew/DVinyl/wiki) | User guides and no-code tutorials |

## Tech stack

| Component | Technology |
| :-------- | :--------- |
| Backend | Node.js, Express |
| Database | MongoDB |
| Frontend | EJS templates |
| Styling | Tailwind CSS |
| Localization | i18next |
| Metadata APIs | Discogs, Hardcover, TMDB, IGDB, Rebrickable |

## Contributing

This is honestly my first app of this kind, so I am wide open to help, ideas and advice. If you
want to jump in, have a look at [CONTRIBUTING.md](./.github/CONTRIBUTING.md) and the
[Code of Conduct](./.github/CODE_OF_CONDUCT.md) first. Bug reports and feature ideas are just as
welcome as code.

## License

Distributed under the MIT License. See [LICENSE](./LICENSE) for the details.

> [!NOTE]
> Please note that parts of the frontend and comments were generated with the assistance of AI tools. While I reviewed and corrected the output where necessary, this project is not 100% human-made.
>
> Your feedback is highly appreciated, even for the backend, where I may have made significant errors. I would be grateful for any suggestions or comments to improve the project.
>
> Thank you for your understanding <3

