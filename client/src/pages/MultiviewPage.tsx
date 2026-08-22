import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import Sidebar from "../components/Sidebar.js";
import ChatPanel from "../components/ChatPanel.js";
import MediaPanel from "../components/MediaPanel.js";
import RecordingsPanel from "../components/RecordingsPanel.js";
import MultiviewGrid from "../components/MultiviewGrid.js";
import AddCreatorDialog from "../components/AddCreatorDialog.js";

const STATUS_POLL_MS = 30_000;
const RECORDINGS_POLL_MS = 30_000;

export default function MultiviewPage() {
  const refreshCreators = useStore((s) => s.refreshCreators);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const refreshRecordings = useStore((s) => s.refreshRecordings);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  // Focus mode: hide everything but the grid. A real state change on
  // entry (actually closing the sidebar/panels), not just a render-time
  // visibility override — that way the header's own buttons keep working
  // completely normally on the rare peek back at it (see headerHovered
  // below), rather than needing a separate "focus mode header" concept.
  const [focusMode, setFocusMode] = useState(false);
  // Only matters while focusMode is on — the header is otherwise always
  // visible. True while the mouse is over either the always-present
  // trigger strip at the very top of the window or the header itself
  // (once revealed), so crossing the gap between them doesn't hide it
  // mid-crossing — same reasoning as the creator options menu's hover
  // handling.
  const [headerHovered, setHeaderHovered] = useState(false);

  function toggleFocusMode() {
    setFocusMode((current) => {
      const next = !current;
      if (next) {
        setSidebarOpen(false);
        setMediaOpen(false);
        setChatOpen(false);
        setRecordingsOpen(false);
        setHeaderHovered(false);
      }
      return next;
    });
  }

  const headerVisible = !focusMode || headerHovered;

  useEffect(() => {
    refreshCreators().catch(() => {});
    refreshStatuses().catch(() => {});
    refreshRecordings().catch(() => {});
    const statusId = setInterval(() => {
      refreshStatuses().catch(() => {});
    }, STATUS_POLL_MS);
    // Recording status changes far less often than live status, and is
    // needed here too (not just on /saved) for the sidebar's own
    // recording indicators/controls — a slightly separate, still-simple
    // interval rather than folding into the status poll keeps that one's
    // cadence free to change independently later.
    const recordingsId = setInterval(() => {
      refreshRecordings().catch(() => {});
    }, RECORDINGS_POLL_MS);
    return () => {
      clearInterval(statusId);
      clearInterval(recordingsId);
    };
  }, [refreshCreators, refreshStatuses, refreshRecordings]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-950">
      {sidebarOpen && (
        <Sidebar
          onAddCreator={() => setDialogOpen(true)}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <main className="relative flex-1 min-w-0 flex flex-col">
        {focusMode && (
          // Always-present, invisible — the header's own hover handlers
          // alone aren't enough to bring it back once it's translated
          // fully out of view, so this thin strip at the very top edge is
          // the actual reveal trigger regardless of the header's own
          // current position.
          <div
            className="fixed inset-x-0 top-0 z-40 h-2"
            onMouseEnter={() => setHeaderHovered(true)}
          />
        )}
        <header
          onMouseEnter={() => focusMode && setHeaderHovered(true)}
          onMouseLeave={() => focusMode && setHeaderHovered(false)}
          className={`grid grid-cols-3 items-center border-b border-base-700 bg-base-950 px-4 py-2 ${
            focusMode
              ? `fixed inset-x-0 top-0 z-30 transition-transform duration-200 ${
                  headerVisible ? "translate-y-0" : "-translate-y-full"
                }`
              : ""
          }`}
        >
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
              >
                Creators
              </button>
            )}
          </div>

          <button
            onClick={toggleFocusMode}
            className="justify-self-center text-sm font-semibold tracking-wide text-slate-300 hover:text-slate-100"
            title={
              focusMode
                ? "Exit focus mode"
                : "Hide everything but the grid — hover the top edge of the window to bring this bar back"
            }
          >
            Multiview
          </button>

          <div className="flex items-center justify-end gap-2">
            {!mediaOpen && (
              <button
                onClick={() => setMediaOpen(true)}
                className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
              >
                Media
              </button>
            )}
            {!chatOpen && (
              <button
                onClick={() => setChatOpen(true)}
                className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
              >
                Chat
              </button>
            )}
            {!recordingsOpen && (
              <button
                onClick={() => setRecordingsOpen(true)}
                className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
              >
                Recordings
              </button>
            )}
          </div>
        </header>
        <div className="flex-1 min-h-0">
          <MultiviewGrid />
        </div>
      </main>
      {mediaOpen && <MediaPanel onClose={() => setMediaOpen(false)} />}
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      {recordingsOpen && <RecordingsPanel onClose={() => setRecordingsOpen(false)} />}
      {dialogOpen && <AddCreatorDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
