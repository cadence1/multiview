import { createPortal } from "react-dom";
import type { Creator, CreatorStatus } from "../types.js";
import { formatElapsed, formatRelativeToNow } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";

const CARD_WIDTH = 256;
const CARD_HEIGHT_ESTIMATE = 200;

interface Props {
  creator: Creator;
  status?: CreatorStatus;
  anchorRect: DOMRect;
}

/**
 * Hover preview for a Live or Upcoming sidebar row. Rendered via a portal
 * into document.body (not inline in the sidebar) so it isn't clipped by the
 * sidebar's overflow-y-auto scroll container — a normally-positioned
 * absolute child would get cut off at the sidebar's edge.
 */
export default function StreamPreview({ creator, status, anchorRect }: Props) {
  const isLive = status?.state === "live";

  const top = Math.min(
    Math.max(8, anchorRect.top),
    window.innerHeight - CARD_HEIGHT_ESTIMATE - 8
  );
  const left = Math.min(anchorRect.right + 8, window.innerWidth - CARD_WIDTH - 8);

  return createPortal(
    <div
      style={{ position: "fixed", top, left, width: CARD_WIDTH, zIndex: 60 }}
      className="pointer-events-none overflow-hidden rounded-lg border border-base-600 bg-base-900 shadow-xl"
    >
      <div className="aspect-video w-full bg-black">
        {status?.thumbnailUrl ? (
          <img src={status.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-600">
            No preview
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5">
          <PlatformBadge platform={creator.platform} />
          <span className="truncate text-xs font-medium text-slate-100">
            {creator.display_name}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs text-slate-300">
          {status?.title || (isLive ? "Live now" : "Upcoming")}
        </p>
        {isLive
          ? status?.startTime && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-red-300">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Live for {formatElapsed(status.startTime)}
              </p>
            )
          : status?.startTime && (
              <p className="mt-1.5 text-[11px] font-medium text-indigo-300">
                Starts {formatRelativeToNow(status.startTime)}
              </p>
            )}
        {isLive && status?.viewerCount !== undefined && (
          <p className="mt-1 text-[11px] text-slate-400">
            {status.viewerCount.toLocaleString()} watching
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
