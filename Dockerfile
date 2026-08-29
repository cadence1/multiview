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

# ffmpeg + yt-dlp back the optional recording feature (server/src/recordings) —
# harmless if unused. yt-dlp specifically via pip rather than Alpine's apk
# package (which doesn't carry it): pip tracks upstream releases directly,
# which matters here since yt-dlp ships frequent updates to keep up with
# platforms changing their pages — apk's package, if it existed, would lag.
# --break-system-packages is fine in a single-purpose container image; this
# isn't a shared Python environment.
#
# yt-dlp-ejs alongside it: yt-dlp needs this to solve YouTube's own
# signature/"n"-parameter challenges — without it, confirmed directly
# (2026-08-23) that extraction runs degraded with real formats silently
# missing. The pip-installed yt-dlp doesn't bundle it (only the official
# standalone executable does); yt-dlp otherwise offers to fetch the same
# thing from GitHub at runtime via --remote-components, but installing the
# real package at build time is more deterministic for a container image —
# no runtime dependency on GitHub being reachable, no cold-start fetch
# delay, reproducible builds. See server/yt-dlp.conf for the other half of
# this fix (pointing yt-dlp at Node as its JS runtime).
# cifs-utils provides the mount.cifs helper the `mount -t cifs` command
# shells out to — backs the optional SMB storage backend
# (server/src/recordings/smb.ts), a real kernel CIFS mount rather than an
# in-process network client (see that module's own doc comment for why).
# Needs docker-compose.yml's cap_add: SYS_ADMIN on this service to actually
# be usable — the mount()/umount() syscalls are otherwise blocked
# regardless of this package being present.
RUN apk add --no-cache ffmpeg python3 py3-pip cifs-utils && \
    pip install --no-cache-dir --break-system-packages yt-dlp yt-dlp-ejs

COPY server/yt-dlp.conf /etc/yt-dlp.conf

COPY --from=build /app/server/package.json ./package.json
RUN npm install --omit=dev

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./dist/public

EXPOSE 8080
CMD ["node", "dist/index.js"]
