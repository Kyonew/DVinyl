# 🐳 Docker Deployment

The recommended way to run DVinyl is using Docker. You have two options depending on your needs.

DVinyl keeps your whole collection in a single SQLite file, in its `data` folder. There is no
database server to run next to it.

## Option 1: Using Pre-built Image (Recommended)

Best for: Most users who just want to run the app. No need to clone the full repository or install Node.js.

### 1. Setup

Create a new folder and a `docker-compose.yml` file with this content:

```yaml
services:
  dvinyl-app:
    image: ghcr.io/kyonew/dvinyl:latest
    container_name: dvinyl_app
    restart: unless-stopped
    ports:
      - "3099:3099"
    volumes:
      - ./data:/app/data
      - ./public/uploads:/app/public/uploads
    env_file:
      - .env
```

If you prefer to keep everything in the compose file, without a `.env` (thank you @mistic100):

```yaml
services:
  dvinyl-app:
    image: ghcr.io/kyonew/dvinyl:latest
    pull_policy: missing
    container_name: dvinyl_app
    restart: unless-stopped
    environment:
      - VINYL_PORT=80
      - BASE_URL=
      - PROD=false
      - PASSJWT=<openssl rand -hex 32>
      - SESSION_SECRET=<a different openssl rand -hex 32>
      - DISCOGS_TOKEN=<something>
    ports:
      - '<external_port>:80'
    volumes:
      - /mnt/<data_dataset>:/app/data
      - /mnt/<uploads_dataset>:/app/public/uploads
```

### 2. Prepare Environment

If you don't use `environment` in your conf file, ensure you have a `.env` file in the root directory.  
For both case, you can use the provided `.env.example` as a starting point.

[Get your API keys here.](./api-keys.md)

### 3. Launch

```bash
docker compose up -d
```

Then open `http://localhost:3099` and follow the setup screen to create your admin account.

> [!TIP]
> If you have `make` installed, `make docker-up` runs this for you. Run `make help` to see every
> available command.

