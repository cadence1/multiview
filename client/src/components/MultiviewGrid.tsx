import { useMemo } from "react";
import { useStore } from "../store.js";
import PlayerCell from "./PlayerCell.js";
import { computeGridDims, effectiveVolume, stableKey } from "../utils.js";

export default function MultiviewGrid() {
  const creators = useStore((s) => s.creators);
  const statuses = useStore((s) => s.statuses);
  const gridIds = useStore((s) => s.gridIds);
  const removeFromGrid = useStore((s) => s.removeFromGrid);
  const masterVolume = useStore((s) => s.masterVolume);
  const creatorVolumes = useStore((s) => s.creatorVolumes);
  const recordings = useStore((s) => s.recordings);

  const creatorById = useMemo(() => {
    const map = new Map(creators.map((c) => [c.id, c]));
    return map;
  }, [creators]);

  const recordingCreatorIds = useMemo(() => {
    return new Set(recordings.filter((r) => r.isActive).map((r) => r.creator_id));
  }, [recordings]);

  const gridCreators = gridIds
    .map((id) => creatorById.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const { cols, rows } = computeGridDims(gridCreators.length);

  if (gridCreators.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-slate-500">
          Nothing in your multiview yet. Click a live creator in the sidebar to add
          their stream here.
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
    </div>
  );
}
