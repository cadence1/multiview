# Multiview

A self-hosted site to track creators across **YouTube**, **Twitch**, and **Kick**, 
see who's live or upcoming, and drop live streams into a multi-cell viewing grid.

- **Server** (`server/`) — Express + TypeScript, SQLite storage, background
  poller that keeps a live/upcoming/offline status cache fresh.
- **Client** (`client/`) — React + Vite + TypeScript SPA.

## Quick start (local, no Docker)

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
npm run dev
```

This starts the API on `http://localhost:8080` and the Vite dev server
(printed in the terminal, typically `http://localhost:5173`) — open the Vite
URL. The dev server proxies `/api` requests to the backend automatically.

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8080`. Tracked creators and status history are stored
in SQLite under `./data`, which is bind-mounted so they survive rebuilds.

## Configuring platform access

Nothing is *required* to get started — YouTube live/upcoming detection works
out of the box (it reads the same public page your browser would), and Kick
needs no credentials. But a couple of optional/required keys make things more
reliable:

| Env var | Platform | Required? | How to get it |
|---|---|---|---|
| `YOUTUBE_API_KEY` | YouTube | Optional | [Google Cloud Console](https://console.cloud.google.com/) → enable "YouTube Data API v3" → create an API key. Improves channel lookup when adding a creator; live-status polling never uses API quota. |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch | **Required for Twitch** | Free app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps). Any redirect URL works (e.g. `http://localhost`) — it's not used, only the client credentials flow is. |
| — | Kick | n/a | Uses Kick's public (unofficial) channel API. No signup, but Kick can change or rate-limit this without notice — treat Kick support as best-effort. |

Without Twitch credentials, Twitch creators can still be tracked but will
always show as offline.

## Using it

1. Click **+ Add** in the sidebar, pick a platform, and paste a handle or URL
   — a channel URL/handle/login works, and so does a **full video URL**
   (YouTube watch/`youtu.be`/Shorts/live-share links, a Twitch VOD or clip
   link, a Kick video link) — the creator who owns it gets tracked.
2. Tracked creators show up grouped by **Live → Upcoming → Offline**.
3. Click a **live** creator to add their stream to the multiview grid; click
   again (or the ✕ on the cell) to remove it.
4. The grid auto-lays-out based on how many streams are active (1×1, 2×1,
   2×2, 3×2, 3×3, …), same as Holodex's default behavior.
5. Click the 📌 on a creator row to **pin** them — they'll open in the grid
   automatically whenever they go live, and close automatically once they
   end. Pinning a creator who's already live opens it right away.
6. Click **Chat** (top right) to dock a chat panel — it lists whichever
   creators are currently in your grid as tabs, and shows the live chat for
   whichever one you pick. Twitch chat works regardless of live status;
   YouTube chat only exists once the video is live (and only if the
   broadcaster has chat enabled); Kick has no embeddable chat, so it links
   out to kick.com instead.
7. Click the **Multiview** title to open the same page in a new window.
8. Click **Media** (top right) to dock a volume panel — a **Main volume**
   slider scales every window at once, and each on-screen creator gets their
   own slider underneath (saved per-creator, so it's remembered next time
   they're added). YouTube and Twitch get real live volume control via their
   official player APIs; Kick has no such API, so it's mute/unmute only.

Which creators you *track* is stored server-side (SQLite), so it's shared
across any device that opens the app. Which ones are currently *in the grid*,
*pinned*, and each creator's saved *volume* are all stored per-browser
(`localStorage`), so each device/tab keeps its own layout and levels.

Use **Export**/**Import** in the sidebar to back up your tracked-creator list
to a JSON file, or move it to another Multiview instance. Importing skips
anything already tracked and re-checks live status immediately for whatever's
new — it doesn't re-resolve channels over the network, so it's fast even for
a large list. The file also carries each creator's pin and volume, and those
survive re-import correctly even though the server assigns a brand-new
internal ID on every import — they're matched back up by the channel's
actual platform ID, not that internal one.

## Notes & limitations

- **No authentication.** This is meant for personal/LAN use. If you expose it
  to the internet, put it behind a reverse proxy with auth (e.g. Caddy with
  basic auth, or a Tailscale/VPN-only setup).
- **YouTube live detection** works by reading the public `/channel/{id}/live`
  page rather than the paid-quota Data API search endpoint — this is the same
  approach most self-hosted Holodex-alikes use. It's reasonably reliable but
  can break if YouTube changes its page structure.
- **Kick** has no official public API; the unofficial endpoint used here can
  change without notice. Kick's Cloudflare protection also blocks Node's own
  `fetch` client by TLS fingerprint (confirmed: identical requests succeed via
  `curl` and fail via Node's fetch, regardless of headers) — the adapter
  automatically falls back to shelling out to `curl` when that happens, so
  **`curl` must be on `PATH`** (already installed in the Docker image; ships
  by default on Windows 10+/most Linux/macOS).
- **No chat panel, no drag-to-resize grid** in this version — the grid
  auto-arranges by count. Both would be reasonable follow-ups.

## Project layout

```
server/src/
  index.ts        Express app entry, serves the API and (in prod) the built client
  db.ts           SQLite schema + prepared statements
  cache.ts        In-memory status cache written by the poller, read by the API
  poller.ts       Background loop that refreshes live/upcoming status
  platforms/      One adapter per platform (resolveChannel + getStatuses)
  routes/         REST endpoints (/api/creators, /api/status)

client/src/
  store.ts        Zustand store: tracked creators, statuses, grid selection
  api.ts          Fetch wrapper for the backend REST API
  components/     Sidebar, AddCreatorDialog, MultiviewGrid, PlayerCell
```
