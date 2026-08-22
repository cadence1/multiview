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
5. Open a creator's **⋮** menu and click **Pin to multiview** — they'll open
   in the grid automatically whenever they go live, and close automatically
   once they end. Pinning a creator who's already live opens it right away.
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

## Recording (optional)

Save a live stream to disk for later viewing — YouTube, Twitch, and Kick
(not RPlay; nothing extracts its stream). Requires `yt-dlp` and `ffmpeg` on
`PATH` (both already in the Docker image); without them, a recording attempt
just fails with a clear error rather than breaking anything else.

- **⋮ on a creator's row** opens their options: **Record now**/**Stop
  recording** for a one-off recording of a live stream, **Record upcoming**
  (shown while they're upcoming, not yet live) to queue just their *next*
  session — it's consumed the moment that recording starts, so it won't
  apply to sessions after that — and **Always record**, a standing
  per-creator toggle that records every time they go live, no manual click
  needed (turning it on clears any pending **Record upcoming** as
  redundant). A pinned (📌), queued-to-record (⏱), or currently-recording
  (⏺) creator shows a small marker next to their name so it's visible
  without opening the menu.
- **Recordings** (top right) lists everything, in progress or finished —
  play inline, download, or delete. It also shows disk usage for the whole
  volume `RECORDINGS_DIR` lives on (not just what your recordings
  themselves take up), the same thing `RECORDING_MIN_FREE_GB` checks
  against — so it's visible *why* a new recording might get refused before
  it happens, not just after.
- `RECORDING_MIN_FREE_GB` (default 5) is a disk-full safety net, checked two
  ways: a new recording refuses to *start* below that much free space, and
  every currently-active recording is stopped (checked every 30s) if free
  space drops below it mid-recording — whatever was captured up to that
  point is kept and shows as **Low disk** in the list, same as a stalled
  recording. Set to `0` to disable both checks.
- Live recordings (manual or auto) are capped at `RECORDING_MAX_CONCURRENT`
  (default 4) simultaneously — past that, a new one is rejected outright
  rather than queued, since queueing something time-sensitive just means
  missing the part spent waiting.
- Internally records to MPEG-TS (resilient to interruption — the same
  reason `yt-dlp` defaults to it for any live source) and remuxes to a real
  `.mp4` once finished — fast and lossless, just repackaging, not
  re-encoding — so it plays natively in a browser afterward. If the remux
  itself fails, the `.ts` is kept as the deliverable instead: still fully
  valid, just not natively browser-playable (VLC and similar handle it
  fine).
- A stall watcher stops (and still tries to salvage) a recording that's
  stopped making real progress for a while — our own pipeline hanging, or
  not noticing the source ended — rather than let it run indefinitely.
  Marked "Stalled" rather than "Saved" so it's obviously distinguishable.
- Stopping sends `yt-dlp` its own documented graceful-stop signal first
  (finalizes the file cleanly), but escalates to an unconditional kill if it
  hasn't actually exited after a short grace period — verified directly in
  building this that a stuck process can simply not act on the polite
  signal, so this is a real backstop, not a nicety.
- No retention policy — recordings accumulate until you delete them
  yourself. `RECORDING_MIN_FREE_GB` (default 2) just refuses to *start* a
  new one below that much free disk space, as a safety net against ever
  filling the disk completely.
- `RECORDINGS_DIR` defaults to `DATA_DIR/recordings`; point it at an
  already-mounted network share (SMB, etc.) with no other changes needed —
  from the app's perspective that's indistinguishable from local disk.

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
- **No drag-to-resize grid** in this version — the grid auto-arranges by
  count. Would be a reasonable follow-up.
- **Recording** downloads the full stream via `yt-dlp`, not just metadata —
  a more direct implication of most platforms' Terms of Service (which
  generally prohibit unauthorized downloading) than anything else this app
  does. Personal DVR-style archival is common and broadly tolerated in
  practice (it's exactly what `yt-dlp` itself exists for), but this is
  meant for your own private, self-hosted use — not redistribution — same
  as the rest of this app's "personal/LAN use, no auth" framing above.

## Project layout

```
server/src/
  index.ts        Express app entry, serves the API and (in prod) the built client
  db.ts           SQLite schema + prepared statements
  cache.ts        In-memory status cache written by the poller, read by the API
  poller.ts       Background loop that refreshes live/upcoming status
  platforms/      One adapter per platform (resolveChannel + getStatuses)
  recordings/     yt-dlp/ffmpeg process management + local storage for recording
  routes/         REST endpoints (/api/creators, /api/status, /api/recordings)

client/src/
  store.ts        Zustand store: tracked creators, statuses, grid selection, recordings
  api.ts          Fetch wrapper for the backend REST API
  components/     Sidebar, AddCreatorDialog, MultiviewGrid, PlayerCell, RecordingsPanel
```
