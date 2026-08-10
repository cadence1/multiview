import { useMemo } from "react";
import { useStore } from "../store.js";
import CreatorRow from "./CreatorRow.js";
import type { Creator, CreatorStatus } from "../types.js";

interface Props {
  onAddCreator: () => void;
  onClose: () => void;
}

function byName(a: Creator, b: Creator): number {
  return a.display_name.localeCompare(b.display_name);
}

function startTimeMs(creator: Creator, statuses: Record<string, CreatorStatus>): number | null {
  const startTime = statuses[creator.id]?.startTime;
  return startTime ? new Date(startTime).getTime() : null;
}

/** Newest-live-first: largest (most recent) start time first, unknowns last. */
function byMostRecentlyLive(
  statuses: Record<string, CreatorStatus>
): (a: Creator, b: Creator) => number {
  return (a, b) => {
    const ta = startTimeMs(a, statuses);
    const tb = startTimeMs(b, statuses);
    if (ta === null && tb === null) return byName(a, b);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta || byName(a, b);
  };
}

/** Soonest-first: smallest (nearest) start time first, unknowns last. */
function bySoonestUpcoming(
  statuses: Record<string, CreatorStatus>
): (a: Creator, b: Creator) => number {
  return (a, b) => {
    const ta = startTimeMs(a, statuses);
    const tb = startTimeMs(b, statuses);
    if (ta === null && tb === null) return byName(a, b);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb || byName(a, b);
  };
}

export default function Sidebar({ onAddCreator, onClose }: Props) {
  const creators = useStore((s) => s.creators);
  const statuses = useStore((s) => s.statuses);
  const gridIds = useStore((s) => s.gridIds);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const removeCreator = useStore((s) => s.removeCreator);

  const groups: { label: string; items: Creator[] }[] = useMemo(() => {
    const stateOf = (c: Creator) => statuses[c.id]?.state ?? "offline";
    return [
      {
        label: "Live",
        items: creators.filter((c) => stateOf(c) === "live").sort(byMostRecentlyLive(statuses)),
      },
      {
        label: "Upcoming",
        items: creators.filter((c) => stateOf(c) === "upcoming").sort(bySoonestUpcoming(statuses)),
      },
      {
        label: "Offline",
        items: creators.filter((c) => stateOf(c) === "offline").sort(byName),
      },
    ];
  }, [creators, statuses]);

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
