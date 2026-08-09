import { useMemo } from "react";
import { useStore } from "../store.js";
import CreatorRow from "./CreatorRow.js";
import type { Creator, StreamState } from "../types.js";

interface Props {
  onAddCreator: () => void;
  onClose: () => void;
}

function groupOrder(state: StreamState): number {
  return state === "live" ? 0 : state === "upcoming" ? 1 : 2;
}

export default function Sidebar({ onAddCreator, onClose }: Props) {
  const creators = useStore((s) => s.creators);
  const statuses = useStore((s) => s.statuses);
  const gridIds = useStore((s) => s.gridIds);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const removeCreator = useStore((s) => s.removeCreator);

  const sorted = useMemo(() => {
    return [...creators].sort((a, b) => {
      const sa = statuses[a.id]?.state ?? "offline";
      const sb = statuses[b.id]?.state ?? "offline";
      const diff = groupOrder(sa) - groupOrder(sb);
      if (diff !== 0) return diff;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [creators, statuses]);

  const groups: { label: string; items: Creator[] }[] = [
    { label: "Live", items: sorted.filter((c) => (statuses[c.id]?.state ?? "offline") === "live") },
    { label: "Upcoming", items: sorted.filter((c) => (statuses[c.id]?.state ?? "offline") === "upcoming") },
    { label: "Offline", items: sorted.filter((c) => (statuses[c.id]?.state ?? "offline") === "offline") },
  ];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <span className="text-sm font-semibold text-slate-200">Creators</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onAddCreator}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            + Add
          </button>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-base-800"
            title="Hide sidebar"
          >
            ⟨
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {creators.length === 0 && (
          <p className="mt-4 px-2 text-xs text-slate-500">
            No creators yet. Click "+ Add" to track a YouTube, Twitch, or Kick channel.
          </p>
        )}

        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.label} className="mb-3">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {group.label} · {group.items.length}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((creator) => (
                    <CreatorRow
                      key={creator.id}
                      creator={creator}
                      status={statuses[creator.id]}
                      inGrid={gridIds.includes(creator.id)}
                      onToggleGrid={() => toggleGrid(creator.id)}
                      onRemove={() => removeCreator(creator.id)}
                    />
                  ))}
                </div>
              </div>
            )
        )}
      </div>
    </aside>
  );
}
