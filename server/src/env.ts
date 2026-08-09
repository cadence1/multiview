import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

function resolveDataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export const env = {
  port: Number(process.env.PORT || 8080),
  dataDir: resolveDataDir(),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  twitchClientId: process.env.TWITCH_CLIENT_ID || "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
  twitchEmbedParent: process.env.TWITCH_EMBED_PARENT || "localhost",
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || 90),
};
