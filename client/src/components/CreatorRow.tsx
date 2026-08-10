import { useRef, useState } from "react";
import type { Creator, CreatorStatus } from "../types.js";
import { formatElapsed, formatRelativeToNow, homeUrlFor } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";
import UpcomingPreview from "./UpcomingPreview.js";

interface Props {
  creator: Creator;
  status?: CreatorStatus;
  inGrid: boolean;
  autoAdd: boolean;
  onToggleGrid: () => void;
  onToggleAutoAdd: () => void;
  onRemove: () => void;
}

export default function CreatorRow({
  creator,
  status,
  inGrid,
  autoAdd,
  onToggleGrid,
  onToggleAutoAdd,
  onRemove,
}: Props) {
  const state = status?.state ?? "offline";
  // Untracking is destructive (deletes the creator server-side), so the
  // actual ✕ only appears after this toggle is clicked — a stray hover-click
  // can't remove a creator by accident. Resets on mouse-leave so it doesn't
  // stay armed.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Upcoming creators can be toggled into the grid too (as a placeholder
  // that starts playing automatically once they go live) — PlayerCell only
  // renders an actual embed once status flips to "live".
  const canAddToGrid = state === "live" || state === "upcoming";

  const rowRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const showPreview = hovering && state === "upcoming";

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
      ref={rowRef}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
        inGrid ? "bg-indigo-500/20 ring-1 ring-indigo-400/40" : "hover:bg-base-800"
      }`}
      onClick={handleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setConfirmingRemove(false);
        setHovering(false);
      }}
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
          {state === "live" &&
            (status?.startTime ? `Live for ${formatElapsed(status.startTime)}` : status?.title || "Live now")}
          {state === "upcoming" && (
            <>
              {status?.title || "Upcoming"}
              {status?.startTime && ` · ${formatRelativeToNow(status.startTime).replace(/^in /, "")}`}
            </>
          )}
          {state === "offline" && "Offline"}
        </div>
      </div>

      {showPreview && rowRef.current && (
        <UpcomingPreview creator={creator} status={status} anchorRect={rowRef.current.getBoundingClientRect()} />
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleAutoAdd();
        }}
        className={`shrink-0 rounded px-1.5 py-0.5 text-xs transition-opacity ${
          autoAdd
            ? "text-indigo-400 opacity-100 hover:bg-base-700 hover:text-indigo-300"
            : "text-slate-500 opacity-0 hover:bg-base-700 hover:text-slate-200 group-hover:opacity-100"
        }`}
        title={
          autoAdd
            ? "Always opens when live, closes when it ends (click to unpin)"
            : "Always open in multiview when live, close when it ends"
        }
      >
        📌
      </button>

      {confirmingRemove ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-300 hover:bg-red-500/40 hover:text-red-100"
          title="Confirm: stop tracking"
        >
          ✕
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmingRemove(true);
          }}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 opacity-0 hover:bg-base-700 hover:text-slate-200 group-hover:opacity-100"
          title="Stop tracking"
        >
          🗑
        </button>
      )}
    </div>
  );
}
