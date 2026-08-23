import { useEffect, useRef, useState } from "react";
import type { Creator, CreatorStatus } from "../types.js";
import { formatElapsed, formatRelativeToNow, homeUrlFor } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";
import StreamPreview from "./StreamPreview.js";
import CreatorOptionsMenu from "./CreatorOptionsMenu.js";

interface Props {
  creator: Creator;
  status?: CreatorStatus;
  inGrid: boolean;
  autoAdd: boolean;
  onToggleGrid: () => void;
  onToggleAutoAdd: () => void;
  /** Bulk-delete selection mode (toggled from the sidebar header) — replaces the old per-row trash button. */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** RPlay isn't supported — recording controls are hidden entirely for it, not just disabled. */
  recordingSupported: boolean;
  isRecording: boolean;
  onToggleRecording: () => void;
  onRecordFromStart: () => void;
  onToggleAutoRecord: () => void;
  onToggleRecordNext: () => void;
  onDelete: () => void;
}

export default function CreatorRow({
  creator,
  status,
  inGrid,
  autoAdd,
  onToggleGrid,
  onToggleAutoAdd,
  selecting,
  selected,
  onToggleSelect,
  recordingSupported,
  isRecording,
  onToggleRecording,
  onRecordFromStart,
  onToggleAutoRecord,
  onToggleRecordNext,
  onDelete,
}: Props) {
  const state = status?.state ?? "offline";
  // Upcoming creators can be toggled into the grid too (as a placeholder
  // that starts playing automatically once they go live) — PlayerCell only
  // renders an actual embed once status flips to "live".
  const canAddToGrid = state === "live" || state === "upcoming";

  const rowRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [hovering, setHovering] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showPreview = hovering && !selecting && !menuOpen && (state === "upcoming" || state === "live");
  const hasActiveOptions =
    autoAdd || Boolean(creator.auto_record) || Boolean(creator.record_next) || isRecording;

  // Menu opens on hover of the ⋮ trigger rather than a click — a click that
  // both opens *and* has to be clicked again to close felt fiddly. A short
  // close delay (instead of closing the instant the pointer leaves the
  // trigger) gives it room to travel the gap into the flyout itself, which
  // reports back through the same open/schedule-close pair on its own
  // hover so it doesn't vanish out from under the pointer.
  const menuCloseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openMenu() {
    if (menuCloseTimeout.current) {
      clearTimeout(menuCloseTimeout.current);
      menuCloseTimeout.current = null;
    }
    setMenuOpen(true);
  }

  function scheduleMenuClose() {
    if (menuCloseTimeout.current) clearTimeout(menuCloseTimeout.current);
    menuCloseTimeout.current = setTimeout(() => {
      setMenuOpen(false);
      menuCloseTimeout.current = null;
    }, 200);
  }

  useEffect(() => {
    return () => {
      if (menuCloseTimeout.current) clearTimeout(menuCloseTimeout.current);
    };
  }, []);

  function handleClick() {
    if (selecting) {
      onToggleSelect();
      return;
    }
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
        selected
          ? "bg-red-500/20 ring-1 ring-red-400/40"
          : inGrid
            ? "bg-indigo-500/20 ring-1 ring-indigo-400/40"
            : "hover:bg-base-800"
      }`}
      onClick={handleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      title={selecting ? "Select for deletion" : canAddToGrid ? "Toggle in multiview" : "Open channel page"}
    >
      {selecting && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 shrink-0 accent-red-500"
        />
      )}

      <div className="relative shrink-0">
        {creator.avatar_url ? (
          <img
            src={creator.avatar_url}
            alt=""
            className={`h-8 w-8 rounded-full object-cover ${isRecording ? "ring-2 ring-red-500" : ""}`}
          />
        ) : (
          <div className={`h-8 w-8 rounded-full bg-base-700 ${isRecording ? "ring-2 ring-red-500" : ""}`} />
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
          {autoAdd && (
            <span className="shrink-0 text-[10px]" title="Pinned — always opens in multiview when live">
              📌
            </span>
          )}
          {isRecording && (
            <span className="shrink-0 text-[10px] text-red-400" title="Currently recording">
              ⏺
            </span>
          )}
          {!isRecording && Boolean(creator.record_next) && (
            <span className="shrink-0 text-[10px] text-red-400" title="Queued to record when live">
              ⏱
            </span>
          )}
          <PlatformBadge platform={creator.platform} />
        </div>
        <div className="truncate text-xs text-slate-400">
          {state === "live" &&
            (status?.startTime ? `Live for ${formatElapsed(status.startTime)}` : status?.title || "Live now")}
          {state === "upcoming" && (
            <>
              {status?.startTime && (
                <span className="text-indigo-300">
                  {formatRelativeToNow(status.startTime).replace(/^in /, "")}
                </span>
              )}
              {status?.startTime && " · "}
              {status?.title || "Upcoming"}
            </>
          )}
          {state === "offline" && "Offline"}
        </div>
      </div>

      {showPreview && rowRef.current && (
        <StreamPreview creator={creator} status={status} anchorRect={rowRef.current.getBoundingClientRect()} />
      )}

      {!selecting && (
        <button
          ref={menuButtonRef}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleMenuClose}
          onClick={(e) => e.stopPropagation()}
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs transition-opacity ${
            hasActiveOptions || menuOpen
              ? "bg-base-700 text-slate-200 opacity-100"
              : "text-slate-500 opacity-0 hover:bg-base-700 hover:text-slate-200 group-hover:opacity-100"
          }`}
          title="Options"
        >
          ⋮
        </button>
      )}

      {menuOpen && menuButtonRef.current && (
        <CreatorOptionsMenu
          anchorRect={menuButtonRef.current.getBoundingClientRect()}
          onClose={() => setMenuOpen(false)}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleMenuClose}
          creator={creator}
          state={state}
          autoAdd={autoAdd}
          onToggleAutoAdd={onToggleAutoAdd}
          recordingSupported={recordingSupported}
          isRecording={isRecording}
          onToggleRecording={onToggleRecording}
          onRecordFromStart={onRecordFromStart}
          onToggleAutoRecord={onToggleAutoRecord}
          onToggleRecordNext={onToggleRecordNext}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}
