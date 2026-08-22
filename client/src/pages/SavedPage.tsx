import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store.js";
import RecordingsList, { StorageBar } from "../components/RecordingsList.js";
import DownloadVideoForm from "../components/DownloadVideoForm.js";

const RECORDINGS_POLL_MS = 30_000;

/**
 * The dedicated recordings browser — Phase 3 of the DVR feature's plan.
 * Previously this content only existed as a slide-out panel over the
 * multiview view (RecordingsPanel, now retired); this is its real,
 * deep-linkable home, and the base a future tagging UI (Phase 4) layers
 * onto. A plain top-level route rather than something nested under the
 * multiview page — recordings browsing has nothing to do with the live
 * grid/sidebar, so there's no reason to drag that chrome along here.
 */
export default function SavedPage() {
  const refreshRecordings = useStore((s) => s.refreshRecordings);

  useEffect(() => {
    refreshRecordings().catch(() => {});
    const id = setInterval(() => {
      refreshRecordings().catch(() => {});
    }, RECORDINGS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshRecordings]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base-950">
      <header className="grid grid-cols-3 items-center border-b border-base-700 px-4 py-2">
        <Link
          to="/"
          className="justify-self-start rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
        >
          ← Multiview
        </Link>
        <span className="justify-self-center text-sm font-semibold tracking-wide text-slate-300">
          Saved Recordings
        </span>
        <div className="justify-self-end">
          <DownloadVideoForm />
        </div>
      </header>

      <StorageBar />

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        <RecordingsList />
      </div>
    </div>
  );
}
