FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS test
COPY . .
RUN npm test
CMD ["npm", "test"]

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./
COPY migrations ./migrations
COPY erp-sim ./erp-sim
COPY corpus ./corpus
COPY fixtures ./fixtures
COPY cases ./cases
COPY eval/green.json ./eval/
RUN mkdir data && touch eval/report.md && chown node:node data eval/report.md
USER node
VOLUME ["/app/data"]
ENTRYPOINT ["node", "src/entrypoints/cli.js"]
