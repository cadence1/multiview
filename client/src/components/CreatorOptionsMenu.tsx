import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Creator, StreamState } from "../types.js";
import PlatformBadge from "./PlatformBadge.js";
import ToggleSwitch from "./ToggleSwitch.js";
import { homeUrlFor } from "../utils.js";

const MENU_WIDTH = 224;
// No measured-height pass (same tradeoff StreamPreview makes) — just a
// generous estimate to clamp against, since the item count here is small
// and fixed enough that it won't run away from this. Includes the name
// header below.
const MENU_HEIGHT_ESTIMATE = 264;

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  creator: Creator;
  state: StreamState;
  autoAdd: boolean;
  onToggleAutoAdd: () => void;
  recordingSupported: boolean;
  isRecording: boolean;
  onToggleRecording: () => void;
  onRecordFromStart: () => void;
  onToggleAutoRecord: () => void;
  onToggleRecordNext: () => void;
  onDelete: () => void;
}

/**
 * Per-creator settings, condensed behind one "⋮" trigger instead of a row
 * of separate always-competing-for-space icon buttons — same portal +
 * fixed-positioning approach as StreamPreview, opening as a flyout to the
 * right of the trigger. Opens/stays open on hover (of either the trigger or
 * this menu itself — CreatorRow owns the shared open/close-delay timer so
 * crossing the gap between them doesn't close it); mousedown outside or
 * Escape still closes it immediately for a definite dismiss. Room to grow:
 * new per-creator toggles/actions are additional rows here, not additional
 * buttons squeezed into the row itself.
 */
export default function CreatorOptionsMenu({
  anchorRect,
  onClose,
  onMouseEnter,
  onMouseLeave,
  creator,
  state,
  autoAdd,
  onToggleAutoAdd,
  recordingSupported,
  isRecording,
  onToggleRecording,
  onRecordFromStart,
  onToggleAutoRecord,
  onToggleRecordNext,
  onDelete,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Opens as a flyout to the right of the trigger (like StreamPreview does
  // for a row) rather than dropping down below it.
  const top = Math.min(Math.max(8, anchorRect.top), window.innerHeight - MENU_HEIGHT_ESTIMATE - 8);
  const left = Math.min(anchorRect.right + 6, window.innerWidth - MENU_WIDTH - 8);

  const canRecordNow = recordingSupported && (isRecording || state === "live");
  // Only offered before a recording actually starts — once one's running
  // there's nothing left to choose a start point for.
  const canRecordFromStart = recordingSupported && state === "live" && !isRecording;
  // Redundant once auto_record is on (that already covers the next session
  // too) — mirrors the same subsumption CreatorOptionsMenu's caller applies
  // server-side (PATCH /:id) when auto_record gets turned on.
  const canRecordUpcoming = recordingSupported && state === "upcoming" && !creator.auto_record;

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: "fixed", top, left, width: MENU_WIDTH, zIndex: 60 }}
      className="overflow-hidden rounded-lg border border-base-600 bg-base-900 py-1 shadow-xl"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {creator.avatar_url ? (
          <img src={creator.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="h-6 w-6 shrink-0 rounded-full bg-base-700" />
        )}
        <a
          href={homeUrlFor(creator)}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-xs font-semibold text-slate-100 hover:text-indigo-300 hover:underline"
          title={`Open ${creator.display_name}'s page`}
        >
          {creator.display_name}
        </a>
        <PlatformBadge platform={creator.platform} />
      </div>
      <div className="border-t border-base-700" />

      <button
        onClick={onToggleAutoAdd}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>📌</span> Pin to multiview
        </span>
        {autoAdd && <span className="text-indigo-400">On</span>}
      </button>

      {recordingSupported && (
        <button
          onClick={onToggleAutoRecord}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden>📼</span> Always record
          </span>
          {Boolean(creator.auto_record) && <span className="text-red-400">On</span>}
        </button>
      )}

      {canRecordNow && (
        <button
          onClick={onToggleRecording}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden>{isRecording ? "⏹" : "⏺"}</span>
            {isRecording ? "Recording" : "Record now"}
          </span>
          <ToggleSwitch on={isRecording} />
        </button>
      )}

      {canRecordFromStart && (
        <button
          onClick={onRecordFromStart}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
          title="Capture from the beginning instead of from now — works for a YouTube Premiere (the file already exists in full) and may work for an ordinary live stream depending on how much of it YouTube still has available"
        >
          <span aria-hidden>⏮</span> Record from start
        </button>
      )}

      {canRecordUpcoming && (
        <button
          onClick={onToggleRecordNext}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
        >
          <span className="flex items-center gap-2">
            <span aria-hidden>⏱</span> Record upcoming
          </span>
          {Boolean(creator.record_next) && <span className="text-red-400">Queued</span>}
        </button>
      )}

      <div className="my-1 border-t border-base-700" />

      <button
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
      >
        <span aria-hidden>🗑</span> Delete
      </button>
    </div>,
    document.body
  );
}
