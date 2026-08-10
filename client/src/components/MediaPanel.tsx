import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store.js";
import type { Creator } from "../types.js";
import { effectiveVolume, boostGainFor, stableKey } from "../utils.js";
import { isTabAudioBoostSupported, startTabAudioBoost, type TabAudioBoost } from "../lib/tabAudioBoost.js";

interface Props {
  onClose: () => void;
}

type BoostState = "idle" | "starting" | "active" | "error";

export default function MediaPanel({ onClose }: Props) {
  const creators = useStore((s) => s.creators);
  const gridIds = useStore((s) => s.gridIds);
  const masterVolume = useStore((s) => s.masterVolume);
  const creatorVolumes = useStore((s) => s.creatorVolumes);
  const setMasterVolume = useStore((s) => s.setMasterVolume);
  const setCreatorVolume = useStore((s) => s.setCreatorVolume);

  const onScreen = useMemo(
    () => gridIds.map((id) => creators.find((c) => c.id === id)).filter((c): c is Creator => Boolean(c)),
    [gridIds, creators]
  );

  const boostRef = useRef<TabAudioBoost | null>(null);
  const [boostState, setBoostState] = useState<BoostState>("idle");
  const [boostError, setBoostError] = useState<string | null>(null);
  const boostSupported = useMemo(() => isTabAudioBoostSupported(), []);

  // Boost requires a fresh permission grant every page load — it can't
  // persist across reloads. If the slider was left above 100% from a
  // previous session, pull it back to 100 on mount so the shown number
  // matches what's actually happening (boost off = no gain applied).
  useEffect(() => {
    if (masterVolume > 100) setMasterVolume(100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the capture when the panel unmounts (e.g. hiding Media), not
  // just when the user clicks Stop — otherwise the tab keeps being captured
  // (and the browser's "sharing" indicator stays up) after the controls are
  // gone.
  useEffect(() => {
    return () => {
      boostRef.current?.stop();
      boostRef.current = null;
    };
  }, []);

  // Keep the live gain in sync with the slider while boost is active.
  useEffect(() => {
    if (boostState === "active" && boostRef.current) {
      boostRef.current.setGain(boostGainFor(masterVolume));
    }
  }, [masterVolume, boostState]);

  async function handleEnableBoost() {
    setBoostState("starting");
    setBoostError(null);
    try {
      const boost = await startTabAudioBoost(() => {
        // Fired if the user stops sharing via the browser's own control.
        boostRef.current = null;
        setBoostState("idle");
        setMasterVolume(Math.min(masterVolume, 100));
      });
      boost.setGain(boostGainFor(masterVolume));
      boostRef.current = boost;
      setBoostState("active");
    } catch (err) {
      setBoostState("error");
      setBoostError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Permission denied — pick \"This Tab\" and allow sharing to enable boost."
          : err instanceof Error
            ? err.message
            : "Couldn't enable boost."
      );
    }
  }

  function handleStopBoost() {
    boostRef.current?.stop();
    boostRef.current = null;
    setBoostState("idle");
    if (masterVolume > 100) setMasterVolume(100);
  }

  const boosting = boostState === "active";

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-base-700 bg-base-900">
      <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
        <span className="text-sm font-semibold text-slate-200">Media</span>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-base-800"
          title="Hide media controls"
        >
          ⟩
        </button>
      </div>

      <div className="border-b border-base-700 px-3 py-3">
        <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-300">
          <span>Main volume</span>
          <span className={masterVolume > 100 ? "text-amber-400" : "text-slate-500"}>{masterVolume}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={boosting ? 200 : 100}
          value={masterVolume}
          onChange={(e) => setMasterVolume(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
        <p className="mt-1 text-[10px] text-slate-500">Scales every window below.</p>

        <div className="mt-2">
          {boostState === "active" ? (
            <div className="space-y-1">
              <p className="text-[10px] text-amber-400">
                🔊 Boost active — this tab's audio is being captured to allow past 100%.
              </p>
              <button
                onClick={handleStopBoost}
                className="w-full rounded-md bg-base-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-base-700"
              >
                Stop boost
              </button>
            </div>
          ) : boostSupported ? (
            <>
              <button
                onClick={handleEnableBoost}
                disabled={boostState === "starting"}
                className="w-full rounded-md bg-base-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-base-700 disabled:opacity-50"
              >
                {boostState === "starting" ? "Waiting for permission…" : "Enable boost (up to 200%)"}
              </button>
              <p className="mt-1 text-[10px] text-slate-500">
                Prompts for a one-time "share this tab" permission — required to boost past
                what YouTube/Twitch's own players allow.
              </p>
              {boostError && <p className="mt-1 text-[10px] text-red-400">{boostError}</p>}
            </>
          ) : (
            <p className="text-[10px] text-slate-500">
              Boost past 100% isn't supported in this browser — try Chrome or Edge.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {onScreen.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Nothing in your multiview yet — add a creator to the grid to control its volume.
          </p>
        ) : (
          <div className="space-y-3">
            {onScreen.map((creator) => {
              const saved = creatorVolumes[stableKey(creator)] ?? 100;
              const eff = effectiveVolume(masterVolume, saved);
              return (
                <div key={creator.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {creator.avatar_url ? (
                        <img
                          src={creator.avatar_url}
                          alt=""
                          className="h-4 w-4 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-base-700" />
                      )}
                      <span className="truncate text-xs font-medium text-slate-200">
                        {creator.display_name}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500" title="Effective volume (main × this creator's saved volume)">
                      {eff}%
                    </span>
                  </div>

                  {creator.platform === "kick" ? (
                    <button
                      onClick={() => setCreatorVolume(creator, saved > 0 ? 0 : 100)}
                      className={`w-full rounded-md px-2 py-1 text-[11px] font-medium ${
                        saved > 0
                          ? "bg-base-800 text-slate-300 hover:bg-base-700"
                          : "bg-red-600/70 text-white hover:bg-red-500"
                      }`}
                      title="Kick has no live volume API — mute/unmute only"
                    >
                      {saved > 0 ? "Unmuted" : "Muted"} (Kick: mute only)
                    </button>
                  ) : (
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={saved}
                      onChange={(e) => setCreatorVolume(creator, Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
