import type { Platform } from "./types.js";

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
};

export const PLATFORM_COLOR: Record<Platform, string> = {
  youtube: "#ff0000",
  twitch: "#9146ff",
  kick: "#53fc18",
};

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

export function computeGridDims(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function embedUrlFor(
  platform: Platform,
  embedId: string,
  twitchParent: string
): string {
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/embed/${embedId}?autoplay=1&mute=1&enablejsapi=0`;
    case "twitch":
      return `https://player.twitch.tv/?channel=${encodeURIComponent(
        embedId
      )}&parent=${encodeURIComponent(twitchParent)}&muted=true&autoplay=true`;
    case "kick":
      return `https://player.kick.com/${encodeURIComponent(embedId)}?muted=true&autoplay=true`;
  }
}
