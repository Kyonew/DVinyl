# 🚀 Installation

There are several ways to run DVinyl. Pick the one that fits your setup, they all end up at the same
app. Your whole collection lives in one SQLite file in DVinyl's `data` folder: there is no
database server to install.

> [!NOTE]
> Upgrading from 3.x, which used MongoDB? Nothing to change: 4.0 keeps running on it until you
> move to SQLite, whenever you like. See [Moving to SQLite](./docker.md#-moving-to-sqlite).

| Method | Best for | Guide |
| :----- | :------- | :---- |
| 🐳 Docker | Most people, quickest path | [Docker deployment](./docker.md) (recommended) |
| 🧊 ZimaOS | ZimaOS / CasaOS users (1-click app store) | [Section below](#-zimaos) |
| 🧡 Unraid | Unraid server users | [Section below](#-unraid) |
| 🐧 Proxmox LXC | A small Linux container instead of Docker | [Section below](#-proxmox-lxc) |
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
> **Upgrading from 3.x?** Your container keeps running on MongoDB as before. To move to SQLite,
> add the **Data volume** and leave the **MongoDB URL** setting as it is: the next start copies
> everything over. See [Moving to SQLite](./docker.md#on-unraid).

## 🛠️ Manual (Node.js)

Best if you want to run from source or customize the code.

### Prerequisites

- **Node.js** 22 or higher, with **npm**
- **Build tools** for the SQLite module, which `npm install` compiles: Python 3, make and a C++
  compiler. On Debian or Ubuntu: `sudo apt install build-essential python3`. On macOS:
  `xcode-select --install`.
- **git**, to get the code

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

## 🐧 Proxmox LXC

From 4.0, DVinyl is one Node.js app and one data folder, so it runs well in a small LXC without
Docker. There is no official LXC image: these steps install it from source in a Debian 12 (or
newer) container, as a service that starts with the container. Run them as root inside it.

1. **Create the container** in Proxmox from a Debian 12 template. 1 CPU, 1 GB of RAM and 8 GB of
   disk are plenty for a personal collection.
2. **Install Node.js, the build tools and git:**
   ```bash
   apt update && apt install -y curl ca-certificates git build-essential python3
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt install -y nodejs
   ```
3. **Get DVinyl and its dependencies:**
   ```bash
   git clone https://github.com/Kyonew/DVinyl.git /opt/DVinyl
   cd /opt/DVinyl
   npm install
   cp .env.example .env
   ```
4. **Fill in `.env`**: at least `PASSJWT` and `SESSION_SECRET`, two different values from
   `openssl rand -hex 32`. See [environment variables](#-environment-variables) and
   [API keys](./api-keys.md) for the rest.
5. **Give it a user of its own** rather than running it as root:
   ```bash
   useradd --system --home /opt/DVinyl --shell /usr/sbin/nologin dvinyl
   chown -R dvinyl:dvinyl /opt/DVinyl
   ```
6. **Make it a service.** Create `/etc/systemd/system/dvinyl.service`:
   ```ini
   [Unit]
   Description=DVinyl
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=dvinyl
   WorkingDirectory=/opt/DVinyl
   ExecStart=/usr/bin/node --env-file=.env --import tsx app.ts
   Restart=on-failure
   TimeoutStopSec=20

   [Install]
   WantedBy=multi-user.target
   ```
   Then start it, now and at every boot:
   ```bash
   systemctl daemon-reload
   systemctl enable --now dvinyl
   journalctl -u dvinyl -f    # the log; Ctrl+C to leave it
   ```
7. Open `http://<container-ip>:3099` and create your admin account.

Your whole collection is in `/opt/DVinyl/data` and your images in `/opt/DVinyl/public/uploads`:
those two folders are what to back up, along with the automatic backups you can turn on from the
**Instance** admin page. Proxmox snapshots and backups of the container cover them too.

**Updating:**
```bash
cd /opt/DVinyl
systemctl stop dvinyl
git pull
npm install
chown -R dvinyl:dvinyl /opt/DVinyl
systemctl start dvinyl
```

> [!NOTE]
> Stop the service before starting DVinyl by hand in the same folder: only one DVinyl at a time can
> use a data folder, and a second one stops with `[DATA] Another DVinyl is already running`.

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
