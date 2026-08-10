import { env } from "../env.js";
import type {
  CreatorRef,
  CreatorStatus,
  PlatformAdapter,
  ResolvedChannel,
} from "./types.js";
import { offlineStatus } from "./types.js";

// Kick's official public API (https://github.com/KickEngineering/KickDevDocs).
// Unlike the old unofficial kick.com/api/v2 endpoint this replaced, this is a
// real developer surface authenticated via OAuth2 client-credentials — it
// isn't behind the same Cloudflare bot-detection that blocked Node's fetch
// by TLS fingerprint, so no curl-subprocess fallback is needed here.
const API_BASE = "https://api.kick.com";

let cachedToken: { token: string; expiresAt: number } | null = null;
let warnedMissingCreds = false;

function credsConfigured(): boolean {
  const ok = Boolean(env.kickClientId && env.kickClientSecret);
  if (!ok && !warnedMissingCreds) {
    console.warn(
      "[kick] KICK_CLIENT_ID / KICK_CLIENT_SECRET not set — Kick creators will show as offline."
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
  const url = new URL("https://id.kick.com/oauth/token");
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("client_id", env.kickClientId);
  url.searchParams.set("client_secret", env.kickClientSecret);
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[kick] failed to get app access token: ${res.status} ${body}`);
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// Kick's API only needs the bearer token — no separate Client-Id header,
// unlike Twitch's Helix API.
async function apiFetch(path: string, params: [string, string][]): Promise<any | null> {
  const token = await getAppToken();
  if (!token) return null;
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function extractSlug(raw: string): string {
  let q = raw.trim();
  try {
    if (q.includes("kick.com")) {
      const url = new URL(q.startsWith("http") ? q : `https://${q}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0]) q = parts[0];
    }
  } catch {
    // not a URL, use as-is
  }
  return q.replace(/^@/, "").toLowerCase();
}

interface KickChannel {
  broadcaster_user_id: number;
  slug: string;
  stream_title?: string;
  stream?: {
    is_live: boolean;
    viewer_count: number;
    thumbnail?: string;
    start_time?: string;
  };
}

async function fetchChannelsBySlug(slugs: string[]): Promise<KickChannel[]> {
  if (slugs.length === 0) return [];
  const params: [string, string][] = slugs.map((s) => ["slug", s]);
  const data = await apiFetch("/public/v1/channels", params);
  return data?.data ?? [];
}

async function fetchChannelsById(ids: string[]): Promise<KickChannel[]> {
  if (ids.length === 0) return [];
  const params: [string, string][] = ids.map((id) => ["broadcaster_user_id", id]);
  const data = await apiFetch("/public/v1/channels", params);
  return data?.data ?? [];
}

interface KickUser {
  user_id: number;
  name: string;
  profile_picture?: string;
}

// /public/v1/channels doesn't include an avatar, so resolving a channel
// needs this second call — /public/v1/users, keyed by the numeric user id.
async function fetchUsersById(ids: number[]): Promise<Map<number, KickUser>> {
  const map = new Map<number, KickUser>();
  if (ids.length === 0) return map;
  const params: [string, string][] = ids.map((id) => ["id", String(id)]);
  const data = await apiFetch("/public/v1/users", params);
  for (const u of data?.data ?? []) {
    map.set(u.user_id, u);
  }
  return map;
}

async function resolveChannel(query: string): Promise<ResolvedChannel | null> {
  // Same reasoning as Twitch's resolveChannel: without this, missing/invalid
  // credentials and a genuinely-nonexistent channel would both surface as
  // an identical, misleading "channel not found".
  if (!credsConfigured()) {
    throw new Error("Kick isn't configured on this server — set KICK_CLIENT_ID and KICK_CLIENT_SECRET.");
  }

  const slug = extractSlug(query);
  if (!slug) return null;

  const channels = await fetchChannelsBySlug([slug]);
  const channel = channels[0];
  if (!channel) return null;

  const users = await fetchUsersById([channel.broadcaster_user_id]);
  const user = users.get(channel.broadcaster_user_id);

  return {
    platform: "kick",
    // The numeric broadcaster id is Kick's actual stable identity (a slug
    // can be renamed); the slug is kept as `handle` for building
    // human-readable URLs (kick.com/{slug}, player.kick.com/{slug}).
    platformId: String(channel.broadcaster_user_id),
    handle: channel.slug,
    displayName: user?.name || channel.slug,
    avatarUrl: user?.profile_picture || "",
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getStatuses(
  creators: CreatorRef[]
): Promise<Map<string, CreatorStatus>> {
  const result = new Map<string, CreatorStatus>();
  if (!credsConfigured()) {
    for (const c of creators) result.set(c.id, offlineStatus(c.id));
    return result;
  }
  if (creators.length === 0) return result;

  const updatedAt = new Date().toISOString();
  const byPlatformId = new Map(creators.map((c) => [c.platformId, c]));

  for (const batch of chunk(creators, 50)) {
    const channels = await fetchChannelsById(batch.map((c) => c.platformId));
    const seen = new Set<string>();
    for (const channel of channels) {
      const creator = byPlatformId.get(String(channel.broadcaster_user_id));
      if (!creator) continue;
      seen.add(creator.platformId);
      if (channel.stream?.is_live) {
        result.set(creator.id, {
          creatorId: creator.id,
          state: "live",
          title: channel.stream_title,
          thumbnailUrl: channel.stream.thumbnail,
          startTime: channel.stream.start_time,
          viewerCount: channel.stream.viewer_count,
          embedId: creator.handle,
          updatedAt,
        });
      } else {
        result.set(creator.id, offlineStatus(creator.id));
      }
    }
    for (const creator of batch) {
      if (!seen.has(creator.platformId)) {
        result.set(creator.id, offlineStatus(creator.id));
      }
    }
  }

  return result;
}

export const kickAdapter: PlatformAdapter = {
  platform: "kick",
  resolveChannel,
  getStatuses,
};
