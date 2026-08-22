import { useMemo } from "react";
import { useStore } from "../store.js";
import PlayerCell from "./PlayerCell.js";
import RecordingPlayerCell from "./RecordingPlayerCell.js";
import { computeGridDims, effectiveVolume, stableKey } from "../utils.js";

export default function MultiviewGrid() {
  const creators = useStore((s) => s.creators);
  const statuses = useStore((s) => s.statuses);
  const gridIds = useStore((s) => s.gridIds);
  const removeFromGrid = useStore((s) => s.removeFromGrid);
  const gridRecordingIds = useStore((s) => s.gridRecordingIds);
  const removeRecordingFromGrid = useStore((s) => s.removeRecordingFromGrid);
  const masterVolume = useStore((s) => s.masterVolume);
  const creatorVolumes = useStore((s) => s.creatorVolumes);
  const recordings = useStore((s) => s.recordings);

  const creatorById = useMemo(() => {
    const map = new Map(creators.map((c) => [c.id, c]));
    return map;
  }, [creators]);

  const recordingById = useMemo(() => {
    return new Map(recordings.map((r) => [r.id, r]));
  }, [recordings]);

  const recordingCreatorIds = useMemo(() => {
    return new Set(recordings.filter((r) => r.isActive).map((r) => r.creator_id));
  }, [recordings]);

  const gridCreators = gridIds
    .map((id) => creatorById.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  // Stale ids (a saved recording someone deleted from another tab/device)
  // just silently drop out here — same defensive filter gridCreators above
  // already relies on for a since-untracked creator.
  const gridRecordings = gridRecordingIds
    .map((id) => recordingById.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  const totalCells = gridCreators.length + gridRecordings.length;
  const { cols, rows } = computeGridDims(totalCells);

  if (totalCells === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-slate-500">
          Nothing in your multiview yet. Click a live creator in the sidebar, or a
          saved recording on the Recordings page, to add it here.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid h-full w-full gap-1 bg-base-950 p-1"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {gridCreators.map((creator) => (
        <PlayerCell
          key={creator.id}
          creator={creator}
          status={statuses[creator.id]}
          volume={effectiveVolume(masterVolume, creatorVolumes[stableKey(creator)])}
          onRemove={() => removeFromGrid(creator.id)}
          isRecording={recordingCreatorIds.has(creator.id)}
        />
      ))}
      {gridRecordings.map((recording) => (
        <RecordingPlayerCell
          key={recording.id}
          recording={recording}
          volume={effectiveVolume(masterVolume, undefined)}
          onRemove={() => removeRecordingFromGrid(recording.id)}
        />
      ))}
    </div>
  );
}
