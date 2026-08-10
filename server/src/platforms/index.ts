import type { Platform, PlatformAdapter } from "./types.js";
import { youtubeAdapter } from "./youtube.js";
import { twitchAdapter } from "./twitch.js";
import { kickAdapter } from "./kick.js";
import { rplayAdapter } from "./rplay.js";

export const adapters: Record<Platform, PlatformAdapter> = {
  youtube: youtubeAdapter,
  twitch: twitchAdapter,
  kick: kickAdapter,
  rplay: rplayAdapter,
};

export * from "./types.js";
