# 🚀 Installation

There are several ways to run DVinyl. Pick the one that fits your setup, they all end up at the same
app. Your whole collection lives in one SQLite file in DVinyl's `data` folder: there is no
database server to install.

> [!NOTE]
> Upgrading from 3.x, which used MongoDB? The first start of 4.0 moves your data over by itself.
> See [Upgrading from 3.x to 4.0](./docker.md#-upgrading-from-3x-to-40).

| Method | Best for | Guide |
| :----- | :------- | :---- |
| 🐳 Docker | Most people, quickest path | [Docker deployment](./docker.md) (recommended) |
| 🧊 ZimaOS | ZimaOS / CasaOS users (1-click app store) | [Section below](#-zimaos) |
| 🧡 Unraid | Unraid server users | [Section below](#-unraid) |
| 🛠️ Manual (Node.js) | Developers and custom setups | [Section below](#-manual-nodejs) |

Before you start, grab the [API keys](./api-keys.md) for the media types you want to use. You can
always add them later.

## 🐳 Docker (recommended)

The fastest and cleanest way to run DVinyl: one container, nothing else to install.

1. Create a `docker-compose.yml` and a `.env` file.
2. Run `docker compose up -d`.
3. Open `http://localhost:3099`.

The [Docker deployment guide](./docker.md) has the full compose file, update instructions and
troubleshooting tips.

## 🧊 ZimaOS

DVinyl can be installed via the community **TwoBytes Store**:

1. In ZimaOS, go to **App Store → Sources → Add**, and paste:
   ```
   https://raw.githubusercontent.com/NoNoBzH22/TwoBytes-Store/gh-pages
   ```
   *(Older versions requiring a zip archive can use: `https://github.com/NoNoBzH22/TwoBytes-Store/archive/refs/heads/main.zip`)*
2. Install **DVinyl** from the store.
3. Open `http://<server-ip>:3099` to complete setup.

## 🧡 Unraid

DVinyl ships with an Unraid Community App template.

1. **Add DVinyl.** If it is not in Community Applications yet, add it from its template URL:
   ```
   https://raw.githubusercontent.com/Kyonew/DVinyl/main/unraid-template/dvinyl.xml
   ```
2. **Fill in the required settings:**
   - `PASSJWT` and `SESSION_SECRET`: two different random secrets, both required. Generate
     each with `openssl rand -hex 32`. The container will not start while one is empty or
     left at the placeholder the template used to ship.
   - **Data volume**: map it to a persistent path, for example `/mnt/user/appdata/dvinyl/data`.
     Your collection is the SQLite file inside it.
   - **Uploads volume**: map it to a persistent path, for example
     `/mnt/user/appdata/dvinyl/uploads`.
3. **Add API keys** (optional, in the advanced settings) for the media types you want, see
   [API keys](./api-keys.md).
4. Start the container and open `http://<server-ip>:3099`.

> [!NOTE]
> **Upgrading from 3.x?** Keep your MongoDB container running for the first start of 4.0 and set
> the `MONGODB_URL` setting to it, as before: DVinyl copies everything into SQLite once. Then
> clear the setting and remove the MongoDB container. The new **Data volume** must be set: without
> it, the container refuses to start and its log says `Please mount DVinyl's data folder`.

## 🛠️ Manual (Node.js)

Best if you want to run from source or customize the code.

### Prerequisites

- **Node.js** 22 or higher
- **npm**, and on platforms without prebuilt SQLite binaries, the usual build tools
  (Python 3, make and a C++ compiler)

### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Kyonew/DVinyl.git
   cd DVinyl
   ```
2. **Install dependencies and create your `.env`:**
   ```bash
   make setup
   # without make:
   npm install
   cp .env.example .env
   ```
3. **Edit your `.env`** (see [environment variables](#-environment-variables) and
   [API keys](./api-keys.md)).
4. **Start the app:**
   ```bash
   make dev
   # without make:
   npm start
   ```

DVinyl is then available at `http://localhost:3099`.

> [!TIP]
> Run `make help` to see every available command. To keep DVinyl running in the background you can
> use pm2: `pm2 start app.ts --interpreter tsx --name dvinyl`.

## 🔐 Environment variables

These are the core variables. See [API keys](./api-keys.md) for the metadata service keys, and
`.env.example` for the full list.

| Variable | Description |
| :------- | :---------- |
| `SQLITE_PATH` | Where the SQLite file lives (default `data/dvinyl.sqlite`) |
| `MONGODB_URL` | Only to upgrade from 3.x: the MongoDB to import from on the first start |
| `VINYL_PORT` | Port DVinyl listens on (default `3099`) |
| `PASSJWT` | Secret used to sign session tokens |
| `SESSION_SECRET` | Secret used to encrypt sessions |
| `PROD` | Set to `true` **only** when serving over HTTPS |
| `BASE_URL` | Sub-path prefix, leave empty to serve from the root |

> [!IMPORTANT]
> Use `PROD=true` **only with HTTPS**. For localhost or a local IP, leave `PROD=false`.

> [!WARNING]
> `PASSJWT` and `SESSION_SECRET` must be two different random values, and DVinyl **refuses to
> start** while either one is missing or still set to a placeholder published in `.env.example`
> or in the Unraid template. Those values are public, so anyone could forge a session token
> with them. Generate each secret with `openssl rand -hex 32`.
>
> Changing them logs everyone out once, which is expected: existing tokens were signed with
> the old value.

Single sign-on (OIDC) is optional and configured through extra environment variables. See the
commented block in `.env.example` for the details.

## 🌐 Behind a reverse proxy (HTTPS)

To expose DVinyl on the internet, put a reverse proxy (nginx, Caddy, Traefik, Nginx Proxy Manager...)
in front of it and let the proxy handle HTTPS. DVinyl itself keeps listening on plain HTTP on
`VINYL_PORT`; the proxy terminates TLS and forwards requests to it.

Two things to set:

- **`PROD=true`.** This tells DVinyl it is served over HTTPS: it marks its session cookies as
  `secure` and trusts the first proxy in front of it (so it reads the forwarded protocol correctly).
  Leaving it `false` behind HTTPS breaks logins; setting it `true` without HTTPS also breaks them.
- **`BASE_URL`.** Leave it empty to serve DVinyl at the root of a domain (`https://dvinyl.example.com`).
  Set it to a sub-path (for example `/dvinyl`) if you serve it under one
  (`https://example.com/dvinyl`), and make the proxy pass that path through unchanged.

Make sure the proxy forwards the standard `X-Forwarded-*` headers (most do by default) and allows
**WebSocket upgrades**, which DVinyl uses for live updates. A minimal nginx location looks like:

```nginx
location / {
    proxy_pass http://127.0.0.1:3099;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # WebSocket (live updates)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

> [!TIP]
> Serving over HTTPS also enables the **camera barcode scanner** on phones: browsers block camera
> access on plain `http://` addresses, so the scanner only works on `localhost` or over HTTPS.

## ✅ First run

Open DVinyl in your browser and follow the setup screen to create your admin account. From the admin
panel you can then enable the media types you want to collect, create collections and invite other
users.

> [!TIP]
> Installed and running? The [Wiki](https://github.com/Kyonew/DVinyl/wiki) is the user handbook: how
> to add and import items, customize your dashboard, share collections, back up your data and build
> your own no-code media type.

---

[← Back to the README](../README.md) · [Docker deployment →](./docker.md) ·
[API keys →](./api-keys.md)
