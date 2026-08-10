import { env } from "../env.js";
import type {
  CreatorRef,
  CreatorStatus,
  PlatformAdapter,
  ResolvedChannel,
} from "./types.js";
import { offlineStatus, isWithinUpcomingWindow } from "./types.js";

const HELIX = "https://api.twitch.tv/helix";

let cachedToken: { token: string; expiresAt: number } | null = null;
let warnedMissingCreds = false;

function credsConfigured(): boolean {
  const ok = Boolean(env.twitchClientId && env.twitchClientSecret);
  if (!ok && !warnedMissingCreds) {
    console.warn(
      "[twitch] TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set — Twitch creators will show as offline."
    );
    warnedMissingCreds = true;
  }
  return ok;
}

async function getAppToken(): Promise<string | null> {
  if (!credsConfigured()) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", env.twitchClientId);
  url.searchParams.set("client_secret", env.twitchClientSecret);
  url.searchParams.set("grant_type", "client_credentials");
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

async function helixFetch(path: string, params: [string, string][]): Promise<any | null> {
  const token = await getAppToken();
  if (!token) return null;
  const url = new URL(`${HELIX}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const res = await fetch(url, {
    headers: {
      "Client-Id": env.twitchClientId,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

type ParsedQuery =
  | { kind: "login"; value: string }
  | { kind: "videoId"; value: string }
  | { kind: "clipSlug"; value: string };

function parseQuery(raw: string): ParsedQuery {
  const q = raw.trim();

  try {
    const url = new URL(q.includes("://") ? q : `https://${q}`);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    const parts = url.pathname.split("/").filter(Boolean);

    // clips.twitch.tv/{slug} — a short clip link, channel-agnostic.
    if (host === "clips.twitch.tv" && parts[0]) {
      return { kind: "clipSlug", value: parts[0] };
    }

    if (host === "twitch.tv") {
      // twitch.tv/videos/{id} — a VOD link, also channel-agnostic.
      if (parts[0] === "videos" && parts[1]) {
        return { kind: "videoId", value: parts[1] };
      }
      // twitch.tv/{channel}/clip/{slug}
      if (parts.length >= 3 && parts[1] === "clip" && parts[2]) {
        return { kind: "clipSlug", value: parts[2] };
      }
      if (parts[0]) {
        return { kind: "login", value: parts[0] };
      }
    }
  } catch {
    // not a URL, fall through
  }

  return { kind: "login", value: q.replace(/^@/, "") };
}

function toResolvedChannel(user: any): ResolvedChannel {
  return {
    platform: "twitch",
    platformId: user.id,
    handle: user.login,
    displayName: user.display_name || user.login,
    avatarUrl: user.profile_image_url || "",
  };
}

async function resolveByLogin(login: string): Promise<ResolvedChannel | null> {
  if (!login) return null;
  const data = await helixFetch("/users", [["login", login.toLowerCase()]]);
  const user = data?.data?.[0];
  return user ? toResolvedChannel(user) : null;
}

async function resolveById(id: string): Promise<ResolvedChannel | null> {
  const data = await helixFetch("/users", [["id", id]]);
  const user = data?.data?.[0];
  return user ? toResolvedChannel(user) : null;
}

async function resolveChannel(query: string): Promise<ResolvedChannel | null> {
  const parsed = parseQuery(query);

  if (parsed.kind === "videoId") {
    const data = await helixFetch("/videos", [["id", parsed.value]]);
    const video = data?.data?.[0];
    if (!video) return null;
    return resolveByLogin(video.user_login);
  }

  if (parsed.kind === "clipSlug") {
    const data = await helixFetch("/clips", [["id", parsed.value]]);
    const clip = data?.data?.[0];
    if (!clip) return null;
    return resolveById(clip.broadcaster_id);
  }

  return resolveByLogin(parsed.value);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchLiveStreams(
  creators: CreatorRef[]
): Promise<Map<string, any>> {
  const byLogin = new Map<string, any>();
  for (const batch of chunk(creators, 100)) {
    const params: [string, string][] = batch.map((c) => ["user_login", c.handle]);
    const data = await helixFetch("/streams", params);
    for (const stream of data?.data ?? []) {
      byLogin.set(stream.user_login.toLowerCase(), stream);
    }
  }
  return byLogin;
}

async function fetchUpcomingSegment(creator: CreatorRef): Promise<any | null> {
  const data = await helixFetch("/schedule", [
    ["broadcaster_id", creator.platformId],
  ]);
  const segment = data?.data?.segments?.[0];
  if (!segment) return null;
  const startMs = new Date(segment.start_time).getTime();
  // Only surface segments starting within the window.
  if (!isWithinUpcomingWindow(startMs)) return null;
  return segment;
}

async function getStatuses(
  creators: CreatorRef[]
): Promise<Map<string, CreatorStatus>> {
  const result = new Map<string, CreatorStatus>();
  if (!credsConfigured()) {
    for (const c of creators) result.set(c.id, offlineStatus(c.id));
    return result;
  }

  const liveByLogin = await fetchLiveStreams(creators);
  const updatedAt = new Date().toISOString();
  const offlineCreators: CreatorRef[] = [];

  for (const creator of creators) {
    const stream = liveByLogin.get(creator.handle.toLowerCase());
    if (stream) {
      result.set(creator.id, {
        creatorId: creator.id,
        state: "live",
        title: stream.title,
        thumbnailUrl: (stream.thumbnail_url as string)
          .replace("{width}", "440")
          .replace("{height}", "248"),
        startTime: stream.started_at,
        viewerCount: stream.viewer_count,
        embedId: creator.handle,
        updatedAt,
      });
    } else {
      offlineCreators.push(creator);
    }
  }

  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < offlineCreators.length) {
      const creator = offlineCreators[i++];
      const segment = await fetchUpcomingSegment(creator);
      if (segment) {
        result.set(creator.id, {
          creatorId: creator.id,
          state: "upcoming",
          title: segment.title,
          startTime: segment.start_time,
          embedId: creator.handle,
          updatedAt,
        });
      } else {
        result.set(creator.id, offlineStatus(creator.id));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  return result;
}

export const twitchAdapter: PlatformAdapter = {
  platform: "twitch",
  resolveChannel,
  getStatuses,
};
