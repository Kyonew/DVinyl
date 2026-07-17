# 🚀 Installation

There are three ways to run DVinyl. Pick the one that fits your setup, they all end up at the same
app. Whatever you choose, DVinyl always needs a **MongoDB** database to store your collection.

| Method | Best for | Guide |
| :----- | :------- | :---- |
| 🐳 Docker | Most people, quickest path | [Docker deployment](./docker.md) (recommended) |
| 🧡 Unraid | Unraid server users | [Section below](#-unraid) |
| 🛠️ Manual (Node.js) | Developers and custom setups | [Section below](#-manual-nodejs) |

Before you start, grab the [API keys](./api-keys.md) for the media types you want to use. You can
always add them later.

## 🐳 Docker (recommended)

The fastest and cleanest way to run DVinyl. It brings its own MongoDB, so there is nothing else to
install.

1. Create a `docker-compose.yml` and a `.env` file.
2. Run `docker compose up -d`.
3. Open `http://localhost:3099`.

The [Docker deployment guide](./docker.md) has the full compose file, update instructions and
troubleshooting tips.

## 🧡 Unraid

DVinyl ships with an Unraid Community App template.

1. **Install MongoDB first.** DVinyl needs a database. Add a MongoDB container from Community
   Applications (or use an existing one) and note its IP and port.
2. **Add DVinyl.** If it is not in Community Applications yet, add it from its template URL:
   ```
   https://raw.githubusercontent.com/Kyonew/DVinyl/main/unraid-template/dvinyl.xml
   ```
3. **Fill in the required settings:**
   - `MONGODB_URL`: point it to your MongoDB container, for example
     `mongodb://<mongodb-ip>:27017/dvinyl`.
   - `PASSJWT` and `SESSION_SECRET`: set two different, complex secrets.
   - **Uploads volume**: map it to a persistent path, for example
     `/mnt/user/appdata/dvinyl/uploads`.
4. **Add API keys** (optional, in the advanced settings) for the media types you want, see
   [API keys](./api-keys.md).
5. Start the container and open `http://<server-ip>:3099`.

## 🛠️ Manual (Node.js)

Best if you want to run from source or customize the code.

### Prerequisites

- **Node.js** 18 or higher
- **npm**
- A running **MongoDB** 6 or higher

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
| `MONGODB_URL` | MongoDB connection string |
| `VINYL_PORT` | Port DVinyl listens on (default `3099`) |
| `PASSJWT` | Secret used to sign session tokens |
| `SESSION_SECRET` | Secret used to encrypt sessions |
| `PROD` | Set to `true` **only** when serving over HTTPS |
| `BASE_URL` | Sub-path prefix, leave empty to serve from the root |

> [!IMPORTANT]
> Use `PROD=true` **only with HTTPS**. For localhost or a local IP, leave `PROD=false`.
> Set `PASSJWT` and `SESSION_SECRET` to two different, complex values. They are what keep your
> sessions secure.

Single sign-on (OIDC) is optional and configured through extra environment variables. See the
commented block in `.env.example` for the details.

## ✅ First run

Open DVinyl in your browser and follow the setup screen to create your admin account. From the admin
panel you can then enable the media types you want to collect, create collections and invite other
users.

---

[← Back to the README](../README.md) · [Docker deployment →](./docker.md) ·
[API keys →](./api-keys.md)
