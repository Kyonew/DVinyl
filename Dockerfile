FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .


EXPOSE 3099

CMD ["npx", "tsx", "app.ts"]