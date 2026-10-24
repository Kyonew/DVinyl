# syntax=docker/dockerfile:1

# Dependencies, built apart: better-sqlite3 compiles a native module when no prebuilt
# binary matches the platform (Alpine's musl, ARM boards), which needs a toolchain the
# final image has no use for.
FROM node:24-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm install

FROM node:24-alpine

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

# DVinyl's ScreenScraper developer pair, from the CI secrets. Absent from forks and local
# builds, in which case nothing is written and the source stays off unless .env sets it.
RUN --mount=type=secret,id=screenscraper_dev_id \
    --mount=type=secret,id=screenscraper_dev_password \
    if [ -s /run/secrets/screenscraper_dev_id ] && [ -s /run/secrets/screenscraper_dev_password ]; then \
      node -e "const fs=require('fs');const r=f=>fs.readFileSync('/run/secrets/'+f,'utf8').trim();fs.writeFileSync('plugins/games/screenscraper.dev.json',JSON.stringify({id:r('screenscraper_dev_id'),password:r('screenscraper_dev_password')}))"; \
    fi


EXPOSE 3099

CMD ["npx", "tsx", "app.ts"]
