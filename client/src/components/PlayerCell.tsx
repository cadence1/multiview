import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Creator, CreatorStatus } from "../types.js";
import { embedUrlFor, formatRelativeToNow } from "../utils.js";
import { loadYouTubeApi } from "../lib/youtubeApi.js";
import { loadTwitchApi } from "../lib/twitchApi.js";
import PlatformBadge from "./PlatformBadge.js";

interface Props {
  creator: Creator;
  status?: CreatorStatus;
  /** Effective volume 0-100 (master × this creator's saved volume). */
  volume: number;
  onRemove: () => void;
  isRecording: boolean;
}

function placeholderText(creator: Creator, status?: CreatorStatus): string {
  if (status?.state === "upcoming") {
    return status.startTime
      ? `${creator.display_name} starts ${formatRelativeToNow(status.startTime)}`
      : `${creator.display_name} is upcoming`;
  }
  return `${creator.display_name} is offline`;
}

export default function PlayerCell({ creator, status, volume, onRemove, isRecording }: Props) {
  const twitchParent = useMemo(() => window.location.hostname || "localhost", []);
  const isLive = status?.state === "live" && Boolean(status.embedId);

  // Player instances are created once per embed (see the ref callbacks
  // below) and then just get told about volume changes afterward — they
  // don't get recreated every time the slider moves.
  const ytPlayerRef = useRef<any>(null);
  const twitchPlayerRef = useRef<any>(null);
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // YouTube: attach the IFrame Player API to the iframe we already render
  // (enablejsapi=1 in its src) so setVolume/mute/unMute work afterward —
  // rather than only being able to set a static mute=1/0 at load time.
  const attachYouTube = useCallback((iframeEl: HTMLIFrameElement | null) => {
    ytPlayerRef.current = null;
    if (!iframeEl) return;
    loadYouTubeApi().then((YT) => {
      const player = new YT.Player(iframeEl, {
        events: {
          onReady: () => {
            ytPlayerRef.current = player;
            player.setVolume(volumeRef.current);
            if (volumeRef.current > 0) player.unMute();
            else player.mute();
          },
        },
      });
    });
  }, []);

  // Twitch: its player-control API only works on a player it constructs
  // itself, so this renders an empty container and lets Twitch.Player fill
  // it in — React never touches this element's children afterward.
  const attachTwitch = useCallback(
    (containerEl: HTMLDivElement | null) => {
      twitchPlayerRef.current = null;
      if (!containerEl || !status?.embedId) return;
      loadTwitchApi().then((Twitch) => {
        containerEl.innerHTML = "";
        const player = new Twitch.Player(containerEl, {
          channel: status.embedId,
          parent: [twitchParent],
          muted: volumeRef.current <= 0,
          autoplay: true,
          width: "100%",
          height: "100%",
        });
        player.setVolume(volumeRef.current / 100);
        twitchPlayerRef.current = player;
      });
    },
    [status?.embedId, twitchParent]
  );

  // Apply live volume changes to whichever player is already attached.
  useEffect(() => {
    if (creator.platform === "youtube" && ytPlayerRef.current) {
      ytPlayerRef.current.setVolume(volume);
      if (volume > 0) ytPlayerRef.current.unMute();
      else ytPlayerRef.current.mute();
    } else if (creator.platform === "twitch" && twitchPlayerRef.current) {
      twitchPlayerRef.current.setVolume(volume / 100);
      twitchPlayerRef.current.setMuted(volume <= 0);
    }
  }, [volume, creator.platform]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md bg-black">
      {isLive && creator.platform === "youtube" && (
        <iframe
          key={`youtube:${status!.embedId}`}
          ref={attachYouTube}
          src={embedUrlFor("youtube", status!.embedId!, twitchParent)}
          className="h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )}
      {isLive && creator.platform === "twitch" && (
        <div key={`twitch:${status!.embedId}`} ref={attachTwitch} className="h-full w-full" />
      )}
      {isLive && creator.platform === "kick" && (
        // No live control API for Kick — the only lever is reloading the
        // embed with a different muted= value, so this only changes when
        // volume crosses the 0 / >0 boundary (see MediaPanel), not on every
        // intermediate slider tick.
        <iframe
          key={`kick:${status!.embedId}:${volume <= 0}`}
          src={embedUrlFor("kick", status!.embedId!, twitchParent, volume <= 0)}
          className="h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )}
      {isLive && creator.platform === "rplay" && (
        // No dedicated minimal player (see embedUrlFor) and no remote
        // volume control — this is the site's own full page, muted by
        // default; the user can click its own speaker icon to unmute.
        <iframe
          key={`rplay:${status!.embedId}`}
          src={embedUrlFor("rplay", status!.embedId!, twitchParent)}
          className="h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      )}
      {!isLive && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
          {creator.avatar_url && (
            <img src={creator.avatar_url} alt="" className="h-10 w-10 rounded-full opacity-50" />
          )}
          <span className="text-xs">{placeholderText(creator, status)}</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
        <div className="flex items-center gap-1.5 truncate">
          <PlatformBadge platform={creator.platform} />
          <span className="truncate text-xs font-medium text-white drop-shadow">
            {creator.display_name}
          </span>
          {isRecording && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
              title="Being recorded"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white" /> Rec
            </span>
          )}
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
