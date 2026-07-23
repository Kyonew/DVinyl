# 🐳 Docker Deployment

The recommended way to run DVinyl is using Docker. You have two options depending on your needs.

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
      - ./public/uploads:/app/public/uploads
    env_file:
      - .env
    depends_on:
      - mongodb

  mongodb:
    image: mongo:latest
    container_name: dvinyl_db
    restart: unless-stopped
    volumes:
      - ./mongo_data:/data/db

volumes:
  mongo_data:
```

If you are struggling with the deploy, you can try this config (thank you @mistic100) :

```yaml
services:
  dvinyl-app:
    image: ghcr.io/kyonew/dvinyl:latest
    pull_policy: missing
    container_name: dvinyl_app
    restart: unless-stopped
    depends_on:
      - mongodb
    environment:
      - MONGODB_URL=mongodb://mongodb:27017/dvinyl
      - VINYL_PORT=80
      - BASE_URL=
      - PROD=false
      - PASSJWT=<something>
      - SESSION_SECRET=<something>
      - DISCOGS_TOKEN=<something>
    ports:
      - '<external_port>:80'
    volumes:
      - /mnt/<uploads_dataset>:/app/public/uploads

  mongodb:
    image: mongo:latest
    pull_policy: missing
    container_name: dvinyl_db
    restart: unless-stopped
    volumes:
      - /mnt/<mongo_dataset>:/data/db
```

>
> **Older / low-power hardware (Raspberry Pi, older NAS/CPUs).** MongoDB 5.0+ requires a CPU
> with AVX support. If `mongodb` keeps restarting on such hardware, pin an older major instead:
> ```yaml
> mongodb:
>   image: mongo:4.4.18
> ```
> This only works on a **fresh** database. You cannot point an older MongoDB at data files that
> a newer version already wrote (that's a downgrade, and it's refused). Thank you @oliverjunker
> for the tip!

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

## 🔄 Updating

> [!IMPORTANT]
> **Back up first.** Before any update, export a whole-instance backup from the app, open the
> **Instance** admin page (`/admin/instance`) and use **Backup → Export** and, if you want a
> belt-and-braces copy, snapshot your `./mongo_data` folder while the containers are stopped. Updates are designed to be safe and
> automatic, but a backup is your one-command way back if anything surprises you.

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
instead of `latest`, e.g. `image: ghcr.io/kyonew/dvinyl:2.6.0`) and restore the instance backup
you exported above. Because the app image and your data are separate, downgrading the **app** is
safe; just don't downgrade the **MongoDB** major below the version that last wrote your data.


## 💾 Persistence

By default, the database data is stored in a Docker volume named mongo-data. This ensures your collection is not lost when you stop or update the containers.

## 🧩 No-code plugins and Docker

Collection types you build with the in-app **plugin editor** (`/create-plugin`) are stored **in the
database**. Their `plugins/<id>/` folder on disk is only a regenerable cache: DVinyl re-creates it
from the database at startup.

In practice, that means:

- **Nothing extra to mount.** As long as your **database** volume is persisted (`./mongo_data`, which
  it is in every example here), your no-code plugins survive `docker compose pull`, `up --build` and
  `down`. DVinyl rebuilds their folders on startup.
- **They travel with an instance backup.** An instance export includes your no-code plugin
  definitions along with everything else, and restoring brings them back.

## 🗑️ Full reset & Data loss

If you have made significant changes and need to rebuild the application from a clean slate, follow the steps below.

> [!IMPORTANT]
> This procedure will permanently delete all local data. If you have data you wish to keep, export your database before proceeding.

```bash
# Stop containers and remove volumes (-v)
sudo docker compose down -v

# Delete local database files
sudo rm -rf ./mongo_data

# Rebuild and restart the services
sudo docker compose up -d
```

[← Back to README](../README.md) · [Installation guide](./getting-started.md) ·
[Get your API keys →](./api-keys.md)
