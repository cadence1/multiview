import type { Platform, PlatformAdapter } from "./types.js";
import { youtubeAdapter } from "./youtube.js";
import { twitchAdapter } from "./twitch.js";
import { kickAdapter } from "./kick.js";

export const adapters: Record<Platform, PlatformAdapter> = {
  youtube: youtubeAdapter,
  twitch: twitchAdapter,
  kick: kickAdapter,
};

export * from "./types.js";
