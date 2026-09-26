# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

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
