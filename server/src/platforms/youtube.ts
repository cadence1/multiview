import { env } from "../env.js";
import type {
  CreatorRef,
  CreatorStatus,
  PlatformAdapter,
  ResolvedChannel,
} from "./types.js";
import { offlineStatus, isWithinUpcomingWindow } from "./types.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAGE_HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9",
  // Skip the EU consent interstitial.
  Cookie: "CONSENT=YES+1;",
};

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: PAGE_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function matchOne(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m ? m[1] : undefined;
}

/**
 * Finds `marker` in `html`, then extracts and JSON.parses the object literal
 * that starts at the next `{` after it, using a brace-balanced (string-aware)
 * scan rather than a regex. A naive regex can't safely capture nested JSON,
 * and a *global* regex for fields like "isLive":true is dangerous here: the
 * page embeds many unrelated video/channel blobs (sidebar, recommendations),
 * so matching anywhere on the page picks up flags that belong to a totally
 * different video. Scoping to one parsed object avoids that.
 */
function extractJsonAfter(html: string, marker: string): any | null {
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = html.indexOf("{", markerIdx);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface PageMeta {
  channelId: string;
  displayName: string;
  avatarUrl: string;
}

function extractChannelMeta(html: string): PageMeta | null {
  // The page embeds many "channelId" values (recommended/related channels,
  // ads, etc.) — the first match is NOT reliably the page's own channel.
  // The canonical link and "externalId" are scoped to the primary channel.
  const channelId =
    matchOne(html, /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})">/) ||
    matchOne(html, /"externalId":"(UC[\w-]{22})"/) ||
    matchOne(html, /"channelId":"(UC[\w-]{22})"/);
  if (!channelId) return null;
  const displayName =
    matchOne(html, /<meta property="og:title" content="([^"]*)"/) ||
    matchOne(html, /"author":"([^"]*)"/) ||
    channelId;
  const avatarUrl =
    matchOne(html, /<meta property="og:image" content="([^"]*)"/) || "";
  return {
    channelId,
    displayName: decodeHtml(displayName),
    avatarUrl,
  };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

type ParsedQuery =
  | { kind: "channelId"; value: string }
  | { kind: "videoId"; value: string }
  | { kind: "path"; value: string }; // path to fetch directly, e.g. "@handle" or "c/Name"

function parseQuery(raw: string): ParsedQuery {
  const q = raw.trim();
  if (/^UC[\w-]{22}$/.test(q)) return { kind: "channelId", value: q };

  try {
    const url = new URL(q.includes("://") ? q : `https://${q}`);
    const host = url.hostname.replace(/^www\.|^m\./, "");

    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      if (videoId) return { kind: "videoId", value: videoId };
    }

    if (host === "youtube.com") {
      const parts = url.pathname.split("/").filter(Boolean);

      if (parts[0] === "watch") {
        const v = url.searchParams.get("v");
        if (v) return { kind: "videoId", value: v };
      }
      // /shorts/{id} and a bare /live/{id} share-link (distinct from
      // /channel/{id}/live, handled below).
      if ((parts[0] === "shorts" || parts[0] === "live") && parts[1]) {
        return { kind: "videoId", value: parts[1] };
      }
      if (parts[0] === "channel" && parts[1]) {
        return { kind: "channelId", value: parts[1] };
      }
      if (parts.length > 0) {
        return { kind: "path", value: parts.join("/") };
      }
    }
  } catch {
    // not a URL, fall through
  }

  if (q.startsWith("@")) return { kind: "path", value: q };
  return { kind: "path", value: `@${q}` };
}

async function resolveViaApiKey(handlePath: string): Promise<ResolvedChannel | null> {
  const handle = handlePath.startsWith("@") ? handlePath : `@${handlePath}`;
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("forHandle", handle);
  url.searchParams.set("key", env.youtubeApiKey);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  const item = data.items?.[0];
  if (!item) return null;
  return {
    platform: "youtube",
    platformId: item.id,
    handle,
    displayName: item.snippet?.title || handle,
    avatarUrl: item.snippet?.thumbnails?.medium?.url || "",
  };
}

async function resolveChannelById(channelId: string): Promise<ResolvedChannel | null> {
  const html = await fetchText(`https://www.youtube.com/channel/${channelId}`);
  if (!html) return null;
  const meta = extractChannelMeta(html);
  if (!meta) return null;
  return {
    platform: "youtube",
    platformId: meta.channelId,
    handle: meta.channelId,
    displayName: meta.displayName,
    avatarUrl: meta.avatarUrl,
  };
}

