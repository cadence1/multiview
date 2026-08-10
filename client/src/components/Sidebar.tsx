import { useMemo, useRef, useState } from "react";
import { useStore } from "../store.js";
import CreatorRow from "./CreatorRow.js";
import type { Creator, CreatorStatus, ExportFile } from "../types.js";

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
  const autoAddIds = useStore((s) => s.autoAddIds);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const toggleAutoAdd = useStore((s) => s.toggleAutoAdd);
  const removeCreator = useStore((s) => s.removeCreator);
  const importCreators = useStore((s) => s.importCreators);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function showNotice(message: string) {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 5000);
  }

  function handleExport() {
    const payload: ExportFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      creators: creators.map((c) => ({
        platform: c.platform,
        platform_id: c.platform_id,
        handle: c.handle,
        display_name: c.display_name,
        avatar_url: c.avatar_url,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `multiview-creators-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file again later
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed?.creators;
      if (!Array.isArray(list)) {
        showNotice("That file doesn't look like a Multiview export.");
        return;
      }
      const result = await importCreators(list);
      const parts = [`Imported ${result.imported}`];
      if (result.skipped) {
        parts.push(`skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}`);
      }
      if (result.errors.length) {
        parts.push(`${result.errors.length} invalid`);
      }
      showNotice(parts.join(", "));
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Import failed");
    }
  }

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
      <div className="border-b border-base-700 px-3 py-2">
        <div className="flex items-center justify-between">
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

        <div className="mt-1.5 flex items-center gap-1">
          <button
            onClick={handleExport}
            disabled={creators.length === 0}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-base-800 hover:text-slate-200 disabled:pointer-events-none disabled:opacity-40"
            title="Download tracked creators as a JSON file"
          >
            Export
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-base-800 hover:text-slate-200"
            title="Import creators from a JSON file"
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {notice && <p className="mt-1.5 text-[11px] text-slate-400">{notice}</p>}
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
                      autoAdd={autoAddIds.includes(creator.id)}
                      onToggleGrid={() => toggleGrid(creator.id)}
                      onToggleAutoAdd={() => toggleAutoAdd(creator.id)}
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
