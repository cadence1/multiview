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
// Chrome recognizes the specific pattern of capturing a tab's own audio and
// reconnecting it to that same tab's audio output as in-page processing
// (the same mechanism behind Chrome's own "tab audio booster"/"noise
// suppression" demos) and suppresses the tab's normal output so this
// doesn't double up into an echo — but that's Chrome's documented behavior,
// not something verifiable by ear from here, so it's worth an actual listen
// once you try it. Bail out immediately (Stop) if it does sound doubled.

interface ChromiumDisplayMediaOptions extends DisplayMediaStreamOptions {
  /** Chromium-only extension (not in lib.dom.d.ts) — skips the generic
   *  "choose what to share" picker and defaults to the current tab. */
  preferCurrentTab?: boolean;
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
    audio: true,
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
