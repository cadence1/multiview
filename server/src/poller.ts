import { env } from "./env.js";
import { listCreators, type CreatorRow } from "./db.js";
import { statusCache } from "./cache.js";
import { adapters } from "./platforms/index.js";
import type { CreatorRef, Platform } from "./platforms/types.js";

function toRef(row: CreatorRow): CreatorRef {
  return {
    id: row.id,
    platform: row.platform,
    platformId: row.platform_id,
    handle: row.handle,
  };
}

async function pollOnce() {
  const rows = listCreators();
  const byPlatform = new Map<Platform, CreatorRef[]>();
  for (const row of rows) {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(toRef(row));
    byPlatform.set(row.platform, list);
  }

  await Promise.all(
    Array.from(byPlatform.entries()).map(async ([platform, creators]) => {
      try {
        const statuses = await adapters[platform].getStatuses(creators);
        statusCache.setMany(statuses.values());
      } catch (err) {
        console.error(`[poller] ${platform} status check failed:`, err);
      }
    })
  );
}

let timer: NodeJS.Timeout | null = null;

export function startPoller() {
  // Run once immediately, then on the configured interval.
  pollOnce().catch((err) => console.error("[poller] initial poll failed:", err));
  timer = setInterval(() => {
    pollOnce().catch((err) => console.error("[poller] poll failed:", err));
  }, env.pollIntervalSeconds * 1000);
}

export function stopPoller() {
  if (timer) clearInterval(timer);
}

/** Poll a single platform immediately (used right after adding a new creator). */
export async function pollPlatformNow(platform: Platform, creators: CreatorRef[]) {
  try {
    const statuses = await adapters[platform].getStatuses(creators);
    statusCache.setMany(statuses.values());
  } catch (err) {
    console.error(`[poller] on-demand ${platform} poll failed:`, err);
  }
}
