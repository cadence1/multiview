import { useRef, useState } from "react";
import { useStore } from "../store.js";

/**
 * Phase 6: bring in a video file the user already has — captured on a
 * different device, moved here manually, whatever it is — rather than
 * this app having captured or downloaded it itself. Same toggle-open shape
 * as DownloadVideoForm right next to it, just a file drop zone instead of
 * a URL field. Lives only on the /saved page, same reasoning as
 * DownloadVideoForm's own — not something the quick slide-out panel needs
 * too.
 */
export default function ImportRecordingForm() {
  const uploadRecording = useStore((s) => s.uploadRecording);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = progress !== null;

  function reset() {
    setFile(null);
    setTitle("");
    setProgress(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setProgress(0);
    setError(null);
    try {
      await uploadRecording(file, { title: title.trim() || undefined }, setProgress);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
      >
        + Import file
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <div
        onClick={() => !busy && fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const dropped = e.dataTransfer.files[0];
          if (dropped) setFile(dropped);
        }}
        className={`flex w-64 cursor-pointer items-center justify-center rounded-md border px-2 py-1 text-sm ${
          dragOver
            ? "border-indigo-500 bg-indigo-500/10 text-indigo-200"
            : "border-base-600 bg-base-900 text-slate-400 hover:bg-base-800"
        } ${busy ? "cursor-not-allowed opacity-50" : ""}`}
        title="Click to choose a file, or drag one here"
      >
        <span className="truncate">{file ? file.name : "Choose or drop a video file…"}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </div>
      {file && !busy && (
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-40 rounded-md border border-base-600 bg-base-900 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
        />
      )}
      <button
        type="submit"
        disabled={busy || !file}
        className="rounded-md bg-indigo-600 px-2 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? `${progress}%` : "Import"}
      </button>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(false);
        }}
        disabled={busy}
        className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-base-800 disabled:opacity-50"
      >
        Cancel
      </button>
      {error && (
        <span className="max-w-[16rem] truncate text-xs text-red-400" title={error}>
          {error}
        </span>
      )}
    </form>
  );
}
