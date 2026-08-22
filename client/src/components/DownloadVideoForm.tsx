import { useState } from "react";
import { useStore } from "../store.js";

/**
 * Phase 5: manually download an arbitrary URL (any site yt-dlp itself
 * recognizes — not restricted to the app's own four live platforms) rather
 * than capturing a tracked creator's live stream. Lives only on the /saved
 * page — unlike the recordings list itself, this isn't something that
 * needs to be reachable from the quick slide-out panel too.
 */
export default function DownloadVideoForm() {
  const downloadVideo = useStore((s) => s.downloadVideo);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadVideo(url.trim());
      setUrl("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
      >
        + Download video
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a video URL…"
        autoFocus
        disabled={busy}
        className="w-64 rounded-md border border-base-600 bg-base-900 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={busy || !url.trim()}
        className="rounded-md bg-indigo-600 px-2 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Fetching…" : "Download"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
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
