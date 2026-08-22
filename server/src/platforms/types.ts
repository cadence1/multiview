export type Platform = "youtube" | "twitch" | "kick" | "rplay";

export type StreamState = "live" | "upcoming" | "offline";

/** A creator resolved from a user-supplied handle/URL, ready to be stored. */
export interface ResolvedChannel {
  platform: Platform;
  platformId: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
}

export interface CreatorRef {
  id: string;
  platform: Platform;
  platformId: string;
  handle: string;
}

/** Live/upcoming/offline status for a single tracked creator, as produced by the poller. */
export interface CreatorStatus {
  creatorId: string;
  state: StreamState;
  title?: string;
  thumbnailUrl?: string;
  startTime?: string; // ISO timestamp, for "live" (actual start) or "upcoming" (scheduled start)
  viewerCount?: number;
  /** Opaque per-platform id used to build the embed URL (YouTube videoId, Twitch login, Kick slug). */
  embedId?: string;
  updatedAt: string;
}

export interface PlatformAdapter {
  platform: Platform;
  /** Turn a user-supplied handle/URL/slug into a resolved channel, or null if not found. */
  resolveChannel(query: string): Promise<ResolvedChannel | null>;
  /** Batched live/upcoming lookup for every tracked creator on this platform. */
  getStatuses(creators: CreatorRef[]): Promise<Map<string, CreatorStatus>>;
}

export function offlineStatus(creatorId: string): CreatorStatus {
  return { creatorId, state: "offline", updatedAt: new Date().toISOString() };
}

/**
 * A scheduled stream is only surfaced as "upcoming" if its start time falls
 * within this window around now; further out in the future (or with no
 * known start time) it's reported as "offline" instead, until it gets
 * closer.
 */
export const UPCOMING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 2 days ahead

/**
 * How far *past* its scheduled start a stream can be and still count as
 * "upcoming" rather than "offline" — covers ordinary late starts (common,
 * especially for VTuber premieres) without letting a schedule that's stale
 * by days or months (the creator never started it, or never properly
 * canceled it) sit in "Upcoming" forever.
 */
export const UPCOMING_PAST_GRACE_MS = 3 * 60 * 60 * 1000; // 3 hours late

/** Whether a scheduled start time is close enough to now to count as "upcoming". */
export function isWithinUpcomingWindow(startMs: number): boolean {
  const deltaMs = startMs - Date.now();
  return deltaMs >= -UPCOMING_PAST_GRACE_MS && deltaMs <= UPCOMING_WINDOW_MS;
}

/**
 * How soon before its scheduled start an "upcoming" creator gets picked up
 * by the poller's fast lane (see poller.ts) instead of waiting for the next
 * regular poll — which, at the default 5-minute interval, could otherwise
 * leave a stream that just went live undetected for most of that window.
 */
export const IMMINENT_LOOKAHEAD_MS = 3 * 60 * 1000; // 3 minutes ahead

/**
 * How long past its scheduled start an "upcoming" creator stays in the fast
 * lane — covers an ordinary late start without fast-polling something
 * that's actually just stale forever (isWithinUpcomingWindow's own much
 * longer grace period still governs when it drops to "offline" outright).
 */
export const IMMINENT_PAST_GRACE_MS = 15 * 60 * 1000; // 15 minutes late

/** Whether a scheduled start time is close enough to now to fast-poll for it. */
export function isImminent(startMs: number): boolean {
  const deltaMs = startMs - Date.now();
  return deltaMs >= -IMMINENT_PAST_GRACE_MS && deltaMs <= IMMINENT_LOOKAHEAD_MS;
}
