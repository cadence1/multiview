// Lets the "Main volume" slider genuinely go past 100% by capturing this
// tab's own already-mixed audio output (via getDisplayMedia tab-capture,
// Chromium-only) and re-routing it through a Web Audio GainNode with
// gain > 1. This is the only way to amplify audio playing inside the
// cross-origin YouTube/Twitch iframes we embed — we have no DOM/media
// access into them, only their own postMessage APIs, which both cap at
// 100%. Capturing at the tab level sidesteps that entirely, at the cost of
// only being able to boost everything together (individual iframes' audio
// is already mixed down by the time it reaches "tab" level, so this can't
// give per-window boosting — only the shared Main dial).
//
// Capturing a tab's audio does NOT, by itself, silence that tab's normal
// output — confirmed the hard way: without any extra handling this played
// the original AND the boosted copy at once (an echo). The fix is the
// suppressLocalAudioPlayback audio constraint Chrome added specifically for
// "capture this tab's own audio and re-render it yourself" use cases like
// this one — it tells the browser not to also play the captured track
// through the tab's normal output, leaving our boosted copy as the only
// audible path. Not in TS's lib.dom.d.ts yet, hence the local interface.

interface ChromiumDisplayMediaOptions extends DisplayMediaStreamOptions {
  /** Chromium-only extension (not in lib.dom.d.ts) — skips the generic
   *  "choose what to share" picker and defaults to the current tab. */
  preferCurrentTab?: boolean;
}

interface SuppressibleAudioConstraints extends MediaTrackConstraints {
  /** Chromium-only (not in lib.dom.d.ts): don't also play this captured
   *  track through the tab's normal output — required to avoid an echo
   *  when the captured audio is being re-rendered by the same page. */
  suppressLocalAudioPlayback?: boolean;
}

export interface TabAudioBoost {
  setGain: (multiplier: number) => void;
  stop: () => void;
}

export function isTabAudioBoostSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

export async function startTabAudioBoost(onStopped: () => void): Promise<TabAudioBoost> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true, // required by the spec even though we only want the audio track
    audio: {
      suppressLocalAudioPlayback: true,
    } as SuppressibleAudioConstraints,
    preferCurrentTab: true,
  } as ChromiumDisplayMediaOptions);

  // We only need audio — release the video track immediately, it's never rendered.
  stream.getVideoTracks().forEach((t) => t.stop());

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No audio track was shared — pick "This Tab" with audio sharing enabled.');
  }

  const audioContext = new AudioContext();
  // Created after the getDisplayMedia await above, which breaks the
  // synchronous user-gesture chain the original click started — Chrome
  // commonly starts an AudioContext created this way "suspended" (silent)
  // rather than running. Explicitly resuming is a harmless no-op if it was
  // already running, but required if it wasn't — this is what caused sound
  // to disappear entirely once the echo (a separate, now-fixed bug) was gone.
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1;
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);

  function stop() {
    gainNode.disconnect();
    source.disconnect();
    audioContext.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
  }

  // The browser's own "Stop sharing" control (or closing the permission)
  // ends the track directly — make sure our state follows that too.
  audioTrack.addEventListener("ended", () => {
    stop();
    onStopped();
  });

  return {
    setGain: (multiplier) => {
      gainNode.gain.value = multiplier;
    },
    stop,
  };
}
