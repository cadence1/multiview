import { useState } from "react";
import { useStore } from "../store.js";
import type { Platform } from "../types.js";

const PLATFORMS: { value: Platform; label: string; hint: string }[] = [
  { value: "youtube", label: "YouTube", hint: "@handle, channel URL, or channel ID" },
  { value: "twitch", label: "Twitch", hint: "channel login or twitch.tv URL" },
  { value: "kick", label: "Kick", hint: "channel slug or kick.com URL" },
];

export default function AddCreatorDialog({ onClose }: { onClose: () => void }) {
  const addCreator = useStore((s) => s.addCreator);
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addCreator(platform, query.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-base-700 bg-base-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-100">Track a creator</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-1">
            {PLATFORMS.map((p) => (
              <button
                type="button"
                key={p.value}
                onClick={() => setPlatform(p.value)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${
                  platform === p.value
                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                    : "border-base-600 text-slate-400 hover:bg-base-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={PLATFORMS.find((p) => p.value === platform)?.hint}
              className="w-full rounded-md border border-base-600 bg-base-850 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-base-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !query.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
