import { spawn } from "node:child_process";
import type {
  CreatorRef,
  CreatorStatus,
  PlatformAdapter,
  ResolvedChannel,
} from "./types.js";
import { offlineStatus } from "./types.js";

// Kick has no official public API. This uses the same unofficial endpoint the
// kick.com web client itself calls. It can change or start rate-limiting
// without notice — treat Kick support as best-effort.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Kick's Cloudflare WAF blocks Node's own fetch/undici client by TLS
// fingerprint (JA3), independent of headers or user-agent — confirmed by the
// same request succeeding via curl and failing via fetch every time. Try
// fetch first (cheap, no subprocess), then fall back to shelling out to
// curl, whose TLS fingerprint isn't flagged. Requires `curl` on PATH, which
// ships by default on Windows 10+, most Linux distros, and is installed in
// this project's Docker image.
// Once fetch is observed getting blocked, skip straight to curl on later
// calls instead of paying for a doomed round trip every poll. If curl turns
// out not to be installed, fall back to fetch-only so the adapter still
// tries something rather than always failing.
let preferCurl = false;

function curlJson(url: string): Promise<any | null> {
  return new Promise((resolve) => {
    const proc = spawn("curl", ["-s", "-A", UA, "-H", "Accept: application/json", url]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", () => {
      preferCurl = false; // curl not on PATH — stop routing through it
      resolve(null);
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve(null);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(null);
      }
    });
  });
}

async function fetchChannel(slug: string): Promise<any | null> {
  const url = `https://kick.com/api/v2/channels/${slug}`;

  if (!preferCurl) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (res.ok) return await res.json();
      preferCurl = true; // blocked — route future requests through curl
    } catch {
      // network error, not a block — try curl once, but don't commit to it
    }
  }

  return curlJson(url);
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

async function resolveChannel(query: string): Promise<ResolvedChannel | null> {
  const slug = extractSlug(query);
  if (!slug) return null;
  const data = await fetchChannel(slug);
  if (!data) return null;
  return {
    platform: "kick",
    platformId: slug,
    handle: slug,
    displayName: data.user?.username || data.slug || slug,
    avatarUrl: data.user?.profile_pic || "",
  };
}

async function getStatuses(
  creators: CreatorRef[]
): Promise<Map<string, CreatorStatus>> {
  const result = new Map<string, CreatorStatus>();
  const updatedAt = new Date().toISOString();
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < creators.length) {
      const creator = creators[i++];
      const data = await fetchChannel(creator.platformId);
      const live = data?.livestream;
      if (live) {
        result.set(creator.id, {
          creatorId: creator.id,
          state: "live",
          title: live.session_title,
          thumbnailUrl: live.thumbnail?.url,
          startTime: live.created_at,
          viewerCount: live.viewer_count,
          embedId: creator.platformId,
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

export const kickAdapter: PlatformAdapter = {
  platform: "kick",
  resolveChannel,
  getStatuses,
};
