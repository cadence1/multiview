import { useEffect, useState } from "react";
import { useStore } from "./store.js";
import Sidebar from "./components/Sidebar.js";
import ChatPanel from "./components/ChatPanel.js";
import MultiviewGrid from "./components/MultiviewGrid.js";
import AddCreatorDialog from "./components/AddCreatorDialog.js";

const STATUS_POLL_MS = 30_000;

export default function App() {
  const refreshCreators = useStore((s) => s.refreshCreators);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    refreshCreators().catch(() => {});
    refreshStatuses().catch(() => {});
    const id = setInterval(() => {
      refreshStatuses().catch(() => {});
    }, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refreshCreators, refreshStatuses]);

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
            {!chatOpen && (
              <button
                onClick={() => setChatOpen(true)}
                className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
              >
                Chat
              </button>
            )}
          </div>
        </header>
        <div className="flex-1 min-h-0">
          <MultiviewGrid />
        </div>
      </main>
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      {dialogOpen && <AddCreatorDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
