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
      # Optional: asked on the first-run setup page, see .env.example
      # - SETUP_TOKEN=<openssl rand -hex 16>
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

## 🚚 Moving to SQLite

From 4.0, DVinyl keeps its whole collection in one SQLite file, in its `data` folder. Versions
before 4.0 kept it in a MongoDB container. This section is for installs coming from 3.x.

**You do not have to do anything right away.** Update DVinyl as usual: as long as no `data` folder
is mounted, it keeps running on your MongoDB exactly as before, and the **Instance** admin page
shows a notice pointing here. Move when it suits you. It takes a few minutes, and these are the
same steps whether you move on the day you update or months later.

What you get: a collection that is one file to back up, no database container to keep running,
and the store every new feature is built and tested on first.

### What protects your data

- **MongoDB is only read.** The move copies everything, ids included, so your links, lists and
  share links keep working. The only thing it writes to MongoDB is a small marker saying the data
  has moved.
- **All or nothing.** The copy lands whole or not at all. If MongoDB cannot be reached, DVinyl
  stops with a message instead of starting empty.
- **No mix-ups later.** Once moved, if the `data` folder ever goes missing from your
  configuration, DVinyl stops and asks for it instead of quietly running on the old MongoDB data.
  It also refuses to copy the same MongoDB a second time into a new, empty `data` folder. This
  relies on the marker, so it needs a MongoDB account that can write (the usual setup); the log
  says so at the end of the move when it could not be written.

### Before you start

Open the **Instance** admin page (`/admin/instance`) and use **Backup → Export**. Keep that file:
it is your way back whatever happens.

### With Docker Compose

1. In your compose file, add the `data` folder to the volumes of the DVinyl service, and change
   nothing else. Keep `MONGODB_URL` in your `.env` and keep the `mongodb` service.

   ```yaml
   services:
     dvinyl-app:
       volumes:
         - ./data:/app/data            # add this line
         - ./public/uploads:/app/public/uploads
   ```

2. Start again:

   ```bash
   docker compose up -d
   ```

3. Check the logs with `docker compose logs dvinyl-app`. They show `[IMPORT] Done.` and how many
   records were copied.
4. Open DVinyl and look around: your collection, your accounts and your settings are all there,
   and the notice on the **Instance** admin page is gone.
5. Retire MongoDB, when you are ready:
   - remove `MONGODB_URL` from `.env`;
   - remove the `mongodb` service from the compose file, and the `depends_on: - mongodb` lines
     of the DVinyl service if it has them;
   - apply it:

     ```bash
     docker compose up -d --remove-orphans
     ```

   Keep the `./mongo_data` folder for a while, then delete it once you are sure.

> [!TIP]
> The `docker-compose.yml` of this repository already mounts `./data` and keeps the old `mongodb`
> service behind an `upgrade` profile. With it, start the move with
> `docker compose --profile upgrade up -d`, and retire MongoDB with `docker compose rm -sf mongodb`.

### On Unraid

1. Edit the DVinyl container and add a **Path**: container path `/app/data`, host path
   `/mnt/user/appdata/dvinyl/data`. Leave the **MongoDB URL** setting as it is. Apply.
2. Open the container's log: it shows `[IMPORT] Done.`
3. Open DVinyl and look around.
4. Retire MongoDB, when you are ready: clear the **MongoDB URL** setting of DVinyl and apply, then
   stop and remove the MongoDB container from the Docker tab. Keep its appdata folder for a while.

### With `docker run`

Add `-v /a/folder/on/the/host:/app/data` to your command, keep `-e MONGODB_URL=...`, and start the
container again. Check the log for `[IMPORT] Done.`, then drop `MONGODB_URL` and stop your MongoDB
container when you are ready.

### Without Docker

Run from source, DVinyl writes its file to `./data` next to the app. Keep `MONGODB_URL` in `.env`
for the first start of 4.0: it moves the data on its own. Then remove the line and stop your
MongoDB service when you are ready.

### If something looks wrong

- **The log says `[IMPORT] ... could not be imported`.** MongoDB could not be reached: check
  that its container runs and that `MONGODB_URL` points at it, then start again. Nothing was
  written.
- **The log says `[DATA] Your collection moved from MongoDB to SQLite`.** The `data` folder of the
  move is no longer mounted. Mount it again (the folder holding `dvinyl.sqlite`).
- **The log says `[IMPORT] ... was already moved to SQLite`.** You started on an empty `data`
  folder while your collection is in the one from the move. Point DVinyl at that folder. To copy
  the old MongoDB data again anyway, losing what changed since, start once with
  `MONGODB_REIMPORT=true`.
- **You would rather start clean.** Run 4.0 without `MONGODB_URL`, create your admin account and
  restore the backup from [Before you start](#before-you-start) on the **Instance** admin page.
- **You want to stay on MongoDB on purpose.** Set `DB_DRIVER=mongodb`. It keeps working
  throughout 4.x, without the notice.

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
container and its `./mongo_data`, whose data 4.0 left as it was (it only added the small "moved"
marker, which 3.x ignores): you find your collection as it was on the day of the move, without what
you changed in 4.0 since. If you then keep working on 3.x and come back to 4.0 later, your 4.0
`data` folder does not have those changes: either restore a backup exported from 3.x, or start 4.0
once on an empty `data` folder with `MONGODB_REIMPORT=true` to copy MongoDB again.

## 💾 Persistence

Everything DVinyl stores lives in `./data/dvinyl.sqlite` (with its `-wal` companion while the
app runs). Keep that folder mounted and backed up. To copy the file by hand, stop the container
first; while it runs, an instance export from the app is the safe way.

DVinyl keeps the file to itself while it runs: a second DVinyl started on the same data folder
(an older container left running, or a local `npm start` next to the container) refuses to
start, with a log beginning `[DATA] Another DVinyl is already running`, since the two would undo
each other's changes. Other tools cannot open the file meanwhile either.

Images uploaded from an item form are stored under `public/uploads/items` (the Compose files mount
`./public/uploads` persistently). Whole-instance and per-collection ZIP backups include every
referenced local item image. The historical JSON import format remains supported, but JSON alone
cannot transport those files to another installation. When a ZIP export encounters an older JPEG
stored inline as a data URL, it moves that image into the archive's `images/` directory;
restoring the ZIP therefore migrates it to the file-based storage automatically.

## 🗄️ Automatic backups

The **Backup** tab of the **Instance** admin page (`/admin/instance`) can write a whole-instance
backup on a schedule, every day or every week, as a ZIP with the images or a JSON without them.
It is off until you turn it on. Only the number of backups you choose is kept, the oldest going
after each one that works, and the instance admins get a notification if one fails. A backup
restores like any other instance backup, with **Import Database**.

They go to a `backups` folder next to the database, so `./data/backups` with the
`docker-compose.yml` of this repository. That is the same disk as your collection: to survive
losing it, mount another folder into the container, then enter its path (`/backups` here) in the
**Folder** field of that tab:

```yaml
    volumes:
      - /mnt/nas/dvinyl-backups:/backups
```

The page warns you when the folder is not mounted, since its backups would then be lost with
the container. To set the folder from the server instead, use `BACKUP_DIR`: it takes priority and
locks the field.

> [!WARNING]
> These files hold every account with its password hash. Keep the folder private.

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
