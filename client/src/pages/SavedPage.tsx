import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store.js";
import RecordingsList, { StorageBar } from "../components/RecordingsList.js";
import DownloadVideoForm from "../components/DownloadVideoForm.js";
import ImportRecordingForm from "../components/ImportRecordingForm.js";

const RECORDINGS_POLL_MS = 30_000;

/**
 * The dedicated recordings browser — Phase 3 of the DVR feature's plan.
 * Previously this content only existed as a slide-out panel over the
 * multiview view (RecordingsPanel, now retired); this is its real,
 * deep-linkable home, and the base the Phase 4 tagging UI (the filter bar
 * below) layers onto. A plain top-level route rather than something nested
 * under the multiview page — recordings browsing has nothing to do with
 * the live grid/sidebar, so there's no reason to drag that chrome along
 * here.
 */
export default function SavedPage() {
  const refreshRecordings = useStore((s) => s.refreshRecordings);
  const recordings = useStore((s) => s.recordings);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    refreshRecordings().catch(() => {});
    const id = setInterval(() => {
      refreshRecordings().catch(() => {});
    }, RECORDINGS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshRecordings]);

  // Every distinct tag across every recording, alphabetical — most of these
  // came from auto-tagging (creator name, dates, bracketed segments; see
  // the server's recordings/tags.ts), not something the user necessarily
  // typed themselves, so this doubles as a quick overview of what's there.
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of recordings) for (const t of r.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [recordings]);

  function handleTagClick(tag: string) {
    setFilterTag((current) => (current === tag ? null : tag));
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base-950">
      <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-base-700 px-4 py-2">
        <Link
          to="/"
          className="justify-self-start rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
        >
          ← Multiview
        </Link>
        <span className="justify-self-center text-sm font-semibold tracking-wide text-slate-300">
          Saved Recordings
        </span>
        <div className="flex items-center justify-self-end gap-1.5">
          <ImportRecordingForm />
          <DownloadVideoForm />
        </div>
      </header>

      <StorageBar />

      <div className="mx-auto w-full max-w-3xl px-4 pt-3">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search titles and tags…"
            className="w-full rounded-md border border-base-600 bg-base-900 py-1.5 pl-3 pr-8 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 px-4 pt-3">
          <span className="text-[11px] text-slate-500">Filter:</span>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                filterTag === tag
                  ? "bg-indigo-600 text-white"
                  : "bg-base-800 text-slate-300 hover:bg-base-700"
              }`}
            >
              {tag}
            </button>
          ))}
          {filterTag && (
            <button
              onClick={() => setFilterTag(null)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4">
        <RecordingsList filterTag={filterTag ?? undefined} onTagClick={handleTagClick} searchQuery={searchQuery} />
      </div>
    </div>
  );
}