/** Given a video ID, find the channel ID that owns it via the video's own player response. */
async function resolveChannelIdFromVideo(videoId: string): Promise<string | null> {
  const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}`);
  if (!html) return null;
  const playerResponse = extractJsonAfter(html, "ytInitialPlayerResponse");
  const channelId = playerResponse?.videoDetails?.channelId;
  return typeof channelId === "string" && /^UC[\w-]{22}$/.test(channelId) ? channelId : null;
}

async function resolveChannel(query: string): Promise<ResolvedChannel | null> {
  const parsed = parseQuery(query);

  if (parsed.kind === "channelId") {
    return resolveChannelById(parsed.value);
  }

  if (parsed.kind === "videoId") {
    const channelId = await resolveChannelIdFromVideo(parsed.value);
    if (!channelId) return null;
    return resolveChannelById(channelId);
  }

  // parsed.kind === "path" — a handle (e.g. "@MrBeast") or custom path (e.g. "c/Name").
  if (env.youtubeApiKey && parsed.value.startsWith("@")) {
    const viaApi = await resolveViaApiKey(parsed.value);
    if (viaApi) return viaApi;
  }

  const html = await fetchText(`https://www.youtube.com/${parsed.value}`);
  if (!html) return null;
  const meta = extractChannelMeta(html);
  if (!meta) return null;
  const handle = parsed.value.startsWith("@") ? parsed.value : meta.channelId;
  return {
    platform: "youtube",
    platformId: meta.channelId,
    handle,
    displayName: meta.displayName,
    avatarUrl: meta.avatarUrl,
  };
}

interface LiveParse {
  videoId: string;
  isLiveNow: boolean;
  isUpcoming: boolean;
  title?: string;
  thumbnailUrl?: string;
  startTimestamp?: string;
  scheduledStartSeconds?: string;
}

function largestThumbnail(thumbnails: any[] | undefined): string | undefined {
  if (!thumbnails || thumbnails.length === 0) return undefined;
  return thumbnails[thumbnails.length - 1]?.url;
}

function parseLivePage(html: string): LiveParse | null {
  // Scoped to the single primary video's own player response — does not
  // read flags from unrelated videos elsewhere on the page (see
  // extractJsonAfter for why that matters).
  const playerResponse = extractJsonAfter(html, "ytInitialPlayerResponse");
  const videoDetails = playerResponse?.videoDetails;
  const videoId: string | undefined = videoDetails?.videoId;
  if (!videoId) return null;

  const microformat = playerResponse?.microformat?.playerMicroformatRenderer;
  const liveBroadcastDetails = microformat?.liveBroadcastDetails;
  const offlineSlate =
    playerResponse?.playabilityStatus?.liveStreamability?.liveStreamabilityRenderer
      ?.offlineSlate;

  const isLiveNow = Boolean(liveBroadcastDetails?.isLiveNow ?? videoDetails?.isLive);
  const isUpcoming = Boolean(videoDetails?.isUpcoming);

  const title: string | undefined = videoDetails?.title || microformat?.title?.simpleText;
  const thumbnailUrl =
    largestThumbnail(videoDetails?.thumbnail?.thumbnails) ||
    largestThumbnail(microformat?.thumbnail?.thumbnails);
  const startTimestamp: string | undefined = liveBroadcastDetails?.startTimestamp;
  const scheduledStartSeconds: string | undefined =
    offlineSlate?.scheduledStartTime || matchOne(html, /"scheduledStartTime":"(\d+)"/);

  return {
    videoId,
    isLiveNow,
    isUpcoming,
    title,
    thumbnailUrl,
    startTimestamp,
    scheduledStartSeconds,
  };
}

async function getStatusFor(creator: CreatorRef): Promise<CreatorStatus> {
  const html = await fetchText(
    `https://www.youtube.com/channel/${creator.platformId}/live`
  );
  if (!html) return offlineStatus(creator.id);

  const parsed = parseLivePage(html);
  if (!parsed) return offlineStatus(creator.id);

  const updatedAt = new Date().toISOString();

  // Check isLiveNow first: a premiere/scheduled stream can carry stale
  // isUpcoming:true for a few seconds after it actually goes live.
  if (parsed.isLiveNow) {
    return {
      creatorId: creator.id,
      state: "live",
      title: parsed.title,
      thumbnailUrl: parsed.thumbnailUrl,
      startTime: parsed.startTimestamp,
      embedId: parsed.videoId,
      updatedAt,
    };
  }

  if (parsed.isUpcoming) {
    const startTime = parsed.scheduledStartSeconds
      ? new Date(Number(parsed.scheduledStartSeconds) * 1000).toISOString()
      : undefined;
    const startMs = startTime ? new Date(startTime).getTime() : undefined;

    // Only surface it as "upcoming" once it's within the window — further
    // out, stale by hours/days past its scheduled time (or with an unknown
    // start time), it's reported as offline instead.
    if (startMs !== undefined && isWithinUpcomingWindow(startMs)) {
      return {
        creatorId: creator.id,
        state: "upcoming",
        title: parsed.title,
        thumbnailUrl: parsed.thumbnailUrl,
        startTime,
        embedId: parsed.videoId,
        updatedAt,
      };
    }
  }

  return offlineStatus(creator.id);
}

async function getStatuses(
  creators: CreatorRef[]
): Promise<Map<string, CreatorStatus>> {
  const result = new Map<string, CreatorStatus>();
  // Sequential-ish with limited concurrency to stay polite to YouTube's edge.
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < creators.length) {
      const creator = creators[i++];
      const status = await getStatusFor(creator);
      result.set(creator.id, status);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

export const youtubeAdapter: PlatformAdapter = {
  platform: "youtube",
  resolveChannel,
  getStatuses,
};
