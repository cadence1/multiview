import type { Platform } from "../types.js";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "../utils.js";

export default function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
      style={{ backgroundColor: PLATFORM_COLOR[platform] }}
      title={PLATFORM_LABEL[platform]}
    >
      {platform === "youtube"
        ? "YT"
        : platform === "twitch"
          ? "TW"
          : platform === "kick"
            ? "KI"
            : "RP"}
    </span>
  );
}
