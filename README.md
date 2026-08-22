# Multiview

A self-hosted site to track creators across **YouTube**, **Twitch**, and
**Kick**, see who's live or upcoming, and drop live streams into a multi-cell
viewing grid.

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
out of the box (it reads the same public page your browser would). But a
couple of optional/required keys make things more reliable:

| Env var | Platform | Required? | How to get it |
|---|---|---|---|
| `YOUTUBE_API_KEY` | YouTube | Optional | [Google Cloud Console](https://console.cloud.google.com/) → enable "YouTube Data API v3" → create an API key. Improves channel lookup when adding a creator; live-status polling never uses API quota. |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch | **Required for Twitch** | Free app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps). Any redirect URL works (e.g. `http://localhost`) — it's not used, only the client credentials flow is. |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | Kick | **Required for Kick** | Free app at [kick.com/settings/developer](https://kick.com/settings/developer), with the `channel:read` and `user:read` scopes. Any redirect URL works, same as Twitch — only the client credentials flow is used. |

Without Twitch/Kick credentials, creators on that platform can still be
tracked but will always show as offline.

## YouTube push notifications (optional)

YouTube has no batched live-status API (see "Notes & limitations" below), so
by default catching a YouTube creator going live means waiting for the next
poll — including an unscheduled/"guerrilla" stream nobody announced, which
has no earlier "upcoming" state to fast-poll off of. YouTube's own
[PubSubHubbub push notifications](https://developers.google.com/youtube/v3/guides/push_notifications)
close that gap: subscribe to a channel and Google's hub pushes a near-instant
notification whenever it changes, which triggers an immediate real check of
just that one channel — no polling wait either way. It's additive, not a
replacement: the regular poller (and the imminent-stream fast lane) keep
running exactly as before, as a safety net for any notification that's
missed, delayed, or never fires.

This needs a **publicly reachable HTTPS endpoint** for Google's hub to
deliver notifications to — not required for anything else in this app, which
is otherwise fine to leave LAN-only. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
is a good fit: it's free, needs no inbound port-forward, and can expose just
this one path rather than the whole app. To set it up:

1. **Generate a secret** — `openssl rand -hex 32` (or anything long and
   random). This authenticates incoming notifications; treat it like a
   password, never commit it.
2. **Set both env vars** in `.env`:
   ```
   YOUTUBE_PUSH_CALLBACK_URL=https://push.yourdomain.com/api/youtube-push
   YOUTUBE_PUSH_SECRET=<the secret from step 1>
   ```
   (using whatever hostname you route the tunnel to below).
3. **Route only that one path** through the tunnel — in `cloudflared`'s
   ingress config (or the equivalent Zero Trust dashboard rule), scope it
   tightly rather than exposing the whole app:
   ```yaml
   ingress:
     - hostname: push.yourdomain.com
       path: /api/youtube-push
       service: http://localhost:8080
     - service: http_status:404
   ```
4. **(Recommended) Add a Cloudflare WAF/IP Access rule** restricting that
   hostname to Google's IP ranges, published and kept current at
   [gstatic.com/ipranges/goog.json](https://www.gstatic.com/ipranges/goog.json).
   Note this is coarse — it's all of Google's IP space, not narrowly scoped
   to just this one hub — so treat it as defense-in-depth on top of, not
   instead of, the signature check below, which is the actual guarantee
   that a notification is genuine.
5. **Restart the server.** On startup (and once daily thereafter, to renew
   the subscription before it lapses) it subscribes every tracked YouTube
   creator; newly-added ones are subscribed immediately too.

Every incoming notification is verified against `YOUTUBE_PUSH_SECRET` via
the `X-Hub-Signature` HMAC header Google's hub signs it with — anything that
doesn't match is silently dropped, regardless of where it came from. That
signature check, not IP filtering, is the real security boundary here.

Leave both env vars unset to skip all of this — push notifications are
entirely optional, and everything works via polling alone without them,
same as before this feature existed.

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
   official player APIs, capped at 100% (that's the platforms' own limit,
   not something we can push past from a regular web page); Kick has no
   such API, so it's mute/unmute only.

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
- **Kick** uses Kick's official public API (`api.kick.com`), same
  client-credentials OAuth pattern as Twitch — see the table above.
- **YouTube push notifications** (if configured) rely on a hub event Google's
  own docs don't officially name as a distinct trigger — they document
  "uploads/retitles/re-describes a video," not "starts a livestream"
  explicitly, though a livestream going live does fire one in practice (the
  same mechanism most "new video" notification bots rely on). Treated
  accordingly: a notification just triggers an immediate real check via the
  normal adapter, never trusted as "definitely live" on its own.
- **No drag-to-resize grid** in this version — the grid auto-arranges by
  count. Would be a reasonable follow-up.

## Project layout

```
server/src/
  index.ts        Express app entry, serves the API and (in prod) the built client
  db.ts           SQLite schema + prepared statements
  cache.ts        In-memory status cache written by the poller, read by the API
  poller.ts       Background loop that refreshes live/upcoming status
  youtubePush.ts  Optional YouTube PubSubHubbub push notifications
  platforms/      One adapter per platform (resolveChannel + getStatuses)
  routes/         REST endpoints (/api/creators, /api/status, /api/youtube-push)

client/src/
  store.ts        Zustand store: tracked creators, statuses, grid selection
  api.ts          Fetch wrapper for the backend REST API
  components/     Sidebar, AddCreatorDialog, MultiviewGrid, PlayerCell
```
