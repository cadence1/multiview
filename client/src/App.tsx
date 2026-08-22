import { useEffect, useState } from "react";
import { useStore } from "./store.js";
import Sidebar from "./components/Sidebar.js";
import ChatPanel from "./components/ChatPanel.js";
import MediaPanel from "./components/MediaPanel.js";
import RecordingsPanel from "./components/RecordingsPanel.js";
import MultiviewGrid from "./components/MultiviewGrid.js";
import AddCreatorDialog from "./components/AddCreatorDialog.js";

const STATUS_POLL_MS = 30_000;
const RECORDINGS_POLL_MS = 30_000;

export default function App() {
  const refreshCreators = useStore((s) => s.refreshCreators);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const refreshRecordings = useStore((s) => s.refreshRecordings);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);

  useEffect(() => {
    refreshCreators().catch(() => {});
    refreshStatuses().catch(() => {});
    refreshRecordings().catch(() => {});
    const statusId = setInterval(() => {
      refreshStatuses().catch(() => {});
    }, STATUS_POLL_MS);
    // Recording status changes far less often than live status and each
    // in-progress one shows elsewhere too (the sidebar badge) — a slightly
    // separate, still-simple interval rather than folding into the status
    // poll keeps that one's cadence free to change independently later.
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
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="grid grid-cols-3 items-center border-b border-base-700 px-4 py-2">
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
            onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
            className="justify-self-center text-sm font-semibold tracking-wide text-slate-300 hover:text-slate-100"
            title="Open Multiview in a new window"
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
