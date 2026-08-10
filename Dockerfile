# node:sqlite (used by the server) requires Node 22.5+ — it doesn't exist at
# all on Node 20 (ERR_UNKNOWN_BUILTIN_MODULE). Node 22 has it unflagged, just
# with a harmless "experimental feature" warning on stderr. It's a Node
# built-in (no native addon), so unlike better-sqlite3 it needs no compiler
# toolchain and runs fine on musl — Alpine is safe to use here.

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first (better layer caching). npm ci (not install) since we
# have the lockfile — deterministic, and slightly faster/leaner.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
ENV DATA_DIR=/app/server/data

COPY --from=build /app/server/package.json ./package.json
RUN npm install --omit=dev

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./dist/public

EXPOSE 8080
CMD ["node", "dist/index.js"]
