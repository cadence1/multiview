import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import type { Recording, RecordingStatus } from "../types.js";
import { formatBytes, formatRelativeToNow } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";

// Shared between... nothing else right now, but factored out of the old
// slide-out RecordingsPanel specifically so the /saved page (SavedPage.tsx)
// could become the one real home for this instead of duplicating it — see
// Phase 3 in the DVR feature's plan.

const STORAGE_POLL_MS = 30_000;

export function StorageBar() {
  const storageStats = useStore((s) => s.storageStats);
  const refreshStorageStats = useStore((s) => s.refreshStorageStats);

  useEffect(() => {
    refreshStorageStats().catch(() => {});
    const id = setInterval(() => {
      refreshStorageStats().catch(() => {});
    }, STORAGE_POLL_MS);
    return () => clearInterval(id);
  }, [refreshStorageStats]);

  if (!storageStats) return null;
  const { totalBytes, usedBytes } = storageStats;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

  return (
    <div className="border-b border-base-700 px-3 py-2" title="Disk usage for the whole volume RECORDINGS_DIR lives on, not just Multiview's own recordings">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{formatBytes(usedBytes)} used of {formatBytes(totalBytes)}</span>
        <span>{formatBytes(storageStats.freeBytes)} free</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-800">
        <div
          className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-indigo-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<RecordingStatus, string> = {
  recording: "bg-red-600/80 text-white",
  completed: "bg-base-700 text-slate-300",
  stalled: "bg-amber-600/80 text-white",
  "low-disk": "bg-amber-600/80 text-white",
  failed: "bg-base-700 text-red-300",
};

const STATUS_LABEL: Record<RecordingStatus, string> = {
  recording: "Recording",
  completed: "Saved",
  stalled: "Stalled",
  "low-disk": "Low disk",
  failed: "Failed",
};

/**
 * Phase 4: tagging. Most tags a recording has are auto-seeded server-side
 * the moment it's created (creator/uploader name, recording date, video
 * date if known and different, bracketed segments from the title/name —
 * see the server's recordings/tags.ts) — this is just the display/edit
 * surface: click a tag to filter the list by it (onTagClick, threaded down
 * from SavedPage's filter bar — absent in the slide-out panel, which has
 * no filter to drive), an × on hover to remove one, and a small inline
 * "+ tag" control to add your own on top.
 */
function TagChips({ recording, onTagClick }: { recording: Recording; onTagClick?: (tag: string) => void }) {
  const addRecordingTag = useStore((s) => s.addRecordingTag);
  const removeRecordingTag = useStore((s) => s.removeRecordingTag);
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newTag.trim();
    setNewTag("");
    setAdding(false);
    if (!trimmed) return;
    addRecordingTag(recording.id, trimmed).catch(() => {}); // best-effort — not worth a whole error banner over
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {recording.tags.map((tag) => (
        <span
          key={tag}
          className="group inline-flex items-center gap-1 rounded-full bg-base-800 px-2 py-0.5 text-[10px] text-slate-300"
        >
          <button type="button" onClick={() => onTagClick?.(tag)} className="hover:text-indigo-300" title={`Filter by "${tag}"`}>
            {tag}
          </button>
          <button
            type="button"
            onClick={() => removeRecordingTag(recording.id, tag).catch(() => {})}
            className="text-slate-500 opacity-0 hover:text-red-400 group-hover:opacity-100"
            title="Remove tag"
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <form onSubmit={handleAdd} className="inline-flex">
          <input
            autoFocus
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onBlur={() => !newTag.trim() && setAdding(false)}
            placeholder="tag…"
            className="w-20 rounded-full border border-base-600 bg-base-900 px-2 py-0.5 text-[10px] text-slate-200 focus:border-indigo-500 focus:outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-full border border-dashed border-base-600 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-400 hover:text-slate-300"
        >
          + tag
        </button>
      )}
    </div>
  );
}

function RecordingRow({ recording, onTagClick }: { recording: Recording; onTagClick?: (tag: string) => void }) {
  const stopRecording = useStore((s) => s.stopRecording);
  const deleteRecording = useStore((s) => s.deleteRecording);
  const inGrid = useStore((s) => s.gridRecordingIds.includes(recording.id));
  const toggleGridRecording = useStore((s) => s.toggleGridRecording);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStop() {
    setBusy(true);
    setError(null);
    try {
      await stopRecording(recording.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete this recording of ${recording.display_name}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRecording(recording.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const canPlay = recording.status !== "recording";

  return (
    <div className="rounded-md border border-base-700 bg-base-850 p-2">
      <div className="flex gap-2">
        <button
          onClick={() => canPlay && setPlaying((p) => !p)}
          disabled={!canPlay}
          className="relative h-16 w-28 shrink-0 overflow-hidden rounded bg-base-800 disabled:cursor-default"
          title={canPlay ? (playing ? "Hide player" : "Play") : "Still recording"}
        >
          {recording.thumbnail_file_name ? (
            <img
              src={`/api/recordings/${recording.id}/thumbnail`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-600">—</div>
          )}
          {canPlay && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-lg text-white opacity-0 hover:opacity-100">
              {playing ? "⏹" : "▶"}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-100">{recording.display_name}</span>
            <PlatformBadge platform={recording.platform} />
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[recording.status]}`}>
              {STATUS_LABEL[recording.status]}
            </span>
            {recording.storage_location === "s3" && (
              <span className="shrink-0 text-[10px]" title="Offloaded to S3 — local copy removed">
                ☁️
              </span>
            )}
            {!recording.creator_id && (
              <span
                className="shrink-0 rounded bg-base-700 px-1.5 py-0.5 text-[10px] text-slate-300"
                title="Manually downloaded — not tied to a tracked creator"
              >
                📥 Downloaded
              </span>
            )}
          </div>
          {recording.title && <p className="truncate text-xs text-slate-400">{recording.title}</p>}
          <p className="text-[11px] text-slate-500">
            Started {formatRelativeToNow(recording.started_at)}
            {recording.file_size_bytes ? ` · ${formatBytes(recording.file_size_bytes)}` : ""}
          </p>
          {recording.error && recording.status !== "recording" && (
            <p className="truncate text-[11px] text-amber-400" title={recording.error}>
              {recording.error}
            </p>
          )}

          <TagChips recording={recording} onTagClick={onTagClick} />

          <div className="mt-1 flex items-center gap-2 text-[11px]">
            {recording.status === "recording" ? (
              <button
                onClick={handleStop}
                disabled={busy}
                className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                Stop
              </button>
            ) : (
              <>
                <button
                  onClick={() => toggleGridRecording(recording.id)}
                  className={inGrid ? "font-medium text-emerald-400 hover:text-emerald-300" : "text-indigo-300 hover:text-indigo-200"}
                  title={inGrid ? "Remove from the multiview grid" : "Add to the multiview grid, alongside live streams"}
                >
                  {inGrid ? "✓ In Multiview" : "Watch in Multiview"}
                </button>
                <a
                  href={`/api/recordings/${recording.id}/file`}
                  download
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  Download
                </a>
                <button onClick={handleDelete} disabled={busy} className="text-slate-500 hover:text-red-400 disabled:opacity-50">
                  Delete
                </button>
              </>
            )}
          </div>
          {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        </div>
      </div>

      {playing && canPlay && (
        <video
          src={`/api/recordings/${recording.id}/file`}
          controls
          autoPlay
          className="mt-2 max-h-64 w-full rounded bg-black"
        />
      )}
    </div>
  );
}

interface RecordingsListProps {
  /** Only recordings carrying this tag are shown — SavedPage's filter bar
   * drives this; the slide-out panel omits it and just shows everything,
   * it has no filter UI of its own. */
  filterTag?: string;
  /** Bubbled up from clicking a tag chip on any row, so the same click
   * either sets or (via SavedPage) is a no-op depending on whether the
   * caller actually wired up a filter bar. */
  onTagClick?: (tag: string) => void;
}

/** The actual recordings list — no outer chrome (header/close button) of
 * its own, so callers (SavedPage today; the old slide-out RecordingsPanel
 * before it) supply whatever page/panel frame makes sense for them. */
export default function RecordingsList({ filterTag, onTagClick }: RecordingsListProps) {
  const recordings = useStore((s) => s.recordings);
  const visible = filterTag ? recordings.filter((r) => r.tags.includes(filterTag)) : recordings;

  if (recordings.length === 0) {
    return (
      <p className="mt-4 px-2 text-xs text-slate-500">
        No recordings yet. Click ⏺ on a live creator in the sidebar to start one, or 📼 to always record them
        when live.
      </p>
    );
  }

  if (visible.length === 0) {
    return <p className="mt-4 px-2 text-xs text-slate-500">No recordings tagged "{filterTag}".</p>;
  }

  return (
    <div className="space-y-2">
      {visible.map((r) => (
        <RecordingRow key={r.id} recording={r} onTagClick={onTagClick} />
      ))}
    </div>
  );
}
