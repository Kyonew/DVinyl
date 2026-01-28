# 🐳 Docker Deployment

The easiest way to run DVinyl is using **Docker**. This ensures a consistent environment, with both the Node.js app and the MongoDB database running together.

## ⚡ Quick Deploy

### 1. Prepare Environment
Ensure you have a `.env` file in the root directory. You can use the provided `.env.example` as a starting point.

[Get your API keys here.](./api-keys.md)

### 2. Docker Compose
Run the following command to pull images and start the containers in the background:

```bash
docker compose up --build -d
```

## What's Inside?

The `docker-compose.yml` file defines two services:

1. **app:** The Node.js DVinyl application (mapped to port 3099).

2. **db:** A MongoDB instance to store your collection and user data.

## 💾 Persistence

By default, the database data is stored in a Docker volume named mongo-data. This ensures your collection is not lost when you stop or update the containers.

## 🔄 Updating

To update to the latest version of DVinyl:

```bash
git pull
docker compose up --build -d
```

[← Back to README](../README.md)  
[Get your API keys →](./api-keys.md)
