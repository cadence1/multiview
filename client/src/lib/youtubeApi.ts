// Loads the YouTube IFrame Player API once and caches the promise, so real
// programmatic volume control (player.setVolume/mute/unMute) is possible on
// an <iframe> we already render — as opposed to just setting a static
// mute=1/0 query param that can't be changed after the embed loads. See
// https://developers.google.com/youtube/iframe_api_reference — passing an
// existing <iframe> (with enablejsapi=1 in its src) to `new YT.Player(...)`
// wires up the postMessage bridge without replacing the element.
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;

export function loadYouTubeApi(): Promise<any> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}
