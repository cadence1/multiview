// Loads Twitch's Embed JS API once and caches the promise. Unlike YouTube,
// Twitch's supported player-control API (setVolume/setMuted) only works on a
// player it constructs itself via `new Twitch.Player(container, options)` —
// it manages its own internal <iframe> inside the given container element,
// rather than attaching to one we already rendered. See
// https://dev.twitch.tv/docs/embed/video-and-clips/
declare global {
  interface Window {
    Twitch?: any;
  }
}

let apiPromise: Promise<any> | null = null;

export function loadTwitchApi(): Promise<any> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve) => {
    if (window.Twitch?.Player) {
      resolve(window.Twitch);
      return;
    }
    const existing = document.querySelector(
      'script[src="https://player.twitch.tv/js/embed/v1.js"]'
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Twitch));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://player.twitch.tv/js/embed/v1.js";
    script.onload = () => resolve(window.Twitch);
    document.head.appendChild(script);
  });

  return apiPromise;
}
