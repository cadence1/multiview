import type {
  CreatorRef,
  CreatorStatus,
  PlatformAdapter,
  ResolvedChannel,
} from "./types.js";
import { offlineStatus } from "./types.js";

// RPlay (rplay.live) has no official public API or developer program. This
// uses the same unauthenticated endpoints its own web client calls — no
// login/API key needed, but (like Kick's original adapter) it can change or
// start rate-limiting without notice. Unlike Kick, RPlay identifies
// creators by a raw Mongo-style 24-hex-char id in its URLs, not a
// human-readable slug, and has no username search endpoint — so a creator
// is added by pasting their profile/live URL (or the bare id), not a name.
const API_BASE = "https://api.rplay.live/live";

const OID_RE = /[0-9a-fA-F]{24}/;

function extractOid(raw: string): string | null {
  const q = raw.trim();
  const match = q.match(OID_RE);
  return match ? match[0].toLowerCase() : null;
}

function avatarUrlFor(oid: string): string {
  return `https://pb3.rplay.live/profilePhoto/${oid}-small/cdn-cgi/image/width=256,height=256,fit=cover,quality=90,format=auto`;
}

async function resolveChannel(query: string): Promise<ResolvedChannel | null> {
  const oid = extractOid(query);
  if (!oid) return null;

  const res = await fetch(`${API_BASE}/user?userOid=${oid}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { oid?: string; nickname?: string };
  if (!data?.oid) return null;

  return {
    platform: "rplay",
    platformId: data.oid,
    handle: data.oid,
    displayName: data.nickname || data.oid,
    avatarUrl: avatarUrlFor(data.oid),
  };
}

interface RplayLivestream {
  creatorOid: string;
  creatorNickname: string;
  title: string;
  viewerCount: number;
  streamStartTime: string;
  thumbnailUrl: string;
}

async function getStatuses(
  creators: CreatorRef[]
): Promise<Map<string, CreatorStatus>> {
  const result = new Map<string, CreatorStatus>();
  if (creators.length === 0) return result;

  const updatedAt = new Date().toISOString();

  // Unlike Kick/Twitch (batched by id), RPlay's public endpoint just
  // returns every currently-live creator site-wide in one call — cheaper
  // to fetch it once and filter locally than to look up per-creator.
  let live: RplayLivestream[] = [];
  try {
    const res = await fetch(`${API_BASE}/livestreams`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) live = await res.json();
  } catch (err) {
    console.error("[rplay] failed to fetch livestreams list:", err);
  }

  const byOid = new Map(live.map((l) => [l.creatorOid, l]));

  for (const creator of creators) {
    const stream = byOid.get(creator.platformId);
    if (stream) {
      result.set(creator.id, {
        creatorId: creator.id,
        state: "live",
        title: stream.title,
        thumbnailUrl: stream.thumbnailUrl,
        startTime: stream.streamStartTime,
        viewerCount: stream.viewerCount,
        embedId: creator.platformId,
        updatedAt,
      });
    } else {
      result.set(creator.id, offlineStatus(creator.id));
    }
  }

  return result;
}

export const rplayAdapter: PlatformAdapter = {
  platform: "rplay",
  resolveChannel,
  getStatuses,
};
