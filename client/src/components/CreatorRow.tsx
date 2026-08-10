import type { Creator, CreatorStatus } from "../types.js";
import { formatRelativeToNow, homeUrlFor } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";

interface Props {
  creator: Creator;
  status?: CreatorStatus;
  inGrid: boolean;
  onToggleGrid: () => void;
  onRemove: () => void;
}

export default function CreatorRow({ creator, status, inGrid, onToggleGrid, onRemove }: Props) {
  const state = status?.state ?? "offline";
  // Upcoming creators can be toggled into the grid too (as a placeholder
  // that starts playing automatically once they go live) — PlayerCell only
  // renders an actual embed once status flips to "live".
  const canAddToGrid = state === "live" || state === "upcoming";

  function handleClick() {
    if (canAddToGrid) {
      onToggleGrid();
    } else {
      // Offline — nothing to add to the grid, so go to the creator's page instead.
      window.open(homeUrlFor(creator), "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
        inGrid ? "bg-indigo-500/20 ring-1 ring-indigo-400/40" : "hover:bg-base-800"
      }`}
      onClick={handleClick}
      title={canAddToGrid ? "Toggle in multiview" : "Open channel page"}
    >
      <div className="relative shrink-0">
        {creator.avatar_url ? (
          <img
            src={creator.avatar_url}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-base-700" />
        )}
        {state === "live" && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-base-900" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-slate-100">
            {creator.display_name}
          </span>
          <PlatformBadge platform={creator.platform} />
        </div>
        <div className="truncate text-xs text-slate-400">
          {state === "live" && (status?.title || "Live now")}
          {state === "upcoming" &&
            `Upcoming ${status?.startTime ? formatRelativeToNow(status.startTime) : ""}`}
          {state === "offline" && "Offline"}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 opacity-0 hover:bg-base-700 hover:text-slate-200 group-hover:opacity-100"
        title="Stop tracking"
      >
        ✕
      </button>
    </div>
  );
}
