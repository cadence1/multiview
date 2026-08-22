import type { Platform } from "../types.js";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "../utils.js";

const SHORT_LABEL: Record<Platform, string> = {
  youtube: "YT",
  twitch: "TW",
  kick: "KI",
  rplay: "RP",
};

function isKnownPlatform(platform: string): platform is Platform {
  return platform in PLATFORM_COLOR;
}

/**
 * Accepts a plain string, not just Platform — a creator's platform is
 * always one of the four known ones, but a manually-downloaded recording's
 * source (Recording.platform) can be whatever yt-dlp's extractor reports
 * (see recorder.ts's platformFromExtractor), so this degrades gracefully
 * for anything it doesn't recognize instead of assuming one of the four.
 */
export default function PlatformBadge({ platform }: { platform: string }) {
  const known = isKnownPlatform(platform);
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
      style={{ backgroundColor: known ? PLATFORM_COLOR[platform] : "#94a3b8" }}
      title={known ? PLATFORM_LABEL[platform] : platform}
    >
      {known ? SHORT_LABEL[platform] : platform.slice(0, 2).toUpperCase()}
    </span>
  );
}