> [!TIP]
> Up and running? The [Wiki](https://github.com/Kyonew/DVinyl/wiki) walks you through actually using
> DVinyl: adding and importing items, customizing the dashboard, sharing collections and backing up
> your data.

## Option 2: Build from Source

Best for: Developers or those who want to customize the code.

1. **Clone the repo**: `git clone https://github.com/Kyonew/DVinyl.git`
2. **Make your `.env` file** using `.env.example` and [api keys page](./api-keys.md).
3. **Build and start**:

```bash
docker compose up --build -d
```

## 🚚 Upgrading from 3.x to 4.0

Versions before 4.0 kept their data in a MongoDB container. 4.0 moves it into SQLite on its first
start, by itself: it reads everything from the old database once, ids included, so your links,
lists and share links keep working. **The old database is only read, never changed.**

1. **Back up.** In 3.x, open the **Instance** admin page (`/admin/instance`) and use
   **Backup → Export**. Keep that file.
2. **Keep the old database for the first start.** Add `MONGODB_URL` to your `.env`, pointing at
   your MongoDB container (`mongodb://mongodb:27017/dvinyl` with the files of this repository),
   and add a `./data:/app/data` volume to the app. The `docker-compose.yml` of this repository
   already carries the old `mongodb` service, behind a profile:

   ```bash
   docker compose --profile upgrade up -d
   ```

   With a compose file of your own, leave your `mongodb` service in it for now.

   > [!WARNING]
   > **Do not skip the `./data:/app/data` volume.** Without it, DVinyl 4.0 refuses to start and
   > its log begins with `[DATA] Please mount DVinyl's data folder (/app/data) from the host`.
   > Nothing is lost when that happens: add the volume and start again. It stops on purpose,
   > because a folder that is not mounted lives inside the container and would be wiped by the
   > next update, along with everything you changed since the upgrade.
3. **Check the logs**: `docker compose logs dvinyl-app` shows `[IMPORT] Done.` with what was
   copied. If MongoDB cannot be reached, the app stops with a message saying so instead of starting
   empty: fix the URL and start again.
4. **Look around.** Your collection, your accounts and your settings should all be there.
5. **Retire MongoDB.** Remove `MONGODB_URL` from `.env`, then stop and remove the old container:

   ```bash
   docker compose rm -sf mongodb
   ```

   With the `docker-compose.yml` of this repository, a plain `docker compose up -d` will not start
   it again. With a compose file of your own, delete the `mongodb` service from it. Keep
   `./mongo_data` until you are sure, then delete it.

Prefer a clean start? Run 4.0 without `MONGODB_URL`, create your admin account, and restore the
backup from step 1 from the **Instance** admin page. Both ways give the same result.

> [!NOTE]
> The import only runs while the SQLite store is empty. Once it has data, `MONGODB_URL` is ignored.

## 🔄 Updating

> [!IMPORTANT]
> **Back up first.** Before any update, export a whole-instance backup from the app, open the
> **Instance** admin page (`/admin/instance`) and use **Backup → Export** and, if you want a
> belt-and-braces copy, copy your `./data` folder while the container is stopped. Updates are
> designed to be safe and automatic, but a backup is your one-command way back if anything
> surprises you.

> [!WARNING]
> **Upgrading to 3.1.5 or later:** the app now refuses to start when `PASSJWT` or
> `SESSION_SECRET` is still set to one of the placeholder values that earlier examples and
> templates shipped (`SomeComplexPassword`, `AnotherComplexSecret`,
> `ChangeThisToAComplexPassword`, `ChangeThisToAComplexSecret`). They are published, so an
> instance running one is signing its sessions with a secret anyone can read. If the container
> restarts in a loop after the update, read its logs: the message names the variable to fix.
> Replace both with `openssl rand -hex 32` values. Everyone is logged out once afterwards,
> which is expected.

### Updating (Pre-built Image)

If you are using the GHCR image (Option 1):

```bash
docker compose pull
docker compose up -d
# with make:
make docker-update
```

### Updating (Manual Build)

If you cloned the repository (Option 2):

```bash
git pull
docker compose up --build -d
```

### Rolling back

If an update misbehaves, roll the app image back to the previous tag (pin a specific version
instead of `latest`, e.g. `image: ghcr.io/kyonew/dvinyl:4.0.0`) and restore the instance backup
you exported above. Going back to 3.x after the move to SQLite means going back to your MongoDB
container and its `./mongo_data`, which 4.0 left as they were: you find your collection as it was
on the day of the upgrade, without what you changed in 4.0 since.

## 💾 Persistence

Everything DVinyl stores lives in `./data/dvinyl.sqlite` (with its `-wal` and `-shm` companions
while the app runs). Keep that folder mounted and backed up. To copy the file by hand, stop the
container first; while it runs, an instance export from the app is the safe way.

Images uploaded from an item form are stored under `public/uploads/items` (the Compose files mount
`./public/uploads` persistently). Whole-instance and per-collection ZIP backups include every
referenced local item image. The historical JSON import format remains supported, but JSON alone
cannot transport those files to another installation. When a ZIP export encounters an older JPEG
stored inline as a data URL, it moves that image into the archive's `images/` directory;
restoring the ZIP therefore migrates it to the file-based storage automatically.

## 🧩 No-code plugins and Docker

Collection types you build with the in-app **plugin editor** (`/create-plugin`) are stored **in the
database**. Their `plugins/<id>/` folder on disk is only a regenerable cache: DVinyl re-creates it
from the database at startup.

In practice, that means:

- **Nothing extra to mount.** As long as `./data` is persisted (it is in every example here), your
  no-code plugins survive `docker compose pull`, `up --build` and `down`. DVinyl rebuilds their
  folders on startup.
- **They travel with an instance backup.** An instance export includes your no-code plugin
  definitions along with everything else, and restoring brings them back.

## 🗑️ Full reset & Data loss

If you have made significant changes and need to rebuild the application from a clean slate, follow the steps below.

> [!IMPORTANT]
> This procedure will permanently delete all local data. If you have data you wish to keep, export your database before proceeding.

```bash
# Stop the container
sudo docker compose down

# Delete the database file
sudo rm -rf ./data

# Rebuild and restart
sudo docker compose up -d
```

[← Back to README](../README.md) · [Installation guide](./getting-started.md) ·
[Get your API keys →](./api-keys.md)
