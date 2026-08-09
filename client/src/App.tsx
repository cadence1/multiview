import { useEffect, useState } from "react";
import { useStore } from "./store.js";
import Sidebar from "./components/Sidebar.js";
import MultiviewGrid from "./components/MultiviewGrid.js";
import AddCreatorDialog from "./components/AddCreatorDialog.js";

const STATUS_POLL_MS = 30_000;

export default function App() {
  const refreshCreators = useStore((s) => s.refreshCreators);
  const refreshStatuses = useStore((s) => s.refreshStatuses);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
        <header className="flex items-center gap-3 border-b border-base-700 px-4 py-2">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md border border-base-600 px-2 py-1 text-sm text-slate-300 hover:bg-base-800"
            >
              Creators
            </button>
          )}
          <h1 className="text-sm font-semibold tracking-wide text-slate-300">
            Multiview
          </h1>
        </header>
        <div className="flex-1 min-h-0">
          <MultiviewGrid />
        </div>
      </main>
      {dialogOpen && <AddCreatorDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
