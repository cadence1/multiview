import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import type { Recording, RecordingStatus } from "../types.js";
import { formatBytes, formatRelativeToNow } from "../utils.js";
import PlatformBadge from "./PlatformBadge.js";

const STORAGE_POLL_MS = 30_000;

function StorageBar() {
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

interface Props {
  onClose: () => void;
}

const STATUS_STYLE: Record<RecordingStatus, string> = {
  recording: "bg-red-600/80 text-white",
  completed: "bg-base-700 text-slate-300",
  stalled: "bg-amber-600/80 text-white",
  failed: "bg-base-700 text-red-300",
};

const STATUS_LABEL: Record<RecordingStatus, string> = {
  recording: "Recording",
  completed: "Saved",
  stalled: "Stalled",
  failed: "Failed",
};

function RecordingRow({ recording }: { recording: Recording }) {
  const stopRecording = useStore((s) => s.stopRecording);
  const deleteRecording = useStore((s) => s.deleteRecording);
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

export default function RecordingsPanel({ onClose }: Props) {
  const recordings = useStore((s) => s.recordings);

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <span className="text-sm font-semibold text-slate-200">Recordings</span>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-base-800"
          title="Hide recordings"
        >
          ⟩
        </button>
      </div>

      <StorageBar />

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {recordings.length === 0 ? (
          <p className="mt-4 px-2 text-xs text-slate-500">
            No recordings yet. Click ⏺ on a live creator in the sidebar to start one, or 📼 to always record them
            when live.
          </p>
        ) : (
          recordings.map((r) => <RecordingRow key={r.id} recording={r} />)
        )}
      </div>
    </aside>
  );
}
