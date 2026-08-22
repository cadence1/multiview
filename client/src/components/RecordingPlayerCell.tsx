import { useEffect, useRef } from "react";
import type { Recording } from "../types.js";
import PlatformBadge from "./PlatformBadge.js";

interface Props {
  recording: Recording;
  /** Effective volume 0-100 — same master-volume scaling as a live
   * PlayerCell, just with no per-recording override to layer on top of it
   * (recordings don't have a saved volume preference the way creators do). */
  volume: number;
  onRemove: () => void;
}

/**
 * A saved recording playing back inside the multiview grid, alongside live
 * creator cells (see MultiviewGrid). Much simpler than PlayerCell — this is
 * just our own server's file behind a plain <video>, not a third-party
 * platform embed, so native browser controls (seek, play/pause, volume)
 * come for free instead of needing a platform-specific player API.
 */
export default function RecordingPlayerCell({ recording, volume, onRemove }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Mirrors PlayerCell's volume wiring, just directly against the <video>
  // element's own properties instead of a third-party player API.
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = Math.min(1, Math.max(0, volume / 100));
    videoRef.current.muted = volume <= 0;
  }, [volume]);

  // A still-recording entry has no reliably servable file yet (see
  // recorder.ts's module comment on why the in-progress filename can't be
  // predicted) — this mirrors the same "not ready to watch" boundary the
  // /saved page's own play button already respects.
  const canPlay = recording.status !== "recording";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md bg-black">
      {canPlay ? (
        <video
          ref={videoRef}
          src={`/api/recordings/${recording.id}/file`}
          controls
          autoPlay
          className="h-full w-full"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
          <span className="text-xs">Still recording — not ready to watch yet</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
        <div className="flex items-center gap-1.5 truncate">
          <PlatformBadge platform={recording.platform} />
          <span className="truncate text-xs font-medium text-white drop-shadow">
            {recording.display_name}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded bg-base-700/90 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
            title="Saved recording, not a live stream"
          >
            ▶ Saved
          </span>
        </div>
        <button
          onClick={onRemove}
          className="pointer-events-auto rounded bg-black/50 px-1.5 py-0.5 text-xs text-white hover:bg-black/80"
          title="Remove from grid"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
