import type { Creator, CreatorStatus, Platform } from "./types.js";

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
  rplay: "RPlay",
};

export const PLATFORM_COLOR: Record<Platform, string> = {
  youtube: "#ff0000",
  twitch: "#9146ff",
  kick: "#53fc18",
  rplay: "#ff5fa2",
};

/**
 * A creator's actual, stable identity — same today, tomorrow, and on any
 * instance you export/import into. Use this (not creator.id) as the key for
 * anything meant to persist across a re-import: creator.id is just a
 * database primary key that a fresh nanoid() replaces on every import (and
 * even a plain untrack-then-re-add on the same instance).
 */
export function stableKey(creator: Pick<Creator, "platform" | "platform_id">): string {
  return `${creator.platform}:${creator.platform_id}`;
}

export function formatRelativeToNow(iso?: string): string {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  const diffMs = target - Date.now();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return diffMs >= 0 ? "starting now" : "just now";
  if (mins < 60) {
    return diffMs >= 0 ? `in ${mins}m` : `${mins}m ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return diffMs >= 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return diffMs >= 0 ? `in ${days}d` : `${days}d ago`;
}

/** How long a live stream has been running, e.g. "1h 23m" or "45m". */
export function formatElapsed(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just started";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function computeGridDims(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/**
 * `kickMuted` only matters for Kick, which has no live player-control API —
 * changing its volume means reloading the embed with a new `muted` value.
 * YouTube and Twitch are always embedded muted; real volume control happens
 * afterward through their JS player APIs (see lib/youtubeApi.ts,
 * lib/twitchApi.ts) rather than by reloading the iframe.
 */
export function embedUrlFor(
  platform: Platform,
  embedId: string,
  twitchParent: string,
  kickMuted = true
): string {
  switch (platform) {
    case "youtube":
      // enablejsapi=1 + origin are required for the IFrame Player API to be
      // able to attach to this iframe and issue setVolume/mute commands.
      return `https://www.youtube.com/embed/${embedId}?autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(
        window.location.origin
      )}`;
    case "twitch":
      // Unused by PlayerCell (Twitch cells use Twitch.Player instead, which
      // constructs its own iframe) — kept for reference/reuse elsewhere.
      return `https://player.twitch.tv/?channel=${encodeURIComponent(
        embedId
      )}&parent=${encodeURIComponent(twitchParent)}&muted=true&autoplay=true`;
    case "kick":
      return `https://player.kick.com/${encodeURIComponent(embedId)}?muted=${kickMuted}&autoplay=true`;
    case "rplay":
      // RPlay has no dedicated embeddable player — this is the full page
      // (nav, chat, login banner and all), not a clean minimal embed like
      // the other three platforms get. Its video does autoplay muted
      // without login, so it still works, just with extra chrome.
      return `https://rplay.live/live/${encodeURIComponent(embedId)}`;
  }
}

/** Master volume (0-100) scaled by a creator's own saved volume (0-100), clamped 0-100. */
export function effectiveVolume(masterVolume: number, creatorVolume: number | undefined): number {
  const cv = creatorVolume ?? 100;
  return Math.min(100, Math.max(0, Math.round((masterVolume / 100) * cv)));
}

/**
 * Embeddable live-chat URL for a creator, or null if chat isn't available
 * right now. Twitch chat works regardless of live status (it's the room,
 * not the stream). YouTube chat only exists for the specific live video, so
 * it needs a live embedId. Kick has no stable public embeddable chat widget.
 */
export function chatUrlFor(
  creator: Creator,
  status: CreatorStatus | undefined,
  hostname: string
): string | null {
  switch (creator.platform) {
    case "twitch":
      return `https://www.twitch.tv/embed/${encodeURIComponent(
        creator.handle
      )}/chat?parent=${encodeURIComponent(hostname)}&darkpopout`;
    case "youtube":
      return status?.state === "live" && status.embedId
        ? `https://www.youtube.com/live_chat?v=${status.embedId}&embed_domain=${hostname}&dark_theme=1`
        : null;
    case "kick":
      return null;
    case "rplay":
      // Its embed (see embedUrlFor) is the full rplay.live page, which
      // already includes chat inline — a separate chat panel would just be
      // a duplicate iframe of the same thing.
      return null;
  }
}

/** The creator's channel/home page on their platform (not the embed player). */
export function homeUrlFor(creator: Creator): string {
  switch (creator.platform) {
    case "youtube":
      // handle is either an "@handle" (preferred) or, when only a bare
      // channel ID was ever resolved, that ID itself — platform_id is
      // always the real channel ID regardless, so fall back to that.
      return creator.handle.startsWith("@")
        ? `https://www.youtube.com/${creator.handle}`
        : `https://www.youtube.com/channel/${creator.platform_id}`;
    case "twitch":
      return `https://www.twitch.tv/${creator.handle}`;
    case "kick":
      return `https://kick.com/${creator.handle}`;
    case "rplay":
      return `https://rplay.live/creatorhome/${creator.platform_id}`;
  }
}
