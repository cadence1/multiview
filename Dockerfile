# node:sqlite (used by the server) requires Node 22.5+ — it doesn't exist at
# all on Node 20 (ERR_UNKNOWN_BUILTIN_MODULE). Node 22 has it unflagged, just
# with a harmless "experimental feature" warning on stderr.

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps first (better layer caching)
COPY package.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
ENV DATA_DIR=/app/server/data

# curl is required as a fallback for Kick's channel API: Kick's Cloudflare
# WAF blocks Node's own fetch client by TLS fingerprint regardless of
# headers, but not curl. See server/src/platforms/kick.ts.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/server/package.json ./package.json
RUN npm install --omit=dev

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./dist/public

EXPOSE 8080
CMD ["node", "dist/index.js"]
