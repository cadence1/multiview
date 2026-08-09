import { useMemo } from "react";
import type { Creator, CreatorStatus } from "../types.js";
import { embedUrlFor, formatRelativeToNow } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";

interface Props {
  creator: Creator;
  status?: CreatorStatus;
  onRemove: () => void;
}

function placeholderText(creator: Creator, status?: CreatorStatus): string {
  if (status?.state === "upcoming") {
    return status.startTime
      ? `${creator.display_name} starts ${formatRelativeToNow(status.startTime)}`
      : `${creator.display_name} is upcoming`;
  }
  return `${creator.display_name} is offline`;
}

export default function PlayerCell({ creator, status, onRemove }: Props) {
  const twitchParent = useMemo(() => window.location.hostname || "localhost", []);

  const isLive = status?.state === "live" && status.embedId;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md bg-black">
      {isLive ? (
        <iframe
          key={`${creator.platform}:${status!.embedId}`}
          src={embedUrlFor(creator.platform, status!.embedId!, twitchParent)}
          className="h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
          {creator.avatar_url && (
            <img src={creator.avatar_url} alt="" className="h-10 w-10 rounded-full opacity-50" />
          )}
          <span className="text-xs">{placeholderText(creator, status)}</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
        <div className="flex items-center gap-1.5 truncate">
          <PlatformBadge platform={creator.platform} />
          <span className="truncate text-xs font-medium text-white drop-shadow">
            {creator.display_name}
          </span>
        </div>
        <button
          onClick={onRemove}
          className="pointer-events-auto rounded bg-black/50 px-1.5 py-0.5 text-xs text-white hover:bg-black/80"
          title="Remove from grid"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
