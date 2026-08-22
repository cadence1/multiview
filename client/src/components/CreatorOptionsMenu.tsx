import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Creator, StreamState } from "../types.js";

const MENU_WIDTH = 224;

interface Props {
  anchorRect: DOMRect;
  onClose: () => void;
  creator: Creator;
  state: StreamState;
  autoAdd: boolean;
  onToggleAutoAdd: () => void;
  recordingSupported: boolean;
  isRecording: boolean;
  onToggleRecording: () => void;
  onToggleAutoRecord: () => void;
  onToggleRecordNext: () => void;
  onDelete: () => void;
}

/**
 * Per-creator settings, condensed behind one "⋮" trigger instead of a row
 * of separate always-competing-for-space icon buttons — same portal +
 * fixed-positioning approach as StreamPreview, but interactive (click
 * targets, outside-click-to-close) rather than a passive hover card. Room
 * to grow: new per-creator toggles/actions are additional rows here, not
 * additional buttons squeezed into the row itself.
 */
export default function CreatorOptionsMenu({
  anchorRect,
  onClose,
  creator,
  state,
  autoAdd,
  onToggleAutoAdd,
  recordingSupported,
  isRecording,
  onToggleRecording,
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

  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - 8);
  const left = Math.min(Math.max(8, anchorRect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);

  const canRecordNow = recordingSupported && (isRecording || state === "live");
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
    >
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
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-base-800"
        >
          <span aria-hidden>{isRecording ? "⏹" : "⏺"}</span>
          {isRecording ? "Stop recording" : "Record now"}
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
