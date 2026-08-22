import { Link } from "react-router-dom";
import RecordingsList, { StorageBar } from "./RecordingsList.js";

interface Props {
  onClose: () => void;
}

/**
 * Quick-access slide-out over the multiview view — for a glance at what's
 * recording/saved without leaving the grid. /saved (SavedPage.tsx) is the
 * real, deep-linkable, full-page home for the same underlying list
 * (RecordingsList, shared by both); this panel's "Full page ↗" link is the
 * way there. See "DVR Phase 3" for why the full page exists at all, and the
 * follow-up that brought this slide-out back alongside it.
 */
export default function RecordingsPanel({ onClose }: Props) {
  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <span className="text-sm font-semibold text-slate-200">Recordings</span>
        <div className="flex items-center gap-1">
          <Link
            to="/saved"
            className="rounded-md px-2 py-1 text-xs text-indigo-300 hover:bg-base-800 hover:text-indigo-200"
            title="Open the full Saved Recordings page"
          >
            Full page ↗
          </Link>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-base-800"
            title="Hide recordings"
          >
            ⟩
          </button>
        </div>
      </div>

      <StorageBar />

      <div className="flex-1 overflow-y-auto p-2">
        <RecordingsList compact />
      </div>
    </aside>
  );
}
