import { env } from "./env.js";
import { listCreators, statements, type CreatorRow } from "./db.js";
import { statusCache } from "./cache.js";
import { adapters } from "./platforms/index.js";
import type { CreatorRef, Platform } from "./platforms/types.js";
import { isImminent } from "./platforms/types.js";
import * as recorder from "./recordings/recorder.js";

function toRef(row: CreatorRow): CreatorRef {
  return {
    id: row.id,
    platform: row.platform,
    platformId: row.platform_id,
    handle: row.handle,
  };
}

function byPlatform(refs: CreatorRef[]): Map<Platform, CreatorRef[]> {
  const map = new Map<Platform, CreatorRef[]>();
  for (const ref of refs) {
    const list = map.get(ref.platform) ?? [];
    list.push(ref);
    map.set(ref.platform, list);
  }
  return map;
}

async function pollRefs(refs: CreatorRef[], logPrefix: string) {
  await Promise.all(
    Array.from(byPlatform(refs).entries()).map(async ([platform, creators]) => {
      try {
        const statuses = await adapters[platform].getStatuses(creators);
        statusCache.setMany(statuses.values());
      } catch (err) {
        console.error(`[poller] ${logPrefix}${platform} status check failed:`, err);
      }
    })
  );
}

/**
 * Starts a recording for any creator marked auto_record (standing — every
 * future session) or record_next (one-shot — just the next one, e.g. from
 * clicking "Record upcoming" on someone not live yet) who's live and not
 * already being recorded. Deliberately keyed off "is there an active
 * recording right now" rather than a live-transition comparison — that
 * also self-heals if a previous recording for the same creator already
 * ended (naturally or otherwise) while they're still live, and it means no
 * "previous status" bookkeeping is needed here at all. Never triggers a
 * *stop* — see recorder.ts for why that's deliberately left to the
 * recording process's own end-of-stream detection instead of our
 * (sometimes flaky) live/offline reads.
 */
function checkAutoRecordings() {
  for (const row of listCreators()) {
    if ((!row.auto_record && !row.record_next) || recorder.isRecording(row.id)) continue;
    const status = statusCache.get(row.id);
    if (status?.state !== "live") continue;
    recorder.startRecording(row, status).then((result) => {
      if (!result.ok) {
        // Left as-is (not cleared) on failure — a transient reason like the
        // concurrency cap should retry on a later poll, not silently drop
        // the user's queued intent after one failed attempt.
        console.warn(`[poller] auto-record skipped for ${row.display_name}: ${result.error}`);
        return;
      }
      if (row.record_next) statements.setRecordNext.run(row.id, false); // one-shot, consumed
    });
  }
}

async function pollOnce() {
  const refs = listCreators().map(toRef);
  await pollRefs(refs, "");
  checkAutoRecordings();
}

/**
 * Re-checks only creators the cache already has marked "upcoming" with a
 * scheduled start close to now (see isImminent) — at the default 5-minute
 * poll interval, a stream that goes live right after a regular poll could
 * otherwise sit undetected for most of that window. Runs far more often
 * than the regular poll, but over a small, self-limiting set: nothing stays
 * in it once it's actually live (the next tick's cache read no longer
 * matches "upcoming") or once isImminent's own grace period lapses.
 */
async function pollImminent() {
  const refs = listCreators()
    .map(toRef)
    .filter((ref) => {
      const status = statusCache.get(ref.id);
      if (status?.state !== "upcoming" || !status.startTime) return false;
      return isImminent(new Date(status.startTime).getTime());
    });
  if (refs.length === 0) return;
  await pollRefs(refs, "imminent ");
  checkAutoRecordings();
}

const IMMINENT_POLL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let imminentTimer: NodeJS.Timeout | null = null;

export function startPoller() {
  // Run once immediately, then on the configured interval.
  pollOnce().catch((err) => console.error("[poller] initial poll failed:", err));
  timer = setInterval(() => {
    pollOnce().catch((err) => console.error("[poller] poll failed:", err));
  }, env.pollIntervalSeconds * 1000);
  imminentTimer = setInterval(() => {
    pollImminent().catch((err) => console.error("[poller] imminent poll failed:", err));
  }, IMMINENT_POLL_MS);
}

export function stopPoller() {
  if (timer) clearInterval(timer);
  if (imminentTimer) clearInterval(imminentTimer);
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
