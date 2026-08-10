export type Platform = "youtube" | "twitch" | "kick";

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
 * A scheduled stream is only surfaced as "upcoming" if it starts within this
 * window; further out (or with no known start time) it's reported as
 * "offline" instead, until it gets closer.
 */
export const UPCOMING_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
