import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store.js";
import type { Creator } from "../types.js";
import { chatUrlFor, computeGridDims, homeUrlFor, PLATFORM_LABEL } from "../utils.js";

interface Props {
  onClose: () => void;
}

export default function ChatPanel({ onClose }: Props) {
  const creators = useStore((s) => s.creators);
  const gridIds = useStore((s) => s.gridIds);
  const statuses = useStore((s) => s.statuses);

  const onScreen = useMemo(
    () => gridIds.map((id) => creators.find((c) => c.id === id)).filter((c): c is Creator => Boolean(c)),
    [gridIds, creators]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep the selection valid as the grid changes — default to the first
  // on-screen creator, and drop the selection if it leaves the grid.
  useEffect(() => {
    if (selectedId && onScreen.some((c) => c.id === selectedId)) return;
    setSelectedId(onScreen[0]?.id ?? null);
  }, [onScreen, selectedId]);

  const selected = onScreen.find((c) => c.id === selectedId);
  const hostname = window.location.hostname || "localhost";
  const chatUrl = selected ? chatUrlFor(selected, statuses[selected.id], hostname) : null;

  // onScreen is in the same order MultiviewGrid renders cells in, so using
  // the same column count and row-major order makes each tab's column
  // position match its video's column position. Rows are a small fixed
  // height (not 1fr) so the selector stays compact and scrolls instead of
  // eating space the chat iframe itself needs.
  const { cols } = computeGridDims(onScreen.length);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <span className="text-sm font-semibold text-slate-200">Chat</span>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-base-800"
          title="Hide chat"
        >
          ⟩
        </button>
      </div>

      {onScreen.length === 0 ? (
        <p className="mt-4 px-3 text-xs text-slate-500">
          Nothing in your multiview yet — add a creator to the grid to open their chat.
        </p>
      ) : (
        <>
          <div
            className="grid max-h-24 shrink-0 gap-0.5 overflow-y-auto border-b border-base-700 p-1.5"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridAutoRows: "22px",
            }}
          >
            {onScreen.map((creator) => (
              <button
                key={creator.id}
                onClick={() => setSelectedId(creator.id)}
                title={creator.display_name}
                className={`flex min-w-0 items-center justify-center gap-1 rounded px-1 text-[10px] font-medium ${
                  selectedId === creator.id
                    ? "bg-indigo-600 text-white"
                    : "bg-base-800 text-slate-300 hover:bg-base-700"
                }`}
              >
                {creator.avatar_url ? (
                  <img src={creator.avatar_url} alt="" className="h-3.5 w-3.5 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-base-700" />
                )}
                <span className="min-w-0 truncate">{creator.display_name}</span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {!selected ? null : chatUrl ? (
              <iframe
                key={chatUrl}
                src={chatUrl}
                className="h-full w-full border-0"
                title={`${selected.display_name} chat`}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-slate-500">
                {selected.platform === "kick" ? (
                  <p>Kick has no embeddable chat widget.</p>
                ) : selected.platform === "rplay" ? (
                  <p>RPlay's chat is already shown inside its grid cell.</p>
                ) : (
                  <p>{selected.display_name}'s chat needs them to be live.</p>
                )}
                <a
                  href={homeUrlFor(selected)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-300 hover:text-indigo-200"
                >
                  Open on {PLATFORM_LABEL[selected.platform]} instead
                </a>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
